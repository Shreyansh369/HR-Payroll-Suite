/**
 * Builders for engine tests. Statutory values here are TEST VALUES chosen to
 * exercise the engine; they are not BVI rates and must never be used as legal truth.
 * Replace `ACCEPTANCE_*` expectations with client/accountant-approved fixtures.
 */
import type {
  Employee,
  LeaveRequest,
  LeaveType,
  PayItem,
  PayRate,
  PayrollInput,
  PayrollSettings,
  StatutoryRule,
  TimesheetEntry,
  WorkSchedule,
} from "@/domain/types";
import type { EmployeePayrollInput } from "@/domain/payroll/engine";

const TS = "2026-01-01T00:00:00.000Z";
const base = { companyId: "co_test", createdAt: TS, updatedAt: TS };

export const SETTINGS: PayrollSettings = {
  jurisdiction: "VG",
  weeksPerYear: 52,
  dailyRateMethod: "annual_working_days",
  fixedDaysPerMonth: 21.67,
  prorationMethod: "working_days",
  overtimeMultiplier: 1.5,
  hourlyFallbackToSchedule: false,
  roundingMode: "half_up",
  statutoryDateBasis: "period_end",
  varianceWarningThreshold: 0.2,
  maxDeductionRatio: 0.5,
};

export function employee(over: Partial<Employee> = {}): EmployeePayrollInput["employee"] {
  return {
    id: "emp_1",
    employeeCode: "E-001",
    firstName: "Test",
    lastName: "Person",
    preferredName: "",
    dateOfBirth: "1990-05-10",
    hireDate: "2020-01-06",
    terminationDate: null,
    employmentType: "full_time",
    position: "Analyst",
    statutoryIds: { socialSecurityNumber: "SS-1", nhiNumber: "NHI-1", taxId: "T-1" },
    payProfile: { payMethod: "bank_transfer", bankName: "Test Bank", bankAccount: "12345678" },
    ...over,
  };
}

export function rate(over: Partial<PayRate> = {}): PayRate {
  return {
    ...base,
    id: over.id ?? "rate_1",
    employeeId: "emp_1",
    effectiveFrom: "2020-01-06",
    payType: "salary",
    amount: 2000,
    basis: "monthly",
    payFrequency: "monthly",
    reason: "Hire",
    createdBy: "usr_1",
    ...over,
  };
}

export function schedule(over: Partial<WorkSchedule> = {}): WorkSchedule {
  return {
    ...base,
    id: over.id ?? "sch_1",
    employeeId: "emp_1",
    effectiveFrom: "2020-01-06",
    workDays: [1, 2, 3, 4, 5],
    hoursPerDay: 8,
    reason: "Standard",
    createdBy: "usr_1",
    ...over,
  };
}

export const LEAVE_TYPES: LeaveType[] = [
  { ...base, id: "lvt_vac", code: "VAC", name: "Vacation", category: "vacation", paid: true, unit: "days", tracksBalance: true, requiresApproval: true, color: "#2f6f5e", active: true },
  { ...base, id: "lvt_sick", code: "SICK", name: "Sick", category: "sick", paid: true, unit: "days", tracksBalance: true, requiresApproval: true, color: "#9a6b1f", active: true },
  { ...base, id: "lvt_usick", code: "USICK", name: "Unpaid sick leave", category: "unpaid_sick", paid: false, unit: "days", tracksBalance: false, requiresApproval: true, color: "#8a3b3b", active: true },
  { ...base, id: "lvt_unpaid", code: "UNPAID", name: "Unpaid leave", category: "unpaid", paid: false, unit: "days", tracksBalance: false, requiresApproval: true, color: "#555", active: true },
];

export function leave(over: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    ...base,
    id: over.id ?? "lvr_1",
    employeeId: "emp_1",
    leaveTypeId: "lvt_usick",
    startDate: "2026-10-05",
    endDate: "2026-10-06",
    quantity: 2,
    unit: "days",
    reason: "",
    status: "approved",
    createdBy: "usr_1",
    ...over,
  };
}

export function timesheet(over: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    ...base,
    id: over.id ?? `ts_${over.date ?? "x"}`,
    employeeId: "emp_1",
    date: "2026-10-07",
    scheduledHours: 8,
    workedHours: 8,
    overtimeHours: 0,
    lateMinutes: 0,
    absent: false,
    status: "approved",
    source: "manual",
    note: "",
    ...over,
  };
}

export function input(over: Partial<PayrollInput>): PayrollInput {
  return {
    id: over.id ?? `inp_${over.label ?? "x"}`,
    employeeId: "emp_1",
    kind: "earning",
    category: "bonus",
    label: "Bonus",
    amount: 0,
    hours: null,
    taxable: true,
    pretax: false,
    note: "",
    ...over,
  };
}

export function payItem(over: Partial<PayItem>): PayItem {
  return {
    ...base,
    id: over.id ?? "item_1",
    employeeId: "emp_1",
    kind: "earning",
    category: "allowance",
    label: "Allowance",
    method: "fixed",
    amount: 0,
    taxable: true,
    pretax: false,
    startDate: "2020-01-01",
    endDate: null,
    active: true,
    ...over,
  };
}

function rule(over: Partial<StatutoryRule>): StatutoryRule {
  return {
    ...base,
    id: over.id ?? `rule_${over.code}`,
    jurisdiction: "TEST",
    type: "other",
    code: "X",
    name: "Test rule",
    employeeRate: 0,
    employerRate: 0,
    base: "gross",
    ceiling: null,
    threshold: null,
    eligibility: null,
    rounding: "half_up",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    source: { reference: "Unit test fixture — not a legal rate", notes: "" },
    status: "approved",
    approval: null,
    ...over,
  };
}

/** TEST VALUES ONLY. */
export const TEST_RULES: StatutoryRule[] = [
  rule({ code: "SS", type: "social_security", name: "Test Social Security", employeeRate: 0.04, employerRate: 0.045, ceiling: { amount: 5000, period: "monthly", mode: "per_period" }, eligibility: { maxAge: 65 } }),
  rule({ code: "NHI", type: "nhi", name: "Test NHI", employeeRate: 0.0375, employerRate: 0.0375 }),
  rule({ code: "PT", type: "payroll_tax", name: "Test Payroll Tax", employeeRate: 0.08, employerRate: 0.02, base: "taxable", threshold: { amount: 10000, period: "annual", mode: "exempt_amount" } }),
];

export function payrollInput(over: Partial<EmployeePayrollInput> = {}): EmployeePayrollInput {
  return {
    employee: employee(),
    departmentName: "Finance",
    period: { start: "2026-10-01", end: "2026-10-31", payDate: "2026-10-30", frequency: "monthly" },
    runType: "regular",
    payRates: [rate()],
    schedules: [schedule()],
    payItems: [],
    inputs: [],
    timesheets: [],
    leaveRequests: [],
    leaveTypes: LEAVE_TYPES,
    loans: [],
    statutoryRules: TEST_RULES,
    ytdContributable: {},
    headcount: 30,
    holidays: [],
    settings: SETTINGS,
    currency: "USD",
    ...over,
  };
}
