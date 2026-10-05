import { z } from "zod";
import type { AccountKey, PayrollEmployeeResult, PayrollLine, StatutoryType } from "@/domain/types";
import { REPORTS, type ReportColumn, type ReportResult, type ReportRow } from "@/domain/reports/types";
import { audit, companyToday, idSchema, isoDate, query, mutation, nowISO, type Ctx } from "@/services/core";
import { departmentNames, displayName, finalizedResults, getCompany, loanOutstanding, maskIdentifier, scopeWhere, FINAL_STATUSES } from "@/services/helpers";
import { assertPermission, hasPermission } from "@/services/authz";
import { reviewColumns } from "@/domain/payroll/engine";
import { computeBalance, policyRule } from "@/domain/leave/balances";
import { ACCOUNT_LABELS } from "@/config/defaults";
import { formatDate, formatRange, yearOf } from "@/lib/dates";
import { money, sum } from "@/lib/money";
import { invalidState, notFound, validation } from "@/lib/errors";

const t = (key: string, label: string, priority?: 1 | 2 | 3): ReportColumn => ({ key, label, type: "text", priority });
const m = (key: string, label: string, priority?: 1 | 2 | 3): ReportColumn => ({ key, label, type: "money", priority });
const n = (key: string, label: string, priority?: 1 | 2 | 3): ReportColumn => ({ key, label, type: "number", priority });
const dt = (key: string, label: string, priority?: 1 | 2 | 3): ReportColumn => ({ key, label, type: "date", priority });

function totalsFor(columns: ReportColumn[], rows: ReportRow[], labelKey: string): ReportRow {
  const out: ReportRow = { [labelKey]: `Total (${rows.length})` };
  for (const c of columns) if (c.type === "money") out[c.key] = money(sum(rows.map((r) => (r[c.key] as number) ?? 0)));
  return out;
}

const statAmount = (r: PayrollEmployeeResult, type: StatutoryType, who: "employeeAmount" | "employerAmount") => money(sum(r.statutory.filter((s) => s.type === type).map((s) => s[who])));

async function runResults(ctx: Ctx, runId: string) {
  const run = await ctx.repo.payrollRuns.get(ctx.actor.companyId, runId);
  if (!run) throw notFound("Payroll run");
  if (!run.totals) throw invalidState("This payroll has not been calculated.");
  const results = await ctx.repo.payrollResults.list(ctx.actor.companyId, { where: { runId } });
  return { run, results: results.sort((a, b) => a.employee.name.localeCompare(b.employee.name)) };
}

async function statutoryReport(ctx: Ctx, type: StatutoryType, from: string, to: string, idField: "socialSecurityNumber" | "nhiNumber" | "taxId", idLabel: string) {
  const [results, employees] = await Promise.all([finalizedResults(ctx, { from, to }), ctx.repo.employees.list(ctx.actor.companyId)]);
  const emp = new Map(employees.map((e) => [e.id, e]));
  const byEmp = new Map<string, ReportRow>();
  for (const r of results) {
    const rows = r.statutory.filter((s) => s.type === type);
    if (!rows.length) continue;
    const e = emp.get(r.employeeId);
    const cur = byEmp.get(r.employeeId) ?? { code: r.employee.code, name: r.employee.name, identifier: e?.statutoryIds[idField] || "MISSING", payments: 0, base: 0, employee: 0, employer: 0, total: 0 };
    cur.payments = (cur.payments as number) + 1;
    cur.base = money(sum([cur.base as number, ...rows.map((s) => s.contributableBase)]));
    cur.employee = money(sum([cur.employee as number, ...rows.map((s) => s.employeeAmount)]));
    cur.employer = money(sum([cur.employer as number, ...rows.map((s) => s.employerAmount)]));
    cur.total = money(sum([cur.employee as number, cur.employer as number]));
    byEmp.set(r.employeeId, cur);
  }
  const columns = [t("code", "Emp. ID"), t("name", "Employee"), t("identifier", idLabel), n("payments", "Payments", 3), m("base", "Contributable base"), m("employee", "Employee"), m("employer", "Employer"), m("total", "Total")];
  const rows = [...byEmp.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { columns, rows, totals: totalsFor(columns, rows, "name"), notes: rows.some((r) => r.identifier === "MISSING") ? [`Some employees have no ${idLabel} recorded.`] : [] };
}

async function buildReport(ctx: Ctx, id: string, p: { runId?: string; year?: number; from?: string; to?: string; asOf?: string }): Promise<Omit<ReportResult, "generatedAt" | "companyName" | "currency" | "id" | "title">> {
  const c = ctx.actor.companyId;
  const today = await companyToday(ctx);
  const year = p.year ?? yearOf(today);
  const from = p.from ?? `${year}-01-01`;
  const to = p.to ?? today;
  const asOf = p.asOf ?? today;
  const rangeLabel = formatRange(from, to);

  switch (id) {
    case "payroll_register": {
      if (!p.runId) throw validation("Choose a payroll run.");
      const { run, results } = await runResults(ctx, p.runId);
      const columns = [t("code", "Emp. ID"), t("name", "Employee"), t("department", "Department", 3), t("payType", "Pay type", 3), m("regular", "Regular"), m("overtime", "Overtime", 2), m("variable", "Bonus/comm./allow.", 2), m("unpaid", "Unpaid leave", 2), m("gross", "Gross"), m("pretax", "Pre-tax ded.", 3), m("ss", "Social Security", 2), m("nhi", "NHI", 2), m("pt", "Payroll Tax", 2), m("deductions", "Other ded.", 2), m("net", "Net pay"), m("employer", "Employer stat.", 3)];
      const rows = results.map((r) => {
        const col = reviewColumns(r);
        return { code: r.employee.code, name: r.employee.name, department: r.employee.departmentName, payType: r.employee.payType, regular: col.regular, overtime: col.overtime, variable: col.variable, unpaid: col.unpaidLeave, gross: r.totals.gross, pretax: r.totals.preTaxDeductions, ss: statAmount(r, "social_security", "employeeAmount"), nhi: statAmount(r, "nhi", "employeeAmount"), pt: statAmount(r, "payroll_tax", "employeeAmount"), deductions: r.totals.postTaxDeductions, net: r.totals.net, employer: r.totals.employerStatutory };
      });
      return { subtitle: `${run.name} · pay date ${formatDate(run.payDate)} · ${run.status}`, columns, rows, totals: totalsFor(columns, rows, "name"), notes: run.status === "locked" || run.status === "finalized" ? [] : ["This payroll is not finalized; figures may change."] };
    }
    case "gross_to_net": {
      if (!p.runId) throw validation("Choose a payroll run.");
      const { run, results } = await runResults(ctx, p.runId);
      const columns = [t("code", "Emp. ID"), t("name", "Employee"), m("gross", "Gross earnings"), m("pretax", "Pre-tax deductions"), m("taxable", "Taxable remuneration"), m("statutory", "Employee statutory"), m("posttax", "Other deductions"), m("net", "Net pay")];
      const rows = results.map((r) => ({ code: r.employee.code, name: r.employee.name, gross: r.totals.gross, pretax: r.totals.preTaxDeductions, taxable: r.totals.taxable, statutory: r.totals.employeeStatutory, posttax: r.totals.postTaxDeductions, net: r.totals.net }));
      return { subtitle: `${run.name} · pay date ${formatDate(run.payDate)}`, columns, rows, totals: totalsFor(columns, rows, "name"), notes: [] };
    }
    case "payroll_summary": {
      const runs = await ctx.repo.payrollRuns.list(c, { where: { status: FINAL_STATUSES }, range: { field: "payDate", gte: `${year}-01-01`, lte: `${year}-12-31` }, orderBy: [{ field: "payDate", dir: "asc" }] });
      const columns = [t("name", "Payroll"), t("type", "Type", 3), dt("payDate", "Pay date"), t("status", "Status", 3), n("employees", "Employees", 2), m("gross", "Gross"), m("deductions", "Deductions", 2), m("employeeStatutory", "Employee stat.", 2), m("net", "Net"), m("employerStatutory", "Employer stat.", 2), m("employerCost", "Employer cost")];
      const rows = runs.map((r) => ({ name: r.name, type: r.type, payDate: r.payDate, status: r.status, employees: r.totals?.employees ?? 0, gross: r.totals?.gross ?? 0, deductions: money((r.totals?.preTaxDeductions ?? 0) + (r.totals?.postTaxDeductions ?? 0)), employeeStatutory: r.totals?.employeeStatutory ?? 0, net: r.totals?.net ?? 0, employerStatutory: r.totals?.employerStatutory ?? 0, employerCost: r.totals?.employerCost ?? 0 }));
      return { subtitle: `Finalized and locked payrolls, ${year}`, columns, rows, totals: totalsFor(columns, rows, "name"), notes: [] };
    }
    case "earnings_history":
    case "deduction_history": {
      const results = await finalizedResults(ctx, { from, to });
      const sections: PayrollLine["section"][] = id === "earnings_history" ? ["earning"] : ["pre_tax_deduction", "deduction", "statutory_employee"];
      const columns = [dt("payDate", "Pay date"), t("code", "Emp. ID", 3), t("name", "Employee"), t("type", "Type", 2), t("label", "Item"), n("quantity", "Qty", 3), m("amount", "Amount")];
      const rows = results.flatMap((r) =>
        r.lines.filter((l) => sections.includes(l.section) && l.amount !== 0).map((l) => ({ payDate: r.payDate, code: r.employee.code, name: r.employee.name, type: l.section === "earning" ? l.category.replace(/_/g, " ") : l.section.replace(/_/g, " "), label: l.label, quantity: l.quantity ?? null, amount: l.amount })),
      ).sort((a, b) => a.payDate.localeCompare(b.payDate) || a.name.localeCompare(b.name));
      return { subtitle: rangeLabel, columns, rows, totals: totalsFor(columns, rows, "name"), notes: [] };
    }
    case "ytd": {
      const results = await finalizedResults(ctx, { year });
      const byEmp = new Map<string, PayrollEmployeeResult[]>();
      for (const r of results) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
      const columns = [t("code", "Emp. ID"), t("name", "Employee"), n("payments", "Payments", 3), m("gross", "Gross"), m("ss", "Social Security", 2), m("nhi", "NHI", 2), m("pt", "Payroll Tax", 2), m("deductions", "Deductions", 2), m("net", "Net"), m("employer", "Employer stat.", 3)];
      const rows = [...byEmp.values()].map((rs) => ({
        code: rs[0].employee.code,
        name: rs[0].employee.name,
        payments: rs.length,
        gross: money(sum(rs.map((r) => r.totals.gross))),
        ss: money(sum(rs.map((r) => statAmount(r, "social_security", "employeeAmount")))),
        nhi: money(sum(rs.map((r) => statAmount(r, "nhi", "employeeAmount")))),
        pt: money(sum(rs.map((r) => statAmount(r, "payroll_tax", "employeeAmount")))),
        deductions: money(sum(rs.map((r) => r.totals.preTaxDeductions + r.totals.postTaxDeductions))),
        net: money(sum(rs.map((r) => r.totals.net))),
        employer: money(sum(rs.map((r) => r.totals.employerStatutory))),
      })).sort((a, b) => a.name.localeCompare(b.name));
      return { subtitle: `Calendar year ${year}, finalized payrolls only`, columns, rows, totals: totalsFor(columns, rows, "name"), notes: [] };
    }
    case "employer_cost": {
      const results = await finalizedResults(ctx, { from, to });
      const byDept = new Map<string, ReportRow>();
      for (const r of results) {
        const k = r.employee.departmentName || "No department";
        const cur = byDept.get(k) ?? { department: k, employees: 0, gross: 0, ss: 0, nhi: 0, pt: 0, employer: 0, cost: 0 };
        cur.gross = money(sum([cur.gross as number, r.totals.gross]));
        cur.ss = money(sum([cur.ss as number, statAmount(r, "social_security", "employerAmount")]));
        cur.nhi = money(sum([cur.nhi as number, statAmount(r, "nhi", "employerAmount")]));
        cur.pt = money(sum([cur.pt as number, statAmount(r, "payroll_tax", "employerAmount")]));
        cur.employer = money(sum([cur.employer as number, r.totals.employerStatutory]));
        cur.cost = money(sum([cur.cost as number, r.totals.employerCost]));
        byDept.set(k, cur);
      }
      for (const [k, row] of byDept) row.employees = new Set(results.filter((r) => (r.employee.departmentName || "No department") === k).map((r) => r.employeeId)).size;
      const columns = [t("department", "Department"), n("employees", "Employees", 2), m("gross", "Gross pay"), m("ss", "Employer SS", 2), m("nhi", "Employer NHI", 2), m("pt", "Employer PT", 2), m("employer", "Employer stat."), m("cost", "Total cost")];
      const rows = [...byDept.values()].sort((a, b) => (b.cost as number) - (a.cost as number));
      return { subtitle: rangeLabel, columns, rows, totals: totalsFor(columns, rows, "department"), notes: [] };
    }
    case "corrections": {
      const runs = await ctx.repo.payrollRuns.list(c, { where: { type: "correction" }, range: { field: "payDate", gte: `${year}-01-01`, lte: `${year}-12-31` } });
      const rows: ReportRow[] = [];
      for (const run of runs) {
        const target = run.correctsRunId ? await ctx.repo.payrollRuns.get(c, run.correctsRunId) : null;
        const results = await ctx.repo.payrollResults.list(c, { where: { runId: run.id } });
        for (const r of results) {
          for (const l of r.lines.filter((x) => x.source === "correction")) {
            rows.push({ payDate: run.payDate, correction: run.name, corrects: target?.name ?? "—", status: run.status, name: r.employee.name, item: l.label, amount: l.section === "earning" ? l.amount : -l.amount, reason: run.correctionReason ?? "" });
          }
        }
        if (results.length === 0) rows.push({ payDate: run.payDate, correction: run.name, corrects: target?.name ?? "—", status: run.status, name: "—", item: "Not calculated", amount: 0, reason: run.correctionReason ?? "" });
      }
      const columns = [dt("payDate", "Pay date"), t("correction", "Correction run"), t("corrects", "Corrects", 2), t("status", "Status", 3), t("name", "Employee"), t("item", "Adjustment"), m("amount", "Amount"), t("reason", "Reason", 2)];
      return { subtitle: `Correction runs with pay dates in ${year}`, columns, rows, totals: totalsFor(columns, rows, "name"), notes: ["Positive amounts are additional earnings; negative amounts are deductions."] };
    }
    case "loans": {
      const [loans, results, employees] = await Promise.all([ctx.repo.loans.list(c), finalizedResults(ctx), ctx.repo.employees.list(c)]);
      const emp = new Map(employees.map((e) => [e.id, e]));
      const columns = [t("reference", "Reference"), t("type", "Type", 2), t("name", "Employee"), dt("issuedDate", "Issued", 3), m("principal", "Principal"), m("installment", "Installment", 2), m("repaid", "Repaid"), m("outstanding", "Outstanding"), t("status", "Status")];
      const rows = loans.map((l) => {
        const e = emp.get(l.employeeId);
        const o = loanOutstanding(l, results);
        return { reference: l.reference, type: l.type, name: e ? displayName(e) : "—", issuedDate: l.issuedDate, principal: l.principal, installment: l.installment, repaid: o.repaid, outstanding: o.outstanding, status: l.status };
      });
      return { subtitle: `As of ${formatDate(today)}`, columns, rows, totals: totalsFor(columns, rows, "name"), notes: [] };
    }
    case "payroll_audit": {
      const page = await ctx.repo.audit.list(ctx.actor.organizationId, { companyId: c, action: "payroll", from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z`, limit: 5000 });
      const columns = [t("at", "When"), t("actor", "By"), t("action", "Action", 2), t("summary", "Detail"), t("reason", "Reason", 2)];
      const rows = page.items.map((e) => ({ at: e.at.replace("T", " ").slice(0, 16), actor: e.actorName, action: e.action.replace("payroll.", ""), summary: e.summary, reason: e.reason ?? "" }));
      return { subtitle: rangeLabel, columns, rows, totals: null, notes: [] };
    }
    case "social_security": {
      const r = await statutoryReport(ctx, "social_security", from, to, "socialSecurityNumber", "SS number");
      return { subtitle: `Pay dates ${rangeLabel}`, ...r };
    }
    case "nhi": {
      const r = await statutoryReport(ctx, "nhi", from, to, "nhiNumber", "NHI number");
      return { subtitle: `Pay dates ${rangeLabel}`, ...r };
    }
    case "payroll_tax": {
      const r = await statutoryReport(ctx, "payroll_tax", from, to, "taxId", "Tax ID");
      return { subtitle: `Pay dates ${rangeLabel}`, ...r };
    }
    case "headcount": {
      const [employees, deps] = await Promise.all([ctx.repo.employees.list(c, { where: scopeWhere(ctx.actor) }), ctx.repo.departments.list(c)]);
      const ys = `${asOf.slice(0, 4)}-01-01`;
      const groups = [...deps.map((x) => ({ id: x.id as string | null, name: x.name })), { id: null, name: "No department" }];
      const rows = groups
        .map((g) => {
          const es = employees.filter((e) => (e.departmentId ?? null) === g.id);
          const employed = es.filter((e) => e.hireDate <= asOf && (!e.terminationDate || e.terminationDate >= asOf));
          return {
            department: g.name,
            headcount: employed.length,
            fullTime: employed.filter((e) => e.employmentType === "full_time").length,
            partTime: employed.filter((e) => e.employmentType === "part_time").length,
            contract: employed.filter((e) => e.employmentType === "contract" || e.employmentType === "temporary").length,
            hires: es.filter((e) => e.hireDate >= ys && e.hireDate <= asOf).length,
            leavers: es.filter((e) => e.terminationDate && e.terminationDate >= ys && e.terminationDate <= asOf).length,
          };
        })
        .filter((r) => r.headcount + r.hires + r.leavers > 0);
      const columns = [t("department", "Department"), n("headcount", "Headcount"), n("fullTime", "Full-time", 2), n("partTime", "Part-time", 2), n("contract", "Contract/temp", 3), n("hires", "Hires YTD"), n("leavers", "Leavers YTD")];
      const totals: ReportRow = { department: "Total" };
      for (const k of ["headcount", "fullTime", "partTime", "contract", "hires", "leavers"]) totals[k] = rows.reduce((s, r) => s + (r[k as keyof typeof r] as number), 0);
      return { subtitle: `As of ${formatDate(asOf)}`, columns, rows, totals, notes: [] };
    }
    case "employee_master": {
      const [employees, deps] = await Promise.all([ctx.repo.employees.list(c, { where: scopeWhere(ctx.actor) }), departmentNames(ctx)]);
      const mgr = new Map(employees.map((e) => [e.id, displayName(e)]));
      const sensitive = hasPermission(ctx.actor, "salary.view");
      const columns = [t("code", "Emp. ID"), t("name", "Name"), t("position", "Position"), t("department", "Department", 2), t("manager", "Manager", 3), t("type", "Type", 3), t("status", "Status"), dt("hireDate", "Hire date", 2), dt("dob", "Date of birth", 3), t("email", "Email", 3), t("phone", "Phone", 3), t("ss", "SS number", 3), t("nhi", "NHI number", 3)];
      const rows = employees.map((e) => ({ code: e.employeeCode, name: `${e.lastName}, ${e.firstName}`, position: e.position, department: e.departmentId ? (deps.get(e.departmentId) ?? "") : "", manager: e.managerId ? (mgr.get(e.managerId) ?? "") : "", type: e.employmentType.replace("_", "-"), status: e.status, hireDate: e.hireDate, dob: e.dateOfBirth, email: e.email, phone: e.phone, ss: sensitive ? e.statutoryIds.socialSecurityNumber : maskIdentifier(e.statutoryIds.socialSecurityNumber), nhi: sensitive ? e.statutoryIds.nhiNumber : maskIdentifier(e.statutoryIds.nhiNumber) }));
      return { subtitle: `${rows.length} employees`, columns, rows, totals: null, notes: sensitive ? ["Contains sensitive identifiers. Handle according to your data protection policy."] : ["Statutory identifiers are masked for your role."] };
    }
    case "employment_history": {
      const [events, employees, deps] = await Promise.all([ctx.repo.employmentEvents.list(c, { range: { field: "effectiveDate", gte: from, lte: to } }), ctx.repo.employees.list(c, { where: scopeWhere(ctx.actor) }), departmentNames(ctx)]);
      const emp = new Map(employees.map((e) => [e.id, e]));
      const columns = [dt("date", "Effective"), t("name", "Employee"), t("event", "Event"), t("position", "Position", 2), t("department", "Department", 2), t("manager", "Manager", 3), t("note", "Note", 3)];
      const rows = events
        .filter((ev) => emp.has(ev.employeeId))
        .map((ev) => ({ date: ev.effectiveDate, name: displayName(emp.get(ev.employeeId)!), event: ev.type.replace(/_/g, " "), position: ev.position ?? "", department: ev.departmentId ? (deps.get(ev.departmentId) ?? "") : "", manager: ev.managerId && emp.get(ev.managerId) ? displayName(emp.get(ev.managerId)!) : "", note: ev.note }))
        .sort((a, b) => b.date.localeCompare(a.date));
      return { subtitle: rangeLabel, columns, rows, totals: null, notes: [] };
    }
    case "leave_report": {
      const [requests, employees, types] = await Promise.all([
        ctx.repo.leaveRequests.list(c, { overlaps: { startField: "startDate", endField: "endDate", start: from, end: to } }),
        ctx.repo.employees.list(c, { where: scopeWhere(ctx.actor) }),
        ctx.repo.leaveTypes.list(c),
      ]);
      const emp = new Map(employees.map((e) => [e.id, e]));
      const typ = new Map(types.map((x) => [x.id, x]));
      const columns = [t("name", "Employee"), t("type", "Leave type"), t("paid", "Paid", 3), dt("start", "From"), dt("end", "To"), n("quantity", "Quantity"), t("unit", "Unit", 3), t("status", "Status"), t("reason", "Reason", 3)];
      const rows = requests
        .filter((r) => emp.has(r.employeeId))
        .map((r) => ({ name: displayName(emp.get(r.employeeId)!), type: typ.get(r.leaveTypeId)?.name ?? "", paid: typ.get(r.leaveTypeId)?.paid ? "Paid" : "Unpaid", start: r.startDate, end: r.endDate, quantity: r.quantity, unit: r.unit, status: r.status, reason: r.reason }))
        .sort((a, b) => a.start.localeCompare(b.start));
      return { subtitle: rangeLabel, columns, rows, totals: null, notes: [] };
    }
    case "leave_balance": {
      const [employees, types, policies, ledger, pending] = await Promise.all([
        ctx.repo.employees.list(c, { where: { ...scopeWhere(ctx.actor), status: ["active", "on_leave", "onboarding"] } }),
        ctx.repo.leaveTypes.list(c, { where: { active: true } }),
        ctx.repo.leavePolicies.list(c),
        ctx.repo.leaveLedger.list(c),
        ctx.repo.leaveRequests.list(c, { where: { status: "pending" } }),
      ]);
      const tracked = types.filter((x) => x.tracksBalance);
      const pol = new Map(policies.map((x) => [x.id, x]));
      const columns = [t("code", "Emp. ID", 3), t("name", "Employee"), ...tracked.flatMap((x) => [n(`${x.code}_available`, `${x.name} available`), n(`${x.code}_taken`, `${x.name} taken`, 3)])];
      const rows = employees.map((e) => {
        const row: ReportRow = { code: e.employeeCode, name: displayName(e) };
        for (const x of tracked) {
          const b = computeBalance(x, policyRule(e.leavePolicyId ? pol.get(e.leavePolicyId) : null, x.id), ledger.filter((l) => l.employeeId === e.id), pending.filter((p) => p.employeeId === e.id), asOf, e.hireDate);
          row[`${x.code}_available`] = b.available;
          row[`${x.code}_taken`] = b.taken;
        }
        return row;
      });
      return { subtitle: `As of ${formatDate(asOf)}`, columns, rows, totals: null, notes: [] };
    }
    default:
      throw notFound("Report");
  }
}

interface JournalLine {
  date: string;
  account: AccountKey;
  accountName: string;
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
  name: string;
}

export const reportProcedures = {
  "reports.catalog": query({
    input: z.object({}),
    permission: null,
    handler: async (ctx) => REPORTS.filter((r) => hasPermission(ctx.actor, r.permission)),
  }),

  "reports.run": query({
    input: z.object({ reportId: z.string().max(40), runId: idSchema.optional(), year: z.number().int().min(2000).max(2100).optional(), from: isoDate.optional(), to: isoDate.optional(), asOf: isoDate.optional() }),
    permission: ["reports.hr", "reports.payroll", "reports.statutory"],
    feature: "reports",
    handler: async (ctx, input): Promise<ReportResult> => {
      const def = REPORTS.find((r) => r.id === input.reportId);
      if (!def) throw notFound("Report");
      assertPermission(ctx.actor, def.permission);
      if (input.from && input.to && input.to < input.from) throw validation("The end date must be after the start date.");
      const company = await getCompany(ctx);
      const body = await buildReport(ctx, def.id, input);
      return { id: def.id, title: def.title, generatedAt: nowISO(ctx), companyName: company.legalName, currency: company.currency, ...body };
    },
  }),

  "accounting.journal": query({
    input: z.object({ runId: idSchema, mode: z.enum(["summary", "detailed"]) }),
    permission: "accounting.export",
    feature: "accounting",
    handler: async (ctx, input) => {
      const company = await getCompany(ctx);
      const { run, results } = await runResults(ctx, input.runId);
      const acct = new Map(company.accountMappings.map((a) => [a.key, a]));
      const lines: JournalLine[] = [];
      const add = (account: AccountKey, debit: number, credit: number, name: string, description: string) => {
        if (Math.abs(debit) < 0.005 && Math.abs(credit) < 0.005) return;
        // Negative debits (e.g. net unpaid leave) are presented as credits to keep the journal valid.
        if (debit < 0) [debit, credit] = [0, -debit + credit];
        if (credit < 0) [debit, credit] = [debit - credit, 0];
        const a = acct.get(account);
        lines.push({ date: run.payDate, account, accountName: a?.accountName || ACCOUNT_LABELS[account], accountCode: a?.accountCode ?? "", debit: money(debit), credit: money(credit), description, name });
      };
      const groups = input.mode === "summary" ? [{ name: "", rs: results }] : results.map((r) => ({ name: r.employee.name, rs: [r] }));
      for (const g of groups) {
        const ls = g.rs.flatMap((r) => r.lines.map((l) => ({ l, payType: r.employee.payType })));
        const s = (f: (x: { l: PayrollLine; payType: string }) => boolean) => money(sum(ls.filter(f).map((x) => x.l.amount)));
        const desc = run.name;
        add("salary_expense", s((x) => x.l.section === "earning" && (x.l.category === "regular" || x.l.category === "unpaid_leave") && x.payType === "salary"), 0, g.name, `${desc} — salaries`);
        add("wages_expense", s((x) => x.l.section === "earning" && (x.l.category === "regular" || x.l.category === "unpaid_leave") && x.payType === "hourly"), 0, g.name, `${desc} — wages`);
        add("overtime_expense", s((x) => x.l.section === "earning" && x.l.category === "overtime"), 0, g.name, `${desc} — overtime`);
        add("bonus_expense", s((x) => x.l.section === "earning" && x.l.category === "bonus"), 0, g.name, `${desc} — bonuses`);
        add("commission_expense", s((x) => x.l.section === "earning" && x.l.category === "commission"), 0, g.name, `${desc} — commissions`);
        add("allowance_expense", s((x) => x.l.section === "earning" && ["allowance", "adjustment", "other"].includes(x.l.category)), 0, g.name, `${desc} — allowances & adjustments`);
        add("employer_social_security_expense", s((x) => x.l.section === "statutory_employer" && x.l.category === "social_security"), 0, g.name, `${desc} — employer Social Security`);
        add("employer_nhi_expense", s((x) => x.l.section === "statutory_employer" && x.l.category === "nhi"), 0, g.name, `${desc} — employer NHI`);
        add("employer_payroll_tax_expense", s((x) => x.l.section === "statutory_employer" && (x.l.category === "payroll_tax" || x.l.category === "other")), 0, g.name, `${desc} — employer Payroll Tax`);
        add("social_security_liability", 0, s((x) => (x.l.section === "statutory_employee" || x.l.section === "statutory_employer") && x.l.category === "social_security"), g.name, `${desc} — Social Security payable`);
        add("nhi_liability", 0, s((x) => (x.l.section === "statutory_employee" || x.l.section === "statutory_employer") && x.l.category === "nhi"), g.name, `${desc} — NHI payable`);
        add("payroll_tax_liability", 0, s((x) => (x.l.section === "statutory_employee" || x.l.section === "statutory_employer") && (x.l.category === "payroll_tax" || x.l.category === "other")), g.name, `${desc} — Payroll Tax payable`);
        add("deductions_liability", 0, s((x) => (x.l.section === "pre_tax_deduction" || x.l.section === "deduction") && x.l.source !== "loan"), g.name, `${desc} — employee deductions`);
        add("loans_receivable", 0, s((x) => x.l.source === "loan"), g.name, `${desc} — loan & advance repayments`);
        add("net_pay_clearing", 0, money(sum(g.rs.map((r) => r.totals.net))), g.name, `${desc} — net pay`);
      }
      const debits = money(sum(lines.map((l) => l.debit)));
      const credits = money(sum(lines.map((l) => l.credit)));
      return {
        run: { id: run.id, name: run.name, payDate: run.payDate, status: run.status },
        journalNo: `PR-${run.payDate.replace(/-/g, "")}`,
        lines,
        debits,
        credits,
        balanced: Math.abs(debits - credits) < 0.005,
        currency: company.currency,
        finalized: FINAL_STATUSES.includes(run.status),
      };
    },
  }),

  "accounting.logJournalExport": mutation({
    input: z.object({ runId: idSchema, mode: z.enum(["summary", "detailed"]), format: z.enum(["csv", "xlsx"]) }),
    permission: "accounting.export",
    handler: async (ctx, input) => {
      const run = await ctx.repo.payrollRuns.get(ctx.actor.companyId, input.runId);
      if (!run) throw notFound("Payroll run");
      await audit(ctx, { action: "export.generated", entityType: "journal", entityId: run.id, summary: `Exported ${input.mode} QuickBooks journal for ${run.name} (${input.format.toUpperCase()})` });
      return { ok: true };
    },
  }),
};
