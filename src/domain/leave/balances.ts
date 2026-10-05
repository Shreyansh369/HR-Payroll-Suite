/**
 * Leave quantities and ledger-based balances.
 */
import { d, sum } from "@/lib/money";
import { eachDay, monthOf, yearOf, type ISODate } from "@/lib/dates";
import { effectiveOn, isScheduledDay } from "@/domain/employee/schedule";
import type {
  Holiday,
  LeaveLedgerEntry,
  LeavePolicy,
  LeavePolicyRule,
  LeaveRequest,
  LeaveType,
  WorkSchedule,
} from "@/domain/types";

/** Working days (or hours) a leave request consumes, excluding non-working days and holidays. */
export function leaveQuantity(
  req: { startDate: ISODate; endDate: ISODate; hours?: number | null },
  type: Pick<LeaveType, "unit">,
  schedules: WorkSchedule[],
  holidays: Holiday[],
): { quantity: number; days: ISODate[] } {
  const hset = new Set(holidays.map((h) => h.date));
  const days = eachDay(req.startDate, req.endDate).filter((day) => {
    const s = effectiveOn(schedules, day);
    return s && isScheduledDay(day, s.workDays) && !hset.has(day);
  });
  if (req.hours && days.length === 1) {
    return { quantity: req.hours, days };
  }
  if (type.unit === "hours") {
    const hours = days.reduce((acc, day) => acc + (effectiveOn(schedules, day)?.hoursPerDay ?? 0), 0);
    return { quantity: hours, days };
  }
  return { quantity: days.length, days };
}

export interface LeaveBalance {
  leaveTypeId: string;
  entitlement: number;
  allocated: number;
  accrued: number;
  carriedForward: number;
  adjustments: number;
  expired: number;
  taken: number;
  /** Approved leave dated after `asOf` (already deducted from available). */
  scheduled: number;
  pending: number;
  available: number;
  unit: "days" | "hours";
}

/**
 * Balance for one leave type in the leave year containing `asOf` (calendar year).
 *
 * available = allocations + accrued + carried forward + adjustments − expired − taken − scheduled
 * Monthly-accrual policies accrue entitlement/12 at the end of each completed month,
 * plus the current month on its first day (accrual in advance), capped at entitlement.
 */
export function computeBalance(
  type: LeaveType,
  rule: LeavePolicyRule | undefined,
  ledger: LeaveLedgerEntry[],
  pendingRequests: LeaveRequest[],
  asOf: ISODate,
  hireDate: ISODate,
): LeaveBalance {
  const year = yearOf(asOf);
  const yearEntries = ledger.filter((e) => e.leaveTypeId === type.id && yearOf(e.date) === year);
  const entries = yearEntries.filter((e) => e.date <= asOf);
  const by = (kinds: LeaveLedgerEntry["kind"][]) => sum(entries.filter((e) => kinds.includes(e.kind)).map((e) => e.amount));

  const allocated = by(["allocation"]);
  const carried = by(["carry_forward"]);
  const adjustments = by(["adjustment"]);
  const expired = by(["expiry"]).abs();
  const taken = by(["taken", "reversal"]).neg();
  const scheduled = sum(yearEntries.filter((e) => e.date > asOf && (e.kind === "taken" || e.kind === "reversal")).map((e) => e.amount)).neg();

  let accrued = d(0);
  if (rule && rule.accrual === "monthly") {
    const startMonth = yearOf(hireDate) === year ? monthOf(hireDate) : 1;
    const months = yearOf(hireDate) > year ? 0 : Math.max(0, monthOf(asOf) - startMonth + 1);
    accrued = d(rule.annualEntitlement).div(12).times(months);
    if (accrued.gt(rule.annualEntitlement)) accrued = d(rule.annualEntitlement);
    accrued = accrued.toDecimalPlaces(2);
  }

  const pending = sum(
    pendingRequests
      .filter((r) => r.leaveTypeId === type.id && r.status === "pending" && yearOf(r.startDate) === year)
      .map((r) => r.quantity),
  );
  const available = allocated.plus(accrued).plus(carried).plus(adjustments).minus(expired).minus(taken).minus(scheduled);
  const n = (x: ReturnType<typeof d>) => Number(x.toDecimalPlaces(2).toString());
  return {
    leaveTypeId: type.id,
    entitlement: rule?.annualEntitlement ?? 0,
    allocated: n(allocated),
    accrued: n(accrued),
    carriedForward: n(carried),
    adjustments: n(adjustments),
    expired: n(expired),
    taken: n(taken),
    scheduled: n(scheduled),
    pending: n(pending),
    available: n(available),
    unit: type.unit,
  };
}

export function policyRule(policy: LeavePolicy | null | undefined, leaveTypeId: string): LeavePolicyRule | undefined {
  return policy?.rules.find((r) => r.leaveTypeId === leaveTypeId);
}

export interface YearEndPlanEntry {
  employeeId: string;
  leaveTypeId: string;
  kind: "carry_forward" | "allocation" | "expiry";
  amount: number;
  date: ISODate;
  reason: string;
}

/**
 * Year-end processing for one employee and leave type: carry forward up to the
 * policy maximum into the new year, and allocate the new year's up-front entitlement.
 */
export function planYearEnd(
  employeeId: string,
  type: LeaveType,
  rule: LeavePolicyRule,
  closingAvailable: number,
  newYear: number,
): YearEndPlanEntry[] {
  const out: YearEndPlanEntry[] = [];
  const jan1 = `${newYear}-01-01`;
  const carry = Math.max(0, Math.min(closingAvailable, rule.carryForwardMax));
  if (carry > 0) {
    out.push({
      employeeId,
      leaveTypeId: type.id,
      kind: "carry_forward",
      amount: carry,
      date: jan1,
      reason: `Carried forward from ${newYear - 1} (max ${rule.carryForwardMax})`,
    });
  }
  if (rule.accrual === "upfront" && rule.annualEntitlement > 0) {
    out.push({
      employeeId,
      leaveTypeId: type.id,
      kind: "allocation",
      amount: rule.annualEntitlement,
      date: jan1,
      reason: `${newYear} entitlement`,
    });
  }
  return out;
}

/** Expiry entry for carried-forward balance not used by the expiry date. */
export function planCarryForwardExpiry(
  rule: LeavePolicyRule,
  carried: number,
  takenSinceYearStart: number,
  year: number,
): { amount: number; date: ISODate } | null {
  if (rule.carryForwardExpiryMonths <= 0 || carried <= 0) return null;
  const unused = Math.max(0, carried - takenSinceYearStart);
  if (unused <= 0) return null;
  const month = String(rule.carryForwardExpiryMonths).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, rule.carryForwardExpiryMonths, 0)).getUTCDate();
  return { amount: -unused, date: `${year}-${month}-${String(lastDay).padStart(2, "0")}` };
}
