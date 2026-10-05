import type {
  Company,
  Employee,
  ID,
  Loan,
  PayrollEmployeeResult,
  PayrollRun,
} from "@/domain/types";
import { displayName } from "@/domain/payroll/engine";
import { d, money, sum } from "@/lib/money";
import { notFound, invalidState } from "@/lib/errors";
import { assertEmployeeScope, canAccessEmployee, hasPermission, scopedEmployeeIds, type Actor } from "@/services/authz";
import type { Ctx } from "@/services/core";

export { displayName };

export async function getCompany(ctx: Ctx): Promise<Company> {
  const company = await ctx.repo.companies.get(ctx.actor.companyId);
  if (!company) throw notFound("Company");
  return company;
}

/** Load an employee in the active company, enforcing data scope. */
export async function getScopedEmployee(ctx: Ctx, employeeId: ID): Promise<Employee> {
  assertEmployeeScope(ctx.actor, employeeId);
  const e = await ctx.repo.employees.get(ctx.actor.companyId, employeeId);
  if (!e) throw notFound("Employee");
  return e;
}

export function scopeWhere(actor: Actor): { id?: ID[] } {
  const ids = scopedEmployeeIds(actor);
  return ids === null ? {} : { id: ids };
}

export function maskIdentifier(value: string): string {
  if (!value) return "";
  const v = value.replace(/\s/g, "");
  if (v.length <= 3) return "•••";
  return `${"•".repeat(Math.max(3, v.length - 3))}${v.slice(-3)}`;
}

/** Whether the actor may see sensitive identifiers (statutory IDs, bank account) for this employee. */
export function canSeeSensitive(actor: Actor, employeeId: ID): boolean {
  if (actor.employeeId === employeeId) return true;
  return hasPermission(actor, "salary.view") || (hasPermission(actor, "employee.edit") && actor.scope === "all");
}

export function redactEmployee(actor: Actor, e: Employee): Employee {
  const sensitive = canSeeSensitive(actor, e.id);
  const bank = actor.employeeId === e.id || hasPermission(actor, "salary.view");
  return {
    ...e,
    statutoryIds: sensitive
      ? e.statutoryIds
      : {
          socialSecurityNumber: maskIdentifier(e.statutoryIds.socialSecurityNumber),
          nhiNumber: maskIdentifier(e.statutoryIds.nhiNumber),
          taxId: maskIdentifier(e.statutoryIds.taxId),
        },
    payProfile: bank
      ? e.payProfile
      : { payMethod: e.payProfile.payMethod, bankName: "", bankAccount: maskIdentifier(e.payProfile.bankAccount) },
    notes: hasPermission(actor, "employee.edit") || hasPermission(actor, "employee.view") ? e.notes : [],
  };
}

export const FINAL_STATUSES: PayrollRun["status"][] = ["finalized", "locked"];

export async function finalizedRuns(ctx: Ctx): Promise<PayrollRun[]> {
  return ctx.repo.payrollRuns.list(ctx.actor.companyId, { where: { status: FINAL_STATUSES } });
}

/** Results from finalized/locked runs for an employee (optionally within a calendar year of pay date). */
export async function finalizedResults(
  ctx: Ctx,
  opts: { employeeId?: ID; year?: number; beforeRunId?: ID; from?: string; to?: string } = {},
): Promise<PayrollEmployeeResult[]> {
  const runs = await finalizedRuns(ctx);
  const runIds = new Set(runs.filter((r) => r.id !== opts.beforeRunId).map((r) => r.id));
  if (runIds.size === 0) return [];
  const from = opts.year ? `${opts.year}-01-01` : opts.from;
  const to = opts.year ? `${opts.year}-12-31` : opts.to;
  const results = await ctx.repo.payrollResults.list(ctx.actor.companyId, {
    where: opts.employeeId ? { employeeId: opts.employeeId } : {},
    range: from || to ? { field: "payDate", gte: from, lte: to } : undefined,
  });
  return results.filter((r) => runIds.has(r.runId));
}

export function loanOutstanding(loan: Loan, results: PayrollEmployeeResult[]): { repaid: number; outstanding: number } {
  const payroll = sum(
    results.flatMap((r) => r.lines.filter((l) => l.source === "loan" && l.sourceRef === loan.id).map((l) => l.amount)),
  );
  const manual = sum(loan.manualRepayments.map((m) => m.amount));
  const repaid = payroll.plus(manual);
  return { repaid: money(repaid), outstanding: money(d(loan.principal).minus(repaid)) };
}

export async function departmentNames(ctx: Ctx): Promise<Map<ID, string>> {
  const deps = await ctx.repo.departments.list(ctx.actor.companyId);
  return new Map(deps.map((x) => [x.id, x.name]));
}

export function assertEditableRun(run: PayrollRun) {
  if (!["draft", "calculated", "review"].includes(run.status)) {
    throw invalidState(
      run.status === "locked"
        ? "This payroll is locked. Create a correction run to change it."
        : `This payroll is ${run.status}. Reopen it before making changes.`,
    );
  }
}

export function visibleTo(actor: Actor, employeeId: ID | null | undefined): boolean {
  if (!employeeId) return actor.scope === "all";
  return canAccessEmployee(actor, employeeId);
}

/** End of the latest finalized/locked regular period, used to guard retroactive changes. */
export async function lastFinalizedPeriodEnd(ctx: Ctx, employeeId?: ID): Promise<string | null> {
  const runs = (await finalizedRuns(ctx)).filter((r) => r.type === "regular" && (!employeeId || r.employeeIds.includes(employeeId)));
  if (runs.length === 0) return null;
  return runs.reduce((m, r) => (r.periodEnd > m ? r.periodEnd : m), runs[0].periodEnd);
}

export function nameOf(e: Pick<Employee, "firstName" | "lastName" | "preferredName"> | null | undefined): string {
  return e ? displayName(e) : "—";
}
