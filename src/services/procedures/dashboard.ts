import { z } from "zod";
import { companyToday, query } from "@/services/core";
import { departmentNames, displayName, getCompany, scopeWhere, FINAL_STATUSES } from "@/services/helpers";
import { hasPermission } from "@/services/authz";
import { nextPeriod, periodContaining } from "@/domain/payroll/calendar";
import { preflightSummary } from "@/domain/payroll/preflight";
import { addDays, diffDays, nextAnniversary, wholeYearsBetween } from "@/lib/dates";
import { money, sum } from "@/lib/money";

export const dashboardProcedures = {
  "dashboard.summary": query({
    input: z.object({}),
    permission: null,
    handler: async (ctx) => {
      const a = ctx.actor;
      const c = a.companyId;
      const today = await companyToday(ctx);
      const company = await getCompany(ctx);
      const canHR = hasPermission(a, "employee.view");
      const canPayroll = hasPermission(a, "payroll.view");
      const deps = await departmentNames(ctx);

      const employees = canHR ? await ctx.repo.employees.list(c, { where: scopeWhere(a) }) : [];
      const current = employees.filter((e) => ["active", "on_leave", "onboarding"].includes(e.status));
      const byDept = new Map<string, number>();
      for (const e of current) byDept.set(e.departmentId ?? "", (byDept.get(e.departmentId ?? "") ?? 0) + 1);

      const headcount = canHR
        ? {
            total: current.length,
            onboarding: current.filter((e) => e.status === "onboarding").length,
            onLeave: current.filter((e) => e.status === "on_leave").length,
            joinedLast90: current.filter((e) => e.hireDate >= addDays(today, -90) && e.hireDate <= today).length,
            leavingNext90: current.filter((e) => e.terminationDate && e.terminationDate >= today && e.terminationDate <= addDays(today, 90)).length,
            byDepartment: [...byDept].map(([id, count]) => ({ id, name: id ? (deps.get(id) ?? "—") : "No department", count })).sort((x, y) => y.count - x.count),
          }
        : null;

      // Approvals waiting on this user
      const pendingLeave = hasPermission(a, "leave.approve")
        ? (await ctx.repo.leaveRequests.list(c, { where: { status: "pending", ...(scopeWhere(a).id ? { employeeId: scopeWhere(a).id } : {}) } })).filter((r) => r.employeeId !== a.employeeId)
        : [];
      const pendingTimesheets = hasPermission(a, "attendance.approve")
        ? (await ctx.repo.timesheets.count(c, { where: { status: "submitted", ...(scopeWhere(a).id ? { employeeId: scopeWhere(a).id } : {}) } }))
        : 0;
      const pendingCorrections = hasPermission(a, "attendance.approve") ? await ctx.repo.attendanceCorrections.count(c, { where: { status: "pending" } }) : 0;

      const docs = hasPermission(a, "documents.view") && a.scope === "all" ? await ctx.repo.documents.list(c, { range: { field: "expiryDate", lte: addDays(today, 30) } }) : [];
      const empById = new Map(employees.map((e) => [e.id, e]));
      const expiringDocuments = docs.map((d) => ({ id: d.id, title: d.title, employeeId: d.employeeId, employeeName: d.employeeId && empById.get(d.employeeId) ? displayName(empById.get(d.employeeId)!) : "Company", expiryDate: d.expiryDate!, expired: d.expiryDate! < today })).sort((x, y) => x.expiryDate.localeCompare(y.expiryDate));

      const celebrations = canHR
        ? current
            .flatMap((e) => {
              const out: { employeeId: string; name: string; kind: "birthday" | "anniversary"; date: string; daysAway: number; years: number }[] = [];
              if (e.dateOfBirth) {
                const dt = nextAnniversary(e.dateOfBirth, today);
                if (diffDays(today, dt) <= 14) out.push({ employeeId: e.id, name: displayName(e), kind: "birthday", date: dt, daysAway: diffDays(today, dt), years: wholeYearsBetween(e.dateOfBirth, dt) });
              }
              const ad = nextAnniversary(e.hireDate, today);
              const yrs = wholeYearsBetween(e.hireDate, ad);
              if (yrs >= 1 && diffDays(today, ad) <= 14) out.push({ employeeId: e.id, name: displayName(e), kind: "anniversary", date: ad, daysAway: diffDays(today, ad), years: yrs });
              return out;
            })
            .sort((x, y) => x.date.localeCompare(y.date))
        : [];

      const onboarding = hasPermission(a, "workflows.manage") ? await ctx.repo.workflows.list(c, { where: { status: "in_progress" } }) : [];

      let payroll = null;
      if (canPayroll) {
        const runs = await ctx.repo.payrollRuns.list(c, { orderBy: [{ field: "payDate", dir: "desc" }] });
        const open = runs.filter((r) => !FINAL_STATUSES.includes(r.status));
        const calendar = company.payCalendars.find((x) => x.active) ?? company.payCalendars[0];
        // Trend and "last payroll" use the primary pay frequency so bars are comparable.
        const finals = runs.filter((r) => FINAL_STATUSES.includes(r.status) && r.type === "regular" && (!calendar || r.payFrequency === calendar.frequency));
        const last = finals[0] ?? null;
        const lastOfFreq = runs.find((r) => r.type === "regular" && r.payFrequency === calendar?.frequency);
        const due = calendar ? (lastOfFreq ? nextPeriod(calendar, { end: lastOfFreq.periodEnd }) : periodContaining(calendar, today)) : null;
        const trend = finals
          .slice(0, 6)
          .reverse()
          .map((r) => ({ id: r.id, label: r.name.replace(/^.*·\s*/, ""), payDate: r.payDate, gross: r.totals?.gross ?? 0, net: r.totals?.net ?? 0, employerCost: r.totals?.employerCost ?? 0 }));
        const ytdRuns = runs.filter((r) => FINAL_STATUSES.includes(r.status) && r.payDate.slice(0, 4) === today.slice(0, 4));
        payroll = {
          open: open.map((r) => ({ id: r.id, name: r.name, status: r.status, payDate: r.payDate, stale: r.stale, totals: r.totals, preflight: preflightSummary(r.preflight.issues, r.preflight.acknowledged) })),
          last: last ? { id: last.id, name: last.name, payDate: last.payDate, status: last.status, totals: last.totals } : null,
          due: due ? { ...due, daysUntilPay: diffDays(today, due.payDate), exists: runs.some((r) => r.type === "regular" && r.periodStart === due.start && r.payFrequency === due.frequency) } : null,
          trend,
          trendFrequency: calendar?.frequency ?? null,
          ytd: {
            gross: money(sum(ytdRuns.map((r) => r.totals?.gross ?? 0))),
            net: money(sum(ytdRuns.map((r) => r.totals?.net ?? 0))),
            employerCost: money(sum(ytdRuns.map((r) => r.totals?.employerCost ?? 0))),
          },
          liabilities: last?.totals ? { employee: last.totals.employeeStatutory, employer: last.totals.employerStatutory, total: money(last.totals.employeeStatutory + last.totals.employerStatutory) } : null,
        };
      }

      const activity = hasPermission(a, "audit.view") ? (await ctx.repo.audit.list(a.organizationId, { companyId: c, limit: 8 })).items.map((e) => ({ id: e.id, at: e.at, actorName: e.actorName, summary: e.summary, action: e.action })) : [];

      return {
        today,
        currency: company.currency,
        headcount,
        approvals: {
          leave: pendingLeave.length,
          leaveItems: pendingLeave.slice(0, 5).map((r) => ({ id: r.id, employeeName: empById.get(r.employeeId) ? displayName(empById.get(r.employeeId)!) : "—", startDate: r.startDate, endDate: r.endDate, quantity: r.quantity, unit: r.unit })),
          timesheets: pendingTimesheets,
          corrections: pendingCorrections,
        },
        expiringDocuments,
        celebrations,
        onboarding: onboarding.map((w) => ({ id: w.id, type: w.type, employeeName: empById.get(w.employeeId) ? displayName(empById.get(w.employeeId)!) : "—", done: w.tasks.filter((t) => t.done).length, total: w.tasks.length, startDate: w.startDate })),
        payroll,
        activity,
      };
    },
  }),
};
