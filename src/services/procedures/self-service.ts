import { z } from "zod";
import { audit, companyToday, idSchema, mutation, nowISO, query, type Ctx } from "@/services/core";
import { addressSchema } from "@/services/procedures/employees";
import { departmentNames, displayName, finalizedResults, getCompany, nameOf, redactEmployee, scopeWhere, FINAL_STATUSES } from "@/services/helpers";
import { summarizeYtd, ytdFor } from "@/services/procedures/payroll";
import { addDays, nextAnniversary, wholeYearsBetween, yearOf, diffDays } from "@/lib/dates";
import { forbidden, notFound } from "@/lib/errors";
import { hasPermission } from "@/services/authz";

function requireEmployee(ctx: Ctx): string {
  if (!ctx.actor.employeeId) throw forbidden("Your account is not linked to an employee record in this company.");
  return ctx.actor.employeeId;
}

export const selfServiceProcedures = {
  "me.profile": query({
    input: z.object({}),
    permission: "self.view",
    handler: async (ctx) => {
      if (!ctx.actor.employeeId) return null;
      const e = await ctx.repo.employees.get(ctx.actor.companyId, ctx.actor.employeeId);
      if (!e) return null;
      const [deps, manager] = await Promise.all([departmentNames(ctx), e.managerId ? ctx.repo.employees.get(ctx.actor.companyId, e.managerId) : null]);
      return { employee: redactEmployee(ctx.actor, e), departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "—") : "—", managerName: nameOf(manager) };
    },
  }),

  "me.updateProfile": mutation({
    input: z.object({
      preferredName: z.string().trim().max(80),
      phone: z.string().trim().max(40),
      address: addressSchema,
      emergencyContact: z.object({ name: z.string().trim().max(120), relationship: z.string().trim().max(60), phone: z.string().trim().max(40) }),
    }),
    permission: "self.view",
    handler: async (ctx, input) => {
      const id = requireEmployee(ctx);
      const before = await ctx.repo.employees.get(ctx.actor.companyId, id);
      if (!before) throw notFound("Employee");
      await ctx.repo.employees.update(ctx.actor.companyId, id, { ...input, updatedAt: nowISO(ctx) });
      await audit(ctx, {
        action: "employee.self_updated",
        entityType: "employee",
        entityId: id,
        summary: `${displayName(before)} updated their contact details`,
        before: { preferredName: before.preferredName, phone: before.phone, address: before.address, emergencyContact: before.emergencyContact },
        after: input,
      });
      return { ok: true };
    },
  }),

  "me.payslips": query({
    input: z.object({}),
    permission: "self.view",
    handler: async (ctx) => {
      if (!ctx.actor.employeeId) return [];
      const runs = await ctx.repo.payrollRuns.list(ctx.actor.companyId, { where: { status: FINAL_STATUSES } });
      const runById = new Map(runs.map((r) => [r.id, r]));
      const results = await ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { employeeId: ctx.actor.employeeId }, orderBy: [{ field: "payDate", dir: "desc" }] });
      return results
        .filter((r) => runById.has(r.runId))
        .map((r) => ({ id: r.id, runId: r.runId, runName: runById.get(r.runId)!.name, runType: r.runType, payDate: r.payDate, periodStart: r.periodStart, periodEnd: r.periodEnd, gross: r.totals.gross, net: r.totals.net }));
    },
  }),

  "me.payslip": query({
    input: z.object({ resultId: idSchema }),
    permission: "self.view",
    handler: async (ctx, { resultId }) => {
      const employeeId = requireEmployee(ctx);
      const r = await ctx.repo.payrollResults.get(ctx.actor.companyId, resultId);
      if (!r || r.employeeId !== employeeId) throw notFound("Payslip");
      const run = await ctx.repo.payrollRuns.get(ctx.actor.companyId, r.runId);
      if (!run || !FINAL_STATUSES.includes(run.status)) throw notFound("Payslip");
      const company = await getCompany(ctx);
      const prior = await finalizedResults(ctx, { employeeId, year: yearOf(r.payDate) });
      await audit(ctx, { action: "payslip.viewed", entityType: "payroll_result", entityId: r.id, summary: `Employee opened payslip for ${run.name}` });
      return {
        company: { legalName: company.legalName, tradingName: company.tradingName, address: company.address, currency: company.currency, employerIds: company.employerIds },
        run: { id: run.id, name: run.name, status: run.status, type: run.type, periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate },
        payslips: [{ result: r, ytd: ytdFor(prior, employeeId, r.payDate, r, true) }],
      };
    },
  }),

  "me.ytd": query({
    input: z.object({ year: z.number().int() }),
    permission: "self.view",
    handler: async (ctx, { year }) => {
      if (!ctx.actor.employeeId) return null;
      return summarizeYtd(await finalizedResults(ctx, { employeeId: ctx.actor.employeeId, year }));
    },
  }),

  "people.celebrations": query({
    input: z.object({ days: z.number().int().min(1).max(366).default(30), departmentId: idSchema.optional(), kind: z.enum(["all", "birthday", "anniversary"]).default("all") }),
    permission: ["employee.view", "self.view"],
    handler: async (ctx, input) => {
      const today = await companyToday(ctx);
      const until = addDays(today, input.days);
      const all = hasPermission(ctx.actor, "employee.view");
      const employees = await ctx.repo.employees.list(ctx.actor.companyId, { where: { ...(all ? scopeWhere(ctx.actor) : {}), status: ["active", "on_leave", "onboarding"], departmentId: input.departmentId } });
      const deps = await departmentNames(ctx);
      const items: { employeeId: string; name: string; departmentName: string; position: string; kind: "birthday" | "anniversary"; date: string; daysAway: number; years: number }[] = [];
      for (const e of employees) {
        if (input.kind !== "anniversary" && e.dateOfBirth) {
          const date = nextAnniversary(e.dateOfBirth, today);
          if (date <= until) items.push({ employeeId: e.id, name: displayName(e), departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "", position: e.position, kind: "birthday", date, daysAway: diffDays(today, date), years: wholeYearsBetween(e.dateOfBirth, date) });
        }
        if (input.kind !== "birthday" && e.hireDate < today) {
          const date = nextAnniversary(e.hireDate, addDays(today, 0));
          const years = wholeYearsBetween(e.hireDate, date);
          if (date <= until && years >= 1) items.push({ employeeId: e.id, name: displayName(e), departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "", position: e.position, kind: "anniversary", date, daysAway: diffDays(today, date), years });
        }
      }
      // Self-service users see names and dates only, never ages.
      return items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)).map((i) => (all ? i : { ...i, years: i.kind === "birthday" ? 0 : i.years }));
    },
  }),
};
