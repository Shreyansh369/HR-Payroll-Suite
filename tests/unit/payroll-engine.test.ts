import { describe, expect, it } from "vitest";
import { calculateEmployeePayroll, reviewColumns, sumTotals } from "@/domain/payroll/engine";
import { employee, input, leave, payItem, payrollInput, rate, schedule, timesheet, TEST_RULES, SETTINGS } from "./fixtures";
import type { Loan, StatutoryRule } from "@/domain/types";

const line = (r: ReturnType<typeof calculateEmployeePayroll>, category: string) => r.lines.filter((l) => l.category === category);
const codes = (r: ReturnType<typeof calculateEmployeePayroll>) => r.warnings.map((w) => w.code);

describe("acceptance scenario (TEST statutory values — replace with approved fixture)", () => {
  // Monthly salary 2,000 · 5 days / 40 hours · 2 days unpaid sick · 4 h overtime · bonus 100 · deduction 50
  const result = calculateEmployeePayroll(
    payrollInput({
      leaveRequests: [leave({ startDate: "2026-10-05", endDate: "2026-10-06" })],
      timesheets: [timesheet({ date: "2026-10-07", overtimeHours: 4 })],
      inputs: [
        input({ label: "Bonus", category: "bonus", amount: 100 }),
        input({ label: "Uniform", kind: "deduction", category: "other", amount: 50, taxable: false }),
      ],
    }),
  );

  it("produces the expected line amounts", () => {
    expect(line(result, "regular")[0].amount).toBe(2000);
    expect(line(result, "unpaid_leave")[0].amount).toBe(-184.62);
    expect(line(result, "unpaid_leave")[0].formula).toContain("2 day(s) × $92.31 daily rate");
    expect(line(result, "overtime")[0].amount).toBe(69.23);
    expect(line(result, "bonus")[0].amount).toBe(100);
  });

  it("produces the expected totals", () => {
    expect(result.totals.gross).toBe(1984.61);
    expect(result.statutory.map((s) => [s.code, s.employeeAmount, s.employerAmount])).toEqual([
      ["SS", 79.38, 89.31],
      ["NHI", 74.42, 74.42],
      ["PT", 92.1, 23.03],
    ]);
    expect(result.totals.employeeStatutory).toBe(245.9);
    expect(result.totals.postTaxDeductions).toBe(50);
    expect(result.totals.net).toBe(1688.71);
    expect(result.totals.employerCost).toBe(2171.37); // 1,984.61 + 89.31 + 74.42 + 23.03
  });

  it("explains every line", () => {
    for (const l of result.lines) expect(l.formula.length).toBeGreaterThan(3);
    expect(result.rates.methodology).toContain("52 weeks/year");
    expect(reviewColumns(result).unpaidLeave).toBe(-184.62);
  });
});

describe("determinism", () => {
  it("returns identical output for identical input regardless of record order", () => {
    const a = payrollInput({ payRates: [rate(), rate({ id: "rate_2", effectiveFrom: "2026-10-16", amount: 2400, createdAt: "2026-09-01T00:00:00.000Z" })] });
    const b = { ...a, payRates: [...a.payRates].reverse() };
    expect(calculateEmployeePayroll(a)).toEqual(calculateEmployeePayroll(b));
    expect(JSON.stringify(calculateEmployeePayroll(a))).toBe(JSON.stringify(calculateEmployeePayroll(a)));
  });
});

describe("proration", () => {
  it("prorates an employee who starts mid-period by working days", () => {
    const r = calculateEmployeePayroll(payrollInput({ employee: employee({ hireDate: "2026-10-15" }), payRates: [rate({ effectiveFrom: "2026-10-15" })], schedules: [schedule({ effectiveFrom: "2026-10-15" })] }));
    expect(r.totals.gross).toBe(1090.91); // 12 of 22 working days
    expect(codes(r)).toContain("STARTED_IN_PERIOD");
  });

  it("prorates an employee who terminates mid-period", () => {
    const r = calculateEmployeePayroll(payrollInput({ employee: employee({ terminationDate: "2026-10-09" }) }));
    expect(r.totals.gross).toBe(636.36); // 7 of 22
    expect(codes(r)).toContain("TERMINATED_IN_PERIOD");
  });

  it("splits pay across a mid-period salary change", () => {
    const r = calculateEmployeePayroll(payrollInput({ payRates: [rate(), rate({ id: "rate_2", effectiveFrom: "2026-10-16", amount: 2400 })] }));
    expect(line(r, "regular").map((l) => l.amount)).toEqual([1000, 1200]);
    expect(r.totals.gross).toBe(2200);
    expect(codes(r)).toContain("RATE_CHANGE_IN_PERIOD");
    expect(r.rates.segments).toHaveLength(2);
  });

  it("supports calendar-day proration", () => {
    const r = calculateEmployeePayroll(payrollInput({ employee: employee({ hireDate: "2026-10-16" }), settings: { ...SETTINGS, prorationMethod: "calendar_days" } }));
    expect(r.totals.gross).toBe(1032.26); // 16 of 31 calendar days
  });
});

describe("leave", () => {
  it("counts only the portion of leave that falls in the period", () => {
    const r = calculateEmployeePayroll(payrollInput({ leaveRequests: [leave({ startDate: "2026-09-28", endDate: "2026-10-02" })] }));
    expect(line(r, "unpaid_leave")[0].quantity).toBe(2);
    expect(line(r, "unpaid_leave")[0].formula).toContain("portion within period");
  });

  it("does not deduct on public holidays or non-working days", () => {
    const r = calculateEmployeePayroll(
      payrollInput({ leaveRequests: [leave({ startDate: "2026-10-09", endDate: "2026-10-12" })], holidays: [{ date: "2026-10-12", name: "Holiday" }] }),
    );
    expect(line(r, "unpaid_leave")[0].quantity).toBe(1);
  });

  it("caps unpaid leave at regular pay", () => {
    const r = calculateEmployeePayroll(payrollInput({ leaveRequests: [leave({ startDate: "2026-10-01", endDate: "2026-10-31" })] }));
    expect(r.totals.gross).toBe(0);
    expect(line(r, "unpaid_leave")[0].formula).toContain("limited to regular pay");
  });

  it("ignores pending leave and records paid leave as information", () => {
    const r = calculateEmployeePayroll(
      payrollInput({ leaveRequests: [leave({ status: "pending" }), leave({ id: "lvr_2", leaveTypeId: "lvt_vac", startDate: "2026-10-20", endDate: "2026-10-22" })] }),
    );
    expect(line(r, "unpaid_leave")).toHaveLength(0);
    expect(line(r, "paid_leave")[0].quantity).toBe(3);
    expect(r.totals.gross).toBe(2000);
  });

  it("supports hour-based unpaid leave", () => {
    const r = calculateEmployeePayroll(payrollInput({ leaveRequests: [leave({ startDate: "2026-10-07", endDate: "2026-10-07", hours: 4 })] }));
    expect(line(r, "unpaid_leave")[0].amount).toBe(-46.15);
  });
});

describe("hourly employees and attendance", () => {
  const hourly = { payRates: [rate({ payType: "hourly", amount: 15, basis: "hourly" })] };

  it("pays approved timesheet hours and overtime", () => {
    const r = calculateEmployeePayroll(
      payrollInput({
        ...hourly,
        timesheets: [timesheet({ date: "2026-10-05" }), timesheet({ date: "2026-10-06", overtimeHours: 2 }), timesheet({ date: "2026-10-07", workedHours: 6 })],
      }),
    );
    expect(line(r, "regular")[0].amount).toBe(330);
    expect(line(r, "overtime")[0].amount).toBe(45);
    expect(r.totals.gross).toBe(375);
  });

  it("does not pay unapproved hours or overtime and warns", () => {
    const r = calculateEmployeePayroll(payrollInput({ ...hourly, timesheets: [timesheet({ date: "2026-10-05" }), timesheet({ date: "2026-10-06", status: "submitted", overtimeHours: 3 })] }));
    expect(r.totals.gross).toBe(120);
    expect(codes(r)).toEqual(expect.arrayContaining(["UNAPPROVED_TIMESHEETS", "UNAPPROVED_OVERTIME"]));
  });

  it("warns when no timesheet exists and falls back to schedule only when configured", () => {
    expect(codes(calculateEmployeePayroll(payrollInput(hourly)))).toContain("MISSING_TIMESHEET");
    const r = calculateEmployeePayroll(payrollInput({ ...hourly, settings: { ...SETTINGS, hourlyFallbackToSchedule: true } }));
    expect(r.totals.gross).toBe(22 * 8 * 15);
  });

  it("does not deduct unpaid leave from hourly employees", () => {
    const r = calculateEmployeePayroll(payrollInput({ ...hourly, timesheets: [timesheet({ date: "2026-10-07" })], leaveRequests: [leave()] }));
    expect(line(r, "unpaid_leave")[0].amount).toBe(0);
  });
});

describe("earnings and deductions", () => {
  it("applies recurring percentage allowances and pre-tax deductions", () => {
    const r = calculateEmployeePayroll(
      payrollInput({
        payItems: [
          payItem({ label: "Housing", method: "percent_of_base", amount: 0.1 }),
          payItem({ id: "item_2", kind: "deduction", category: "pension", label: "Pension", amount: 100, pretax: true, taxable: false }),
        ],
      }),
    );
    expect(line(r, "allowance")[0].amount).toBe(200);
    expect(r.totals.gross).toBe(2200);
    expect(r.totals.preTaxDeductions).toBe(100);
    expect(r.totals.taxable).toBe(2100);
    const ss = r.statutory.find((s) => s.code === "SS")!;
    const pt = r.statutory.find((s) => s.code === "PT")!;
    expect(ss.base).toBe(2200); // gross base
    expect(pt.base).toBe(2100); // taxable base
  });

  it("excludes non-taxable earnings from statutory bases", () => {
    const r = calculateEmployeePayroll(payrollInput({ inputs: [input({ label: "Reimbursement", category: "other", amount: 300, taxable: false })] }));
    expect(r.totals.gross).toBe(2300);
    expect(r.statutory.find((s) => s.code === "SS")!.base).toBe(2000);
  });

  it("applies commissions and overtime adjustments", () => {
    const r = calculateEmployeePayroll(payrollInput({ inputs: [input({ label: "Commission", category: "commission", amount: 412.5 }), input({ label: "OT adj", category: "overtime", hours: 2, amount: null })] }));
    expect(line(r, "commission")[0].amount).toBe(412.5);
    expect(line(r, "overtime")[0].amount).toBe(34.62);
  });

  it("deducts loan installments without exceeding the outstanding balance", () => {
    const loan: Loan = { id: "loan_1", companyId: "co_test", createdAt: "", updatedAt: "", employeeId: "emp_1", type: "loan", reference: "L-1", principal: 500, installment: 100, issuedDate: "2026-01-01", startDate: "2026-02-01", status: "active", note: "", manualRepayments: [] };
    const r = calculateEmployeePayroll(payrollInput({ loans: [{ loan, outstanding: 40 }] }));
    expect(line(r, "loan")[0].amount).toBe(40);
    expect(r.totals.postTaxDeductions).toBe(40);
  });

  it("flags negative net pay as an error and excessive deductions as a warning", () => {
    const r = calculateEmployeePayroll(payrollInput({ inputs: [input({ kind: "deduction", category: "other", label: "Big", amount: 5000 })] }));
    expect(r.totals.net).toBeLessThan(0);
    expect(r.warnings.find((w) => w.code === "NEGATIVE_NET")?.severity).toBe("error");
    expect(codes(r)).toContain("EXCESSIVE_DEDUCTIONS");
  });

  it("flags missing rate and schedule as errors", () => {
    const r = calculateEmployeePayroll(payrollInput({ payRates: [], schedules: [] }));
    expect(r.warnings.filter((w) => w.severity === "error").map((w) => w.code)).toEqual(["MISSING_RATE", "MISSING_SCHEDULE"]);
  });
});

describe("statutory", () => {
  it("applies a per-period ceiling for high earners", () => {
    const r = calculateEmployeePayroll(payrollInput({ payRates: [rate({ amount: 8000 })] }));
    const ss = r.statutory.find((s) => s.code === "SS")!;
    expect(ss.contributableBase).toBe(5000);
    expect(ss.employeeAmount).toBe(200);
    expect(ss.ceilingApplied).toBe(true);
    expect(codes(r)).toContain("CEILING_REACHED_SS");
  });

  it("applies an annual cumulative ceiling using year-to-date contributions", () => {
    const rules: StatutoryRule[] = [{ ...TEST_RULES[0], ceiling: { amount: 30000, period: "annual", mode: "annual_cumulative" } }];
    const r = calculateEmployeePayroll(payrollInput({ payRates: [rate({ amount: 4000 })], statutoryRules: rules, ytdContributable: { SS: 28000 } }));
    expect(r.statutory[0].contributableBase).toBe(2000);
  });

  it("applies age eligibility", () => {
    const r = calculateEmployeePayroll(payrollInput({ employee: employee({ dateOfBirth: "1955-01-01" }) }));
    const ss = r.statutory.find((s) => s.code === "SS")!;
    expect(ss.employeeAmount).toBe(0);
    expect(ss.explanation).toContain("above maximum 65");
  });

  it("uses the rule in force for the period across an effective-date transition", () => {
    const old: StatutoryRule = { ...TEST_RULES[1], id: "rule_old", effectiveTo: "2026-12-31", employeeRate: 0.03 };
    const next: StatutoryRule = { ...TEST_RULES[1], id: "rule_new", effectiveFrom: "2027-01-01", employeeRate: 0.05 };
    const dec = calculateEmployeePayroll(payrollInput({ statutoryRules: [old, next], period: { start: "2026-12-01", end: "2026-12-31", payDate: "2026-12-30", frequency: "monthly" } }));
    const jan = calculateEmployeePayroll(payrollInput({ statutoryRules: [old, next], period: { start: "2027-01-01", end: "2027-01-31", payDate: "2027-01-29", frequency: "monthly" } }));
    expect(dec.statutory[0].ruleId).toBe("rule_old");
    expect(dec.statutory[0].employeeAmount).toBe(60);
    expect(jan.statutory[0].ruleId).toBe("rule_new");
    expect(jan.statutory[0].employeeAmount).toBe(100);
  });

  it("selects by pay date when configured, for a period that crosses the year boundary", () => {
    const old: StatutoryRule = { ...TEST_RULES[1], id: "rule_old", effectiveTo: "2026-12-31" };
    const next: StatutoryRule = { ...TEST_RULES[1], id: "rule_new", effectiveFrom: "2027-01-01" };
    const period = { start: "2026-12-21", end: "2027-01-03", payDate: "2027-01-08", frequency: "biweekly" as const };
    const byEnd = calculateEmployeePayroll(payrollInput({ statutoryRules: [old, next], period }));
    const byPay = calculateEmployeePayroll(payrollInput({ statutoryRules: [old, next], period: { ...period, end: "2026-12-31", start: "2026-12-18" }, settings: { ...SETTINGS, statutoryDateBasis: "pay_date" } }));
    expect(byEnd.statutory[0].ruleId).toBe("rule_new");
    expect(byPay.statutory[0].ruleId).toBe("rule_new");
  });

  it("warns when a rule is not approved", () => {
    const r = calculateEmployeePayroll(payrollInput({ statutoryRules: TEST_RULES.map((x) => ({ ...x, status: "demo" as const })) }));
    expect(codes(r)).toContain("RULE_NOT_APPROVED_SS");
  });
});

describe("corrections and totals", () => {
  it("correction runs calculate only explicit adjustment lines", () => {
    const r = calculateEmployeePayroll(payrollInput({ runType: "correction", inputs: [input({ label: "Missed bonus", category: "adjustment", amount: 250 })] }));
    expect(r.lines.filter((l) => l.section === "earning")).toHaveLength(1);
    expect(r.totals.gross).toBe(250);
    expect(r.lines[0].source).toBe("correction");
    expect(r.statutory.find((s) => s.code === "SS")!.employeeAmount).toBe(10);
  });

  it("sums run totals", () => {
    const a = calculateEmployeePayroll(payrollInput());
    const t = sumTotals([a, a]);
    expect(t.employees).toBe(2);
    expect(t.gross).toBe(4000);
  });
});
