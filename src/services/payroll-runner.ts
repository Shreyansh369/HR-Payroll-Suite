/**
 * Gathers persisted inputs for a payroll run and invokes the pure calculation engine.
 */
import type { Company, Employee, PayrollEmployeeResult, PayrollRun } from "@/domain/types";
import { calculateEmployeePayroll, sumTotals } from "@/domain/payroll/engine";
import { runPreflight } from "@/domain/payroll/preflight";
import { effectiveOn } from "@/domain/employee/schedule";
import { departmentNames, finalizedResults, loanOutstanding, FINAL_STATUSES } from "@/services/helpers";
import type { Ctx } from "@/services/core";
import { nowISO } from "@/services/core";
import { yearOf } from "@/lib/dates";
import { money, sum } from "@/lib/money";

/** Employees eligible for a regular run of this frequency and period. */
export async function eligibleEmployees(ctx: Ctx, frequency: PayrollRun["payFrequency"], start: string, end: string): Promise<Employee[]> {
  const [employees, rates] = await Promise.all([
    ctx.repo.employees.list(ctx.actor.companyId, { where: { status: ["active", "on_leave", "onboarding", "terminated"] } }),
    ctx.repo.payRates.list(ctx.actor.companyId),
  ]);
  return employees.filter((e) => {
    if (e.hireDate > end) return false;
    if (e.terminationDate && e.terminationDate < start) return false;
    const rate = effectiveOn(rates.filter((r) => r.employeeId === e.id), end) ?? effectiveOn(rates.filter((r) => r.employeeId === e.id), start);
    return rate?.payFrequency === frequency;
  });
}

export async function previousRegularRun(ctx: Ctx, run: Pick<PayrollRun, "id" | "payFrequency" | "periodStart">): Promise<PayrollRun | null> {
  const runs = await ctx.repo.payrollRuns.list(ctx.actor.companyId, {
    where: { type: "regular", payFrequency: run.payFrequency, status: FINAL_STATUSES },
    range: { field: "periodStart", lte: run.periodStart },
    orderBy: [{ field: "periodStart", dir: "desc" }],
  });
  return runs.find((r) => r.id !== run.id && r.periodStart < run.periodStart) ?? null;
}

export async function calculateRun(ctx: Ctx, run: PayrollRun, company: Company): Promise<{ run: PayrollRun; results: PayrollEmployeeResult[] }> {
  const c = ctx.actor.companyId;
  const range = { start: run.periodStart, end: run.periodEnd };
  const [employees, rates, schedules, items, timesheets, leave, leaveTypes, loans, rules, deps, activeCount] = await Promise.all([
    ctx.repo.employees.list(c, { where: { id: run.employeeIds } }),
    ctx.repo.payRates.list(c, { where: { employeeId: run.employeeIds } }),
    ctx.repo.schedules.list(c, { where: { employeeId: run.employeeIds } }),
    ctx.repo.payItems.list(c, { where: { employeeId: run.employeeIds, active: true } }),
    ctx.repo.timesheets.list(c, { where: { employeeId: run.employeeIds }, range: { field: "date", gte: range.start, lte: range.end } }),
    ctx.repo.leaveRequests.list(c, { where: { employeeId: run.employeeIds, status: "approved" }, overlaps: { startField: "startDate", endField: "endDate", start: range.start, end: range.end } }),
    ctx.repo.leaveTypes.list(c),
    ctx.repo.loans.list(c, { where: { employeeId: run.employeeIds, status: "active" } }),
    ctx.repo.statutoryRules.list(c),
    departmentNames(ctx),
    ctx.repo.employees.count(c, { where: { status: ["active", "on_leave", "onboarding"] } }),
  ]);
  const year = yearOf(run.payDate);
  const priorYear = await finalizedResults(ctx, { year, beforeRunId: run.id });
  const allPriorForLoans = await finalizedResults(ctx, { beforeRunId: run.id });
  const now = nowISO(ctx);

  const results: PayrollEmployeeResult[] = employees.map((e) => {
    const ytdContributable: Record<string, number> = {};
    for (const r of priorYear.filter((x) => x.employeeId === e.id && x.payDate < run.payDate)) {
      for (const s of r.statutory) ytdContributable[s.code] = money(sum([ytdContributable[s.code] ?? 0, s.contributableBase]));
    }
    const calc = calculateEmployeePayroll({
      employee: e,
      departmentName: e.departmentId ? (deps.get(e.departmentId) ?? "") : "",
      period: { start: run.periodStart, end: run.periodEnd, payDate: run.payDate, frequency: run.payFrequency },
      runType: run.type,
      payRates: rates.filter((r) => r.employeeId === e.id),
      schedules: schedules.filter((s) => s.employeeId === e.id),
      payItems: items.filter((i) => i.employeeId === e.id),
      inputs: run.inputs.filter((i) => i.employeeId === e.id),
      timesheets: timesheets.filter((t) => t.employeeId === e.id),
      leaveRequests: leave.filter((l) => l.employeeId === e.id),
      leaveTypes,
      loans: loans.filter((l) => l.employeeId === e.id).map((loan) => ({ loan, outstanding: loanOutstanding(loan, allPriorForLoans).outstanding })),
      statutoryRules: rules,
      ytdContributable,
      headcount: activeCount,
      holidays: company.holidays,
      settings: company.payrollSettings,
      currency: company.currency,
    });
    return { ...calc, id: `res_${run.id.slice(4)}_${e.id.slice(4)}`, companyId: c, runId: run.id, createdAt: now, updatedAt: now };
  });

  const prev = run.type === "regular" ? await previousRegularRun(ctx, run) : null;
  const previousResults = prev ? await ctx.repo.payrollResults.list(c, { where: { runId: prev.id } }) : [];
  const issues = runPreflight({
    run,
    results,
    employees,
    previousResults,
    timesheets,
    approvedLeave: leave,
    varianceThreshold: company.payrollSettings.varianceWarningThreshold,
    currency: company.currency,
    requireApprovedRules: ctx.mode === "production",
  });
  const totals = sumTotals(results);
  const stillValid = run.preflight.acknowledged.filter((id) => issues.some((i) => i.id === id && i.severity === "warning"));
  return {
    run: {
      ...run,
      totals,
      preflight: { issues, ranAt: now, acknowledged: stillValid },
      calculationVersion: results[0]?.calculationVersion ?? null,
      calculatedAt: now,
      stale: false,
      updatedAt: now,
    },
    results,
  };
}
