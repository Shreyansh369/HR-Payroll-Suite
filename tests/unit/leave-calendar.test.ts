import { describe, expect, it } from "vitest";
import { computeBalance, leaveQuantity, planCarryForwardExpiry, planYearEnd } from "@/domain/leave/balances";
import { nextPeriod, periodContaining, periodLabel } from "@/domain/payroll/calendar";
import { runPreflight, preflightSummary } from "@/domain/payroll/preflight";
import { LEAVE_TYPES, schedule } from "./fixtures";
import type { LeaveLedgerEntry, LeavePolicyRule, PayCalendar } from "@/domain/types";

const vac = LEAVE_TYPES[0];
const entry = (over: Partial<LeaveLedgerEntry>): LeaveLedgerEntry => ({
  id: over.id ?? Math.random().toString(),
  companyId: "co_test",
  createdAt: "",
  updatedAt: "",
  employeeId: "emp_1",
  leaveTypeId: vac.id,
  date: "2026-01-01",
  amount: 0,
  kind: "allocation",
  reason: "",
  createdBy: "usr_1",
  ...over,
});

describe("leave quantity", () => {
  it("excludes weekends and holidays", () => {
    const q = leaveQuantity({ startDate: "2026-10-08", endDate: "2026-10-13" }, vac, [schedule()], [{ date: "2026-10-12", name: "Holiday" }]);
    expect(q.quantity).toBe(3); // Thu, Fri, Tue
  });

  it("measures hours for hour-based leave types and partial days", () => {
    expect(leaveQuantity({ startDate: "2026-10-08", endDate: "2026-10-09" }, { unit: "hours" }, [schedule()], []).quantity).toBe(16);
    expect(leaveQuantity({ startDate: "2026-10-08", endDate: "2026-10-08", hours: 3 }, vac, [schedule()], []).quantity).toBe(3);
  });

  it("follows a 6-day schedule", () => {
    const q = leaveQuantity({ startDate: "2026-10-05", endDate: "2026-10-11" }, vac, [schedule({ workDays: [1, 2, 3, 4, 5, 6] })], []);
    expect(q.quantity).toBe(6);
  });
});

describe("leave balances", () => {
  const upfront: LeavePolicyRule = { leaveTypeId: vac.id, annualEntitlement: 15, accrual: "upfront", carryForwardMax: 5, carryForwardExpiryMonths: 3 };

  it("computes available balance from the ledger", () => {
    const ledger = [
      entry({ amount: 15 }),
      entry({ kind: "carry_forward", amount: 4 }),
      entry({ kind: "taken", amount: -3, date: "2026-03-02" }),
      entry({ kind: "adjustment", amount: 1, date: "2026-04-01" }),
      entry({ kind: "taken", amount: -2, date: "2026-12-01" }),
      entry({ amount: 15, date: "2025-01-01" }),
    ];
    const b = computeBalance(vac, upfront, ledger, [], "2026-10-01", "2020-01-01");
    expect(b).toMatchObject({ allocated: 15, carriedForward: 4, taken: 3, scheduled: 2, adjustments: 1, available: 15 });
  });

  it("reduces taken when an approved request is reversed", () => {
    const ledger = [entry({ amount: 15 }), entry({ kind: "taken", amount: -3, date: "2026-03-02" }), entry({ kind: "reversal", amount: 3, date: "2026-03-03" })];
    expect(computeBalance(vac, upfront, ledger, [], "2026-10-01", "2020-01-01").available).toBe(15);
  });

  it("accrues monthly from the hire month", () => {
    const monthly = { ...upfront, accrual: "monthly" as const, annualEntitlement: 12 };
    expect(computeBalance(vac, monthly, [], [], "2026-10-15", "2020-01-01").accrued).toBe(10);
    expect(computeBalance(vac, monthly, [], [], "2026-10-15", "2026-07-20").accrued).toBe(4);
  });

  it("reports pending requests separately", () => {
    const pending = [{ leaveTypeId: vac.id, status: "pending", startDate: "2026-11-02", quantity: 2 }] as never;
    expect(computeBalance(vac, upfront, [entry({ amount: 15 })], pending, "2026-10-01", "2020-01-01")).toMatchObject({ pending: 2, available: 15 });
  });

  it("plans carry forward (capped) and the new allocation at year end", () => {
    const plan = planYearEnd("emp_1", vac, upfront, 8, 2027);
    expect(plan.map((p) => [p.kind, p.amount, p.date])).toEqual([
      ["carry_forward", 5, "2027-01-01"],
      ["allocation", 15, "2027-01-01"],
    ]);
  });

  it("expires unused carried-forward balance", () => {
    expect(planCarryForwardExpiry(upfront, 5, 2, 2027)).toEqual({ amount: -3, date: "2027-03-31" });
    expect(planCarryForwardExpiry(upfront, 5, 6, 2027)).toBeNull();
  });
});

describe("pay calendars", () => {
  const cal = (frequency: PayCalendar["frequency"]): PayCalendar => ({ frequency, anchorDate: "2026-01-05", payDateOffsetDays: 3, active: true });

  it("generates monthly and semi-monthly periods", () => {
    expect(periodContaining(cal("monthly"), "2026-02-10")).toMatchObject({ start: "2026-02-01", end: "2026-02-28", payDate: "2026-03-03" });
    expect(periodContaining(cal("semi_monthly"), "2026-02-10")).toMatchObject({ start: "2026-02-01", end: "2026-02-15" });
    expect(periodContaining(cal("semi_monthly"), "2026-02-20")).toMatchObject({ start: "2026-02-16", end: "2026-02-28" });
  });

  it("generates weekly and biweekly periods from the anchor, including before it", () => {
    expect(periodContaining(cal("biweekly"), "2026-01-20")).toMatchObject({ start: "2026-01-19", end: "2026-02-01" });
    expect(periodContaining(cal("weekly"), "2026-01-01")).toMatchObject({ start: "2025-12-29", end: "2026-01-04" });
    expect(nextPeriod(cal("biweekly"), { end: "2026-12-20" })).toMatchObject({ start: "2026-12-21", end: "2027-01-03" });
  });

  it("labels periods", () => {
    expect(periodLabel("monthly", "2026-10-01", "2026-10-31")).toBe("October 2026");
    expect(periodLabel("biweekly", "2026-12-28", "2027-01-10")).toBe("28 Dec 2026 – 10 Jan 2027");
  });
});

describe("pre-flight", () => {
  const result = (employeeId: string, net: number, warnings = [] as never[]) => ({
    employeeId,
    employee: { name: employeeId } as never,
    totals: { net } as never,
    warnings,
  });
  const emp = (id: string) => ({ id, firstName: "A", lastName: "B", dateOfBirth: "1990-01-01", address: { line1: "x", city: "y", country: "VG" }, email: "a@example.com", terminationDate: null });

  it("flags variance, absences without leave, and blocks approval until warnings are acknowledged", () => {
    const issues = runPreflight({
      run: { id: "run_1", type: "regular", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      results: [result("emp_1", 3000), result("emp_2", 1000)],
      employees: [emp("emp_1"), emp("emp_2")],
      previousResults: [{ employeeId: "emp_1", totals: { net: 2000 } as never }, { employeeId: "emp_2", totals: { net: 1000 } as never }],
      timesheets: [{ employeeId: "emp_2", date: "2026-10-05", absent: true, status: "approved" }],
      approvedLeave: [],
      varianceThreshold: 0.2,
      currency: "USD",
      requireApprovedRules: false,
    });
    expect(issues.map((i) => i.code)).toEqual(["ABSENCE_WITHOUT_LEAVE", "VARIANCE"]);
    expect(preflightSummary(issues, []).canApprove).toBe(false);
    expect(preflightSummary(issues, issues.map((i) => i.id)).canApprove).toBe(true);
  });

  it("escalates unapproved statutory rules to errors in production", () => {
    const w = { id: "RULE_NOT_APPROVED_SS:emp_1", severity: "warning", code: "RULE_NOT_APPROVED_SS", employeeId: "emp_1", message: "x" };
    const issues = runPreflight({
      run: { id: "run_1", type: "regular", periodStart: "2026-10-01", periodEnd: "2026-10-31" },
      results: [result("emp_1", 100, [w as never])],
      employees: [emp("emp_1")],
      previousResults: [],
      timesheets: [],
      approvedLeave: [],
      varianceThreshold: 0.2,
      currency: "USD",
      requireApprovedRules: true,
    });
    expect(issues[0].severity).toBe("error");
  });
});
