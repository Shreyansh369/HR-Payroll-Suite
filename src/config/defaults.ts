/**
 * Default, data-driven configuration applied when a company is created.
 * Everything here can be changed per company in Settings.
 */
import type {
  AccountKey,
  AccountMapping,
  DocumentCategory,
  LeaveCategory,
  PayrollSettings,
  StatutoryRule,
  WorkflowOwner,
  WorkflowTask,
} from "@/domain/types";

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
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

export const DEFAULT_LEAVE_TYPES: {
  code: string;
  name: string;
  category: LeaveCategory;
  paid: boolean;
  unit: "days" | "hours";
  tracksBalance: boolean;
  color: string;
  entitlement: number;
  accrual: "upfront" | "monthly";
  carryForwardMax: number;
  carryForwardExpiryMonths: number;
}[] = [
  { code: "VAC", name: "Vacation", category: "vacation", paid: true, unit: "days", tracksBalance: true, color: "#2f6f5e", entitlement: 15, accrual: "upfront", carryForwardMax: 5, carryForwardExpiryMonths: 3 },
  { code: "SICK", name: "Sick leave", category: "sick", paid: true, unit: "days", tracksBalance: true, color: "#a0711f", entitlement: 10, accrual: "upfront", carryForwardMax: 0, carryForwardExpiryMonths: 0 },
  { code: "USICK", name: "Unpaid sick leave", category: "unpaid_sick", paid: false, unit: "days", tracksBalance: false, color: "#9b4a3c", entitlement: 0, accrual: "upfront", carryForwardMax: 0, carryForwardExpiryMonths: 0 },
  { code: "UNPAID", name: "Unpaid leave", category: "unpaid", paid: false, unit: "days", tracksBalance: false, color: "#5d6470", entitlement: 0, accrual: "upfront", carryForwardMax: 0, carryForwardExpiryMonths: 0 },
  { code: "BRV", name: "Bereavement", category: "other", paid: true, unit: "days", tracksBalance: true, color: "#56607a", entitlement: 3, accrual: "upfront", carryForwardMax: 0, carryForwardExpiryMonths: 0 },
];

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
  salary_expense: "Salary expense",
  wages_expense: "Hourly wages expense",
  overtime_expense: "Overtime expense",
  bonus_expense: "Bonus expense",
  commission_expense: "Commission expense",
  allowance_expense: "Allowances expense",
  employer_social_security_expense: "Employer Social Security expense",
  employer_nhi_expense: "Employer NHI expense",
  employer_payroll_tax_expense: "Employer Payroll Tax expense",
  social_security_liability: "Social Security payable",
  nhi_liability: "NHI payable",
  payroll_tax_liability: "Payroll Tax payable",
  deductions_liability: "Employee deductions payable",
  loans_receivable: "Employee loans & advances receivable",
  net_pay_clearing: "Net pay clearing",
  bank: "Bank / cash",
};

export const DEFAULT_ACCOUNT_MAPPINGS: AccountMapping[] = [
  { key: "salary_expense", accountName: "Payroll Expenses:Salaries", accountCode: "6010" },
  { key: "wages_expense", accountName: "Payroll Expenses:Wages", accountCode: "6020" },
  { key: "overtime_expense", accountName: "Payroll Expenses:Overtime", accountCode: "6030" },
  { key: "bonus_expense", accountName: "Payroll Expenses:Bonuses", accountCode: "6040" },
  { key: "commission_expense", accountName: "Payroll Expenses:Commissions", accountCode: "6050" },
  { key: "allowance_expense", accountName: "Payroll Expenses:Allowances", accountCode: "6060" },
  { key: "employer_social_security_expense", accountName: "Payroll Expenses:Employer Social Security", accountCode: "6110" },
  { key: "employer_nhi_expense", accountName: "Payroll Expenses:Employer NHI", accountCode: "6120" },
  { key: "employer_payroll_tax_expense", accountName: "Payroll Expenses:Employer Payroll Tax", accountCode: "6130" },
  { key: "social_security_liability", accountName: "Payroll Liabilities:Social Security", accountCode: "2210" },
  { key: "nhi_liability", accountName: "Payroll Liabilities:NHI", accountCode: "2220" },
  { key: "payroll_tax_liability", accountName: "Payroll Liabilities:Payroll Tax", accountCode: "2230" },
  { key: "deductions_liability", accountName: "Payroll Liabilities:Employee Deductions", accountCode: "2240" },
  { key: "loans_receivable", accountName: "Employee Advances", accountCode: "1250" },
  { key: "net_pay_clearing", accountName: "Payroll Clearing", accountCode: "2290" },
  { key: "bank", accountName: "Operating Account", accountCode: "1010" },
];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  contract: "Employment contract",
  identification: "Identification",
  work_permit: "Work permit",
  certification: "Certification",
  policy: "Policy acknowledgement",
  tax: "Tax & statutory",
  medical: "Medical",
  performance: "Performance",
  other: "Other",
};

export const WORKFLOW_OWNER_LABELS: Record<WorkflowOwner, string> = {
  hr: "HR",
  manager: "Manager",
  employee: "Employee",
  it: "IT",
  payroll: "Payroll",
};

type TaskTemplate = Omit<WorkflowTask, "id" | "dueDate" | "done" | "doneAt" | "doneBy"> & { offsetDays: number };

export const ONBOARDING_TEMPLATE: TaskTemplate[] = [
  { title: "Signed employment contract on file", owner: "hr", category: "document", offsetDays: -3 },
  { title: "Copy of passport or national ID", owner: "employee", category: "document", offsetDays: 0 },
  { title: "Work permit verified (if applicable)", owner: "hr", category: "document", offsetDays: 0 },
  { title: "Social Security and NHI numbers recorded", owner: "payroll", category: "payroll", offsetDays: 3 },
  { title: "Bank details recorded for payroll", owner: "payroll", category: "payroll", offsetDays: 3 },
  { title: "Laptop and accounts provisioned", owner: "it", category: "access", offsetDays: -1 },
  { title: "Building access card issued", owner: "hr", category: "asset", offsetDays: 0 },
  { title: "First-week plan and introductions", owner: "manager", category: "general", offsetDays: 0 },
  { title: "Employee handbook acknowledged", owner: "employee", category: "training", offsetDays: 7 },
  { title: "Probation review scheduled", owner: "manager", category: "general", offsetDays: 14 },
];

export const OFFBOARDING_TEMPLATE: TaskTemplate[] = [
  { title: "Resignation or termination letter on file", owner: "hr", category: "document", offsetDays: -10 },
  { title: "Exit interview", owner: "hr", category: "general", offsetDays: -3 },
  { title: "Handover of responsibilities", owner: "manager", category: "general", offsetDays: -2 },
  { title: "Laptop and equipment returned", owner: "it", category: "asset", offsetDays: 0 },
  { title: "Access card and keys returned", owner: "hr", category: "asset", offsetDays: 0 },
  { title: "System access deactivated", owner: "it", category: "access", offsetDays: 0 },
  { title: "Outstanding loans and advances settled", owner: "payroll", category: "payroll", offsetDays: 0 },
  { title: "Final pay and unused leave reviewed", owner: "payroll", category: "payroll", offsetDays: 0 },
  { title: "Employment certificate issued", owner: "hr", category: "document", offsetDays: 5 },
];

/**
 * ILLUSTRATIVE statutory rules for the demo and as a starting template.
 * These are NOT verified rates. Production activation requires values supplied
 * and approved by the customer's accountant (see DECISIONS.md D-007).
 */
export function illustrativeStatutoryRules(): Omit<StatutoryRule, "id" | "companyId" | "createdAt" | "updatedAt">[] {
  const source = {
    reference: "Illustrative values for demonstration only — not verified",
    url: "",
    notes: "Replace with rates confirmed by your accountant against current official publications before running live payroll.",
  };
  return [
    {
      jurisdiction: "VG",
      type: "social_security",
      code: "SS",
      name: "Social Security",
      employeeRate: 0.045,
      employerRate: 0.045,
      base: "gross",
      ceiling: { amount: 4000, period: "monthly", mode: "per_period" },
      threshold: null,
      eligibility: { minAge: 16, maxAge: 65 },
      rounding: "half_up",
      effectiveFrom: "2024-01-01",
      effectiveTo: "2026-12-31",
      source,
      status: "demo",
      approval: null,
    },
    {
      jurisdiction: "VG",
      type: "social_security",
      code: "SS",
      name: "Social Security",
      employeeRate: 0.045,
      employerRate: 0.045,
      base: "gross",
      ceiling: { amount: 4500, period: "monthly", mode: "per_period" },
      threshold: null,
      eligibility: { minAge: 16, maxAge: 65 },
      rounding: "half_up",
      effectiveFrom: "2027-01-01",
      effectiveTo: null,
      source: { ...source, notes: "Draft of a future rate change, to show effective-dated rules. Not in force until approved." },
      status: "draft",
      approval: null,
    },
    {
      jurisdiction: "VG",
      type: "nhi",
      code: "NHI",
      name: "National Health Insurance",
      employeeRate: 0.0375,
      employerRate: 0.0375,
      base: "gross",
      ceiling: { amount: 10000, period: "monthly", mode: "per_period" },
      threshold: null,
      eligibility: null,
      rounding: "half_up",
      effectiveFrom: "2024-01-01",
      effectiveTo: null,
      source,
      status: "demo",
      approval: null,
    },
    {
      jurisdiction: "VG",
      type: "payroll_tax",
      code: "PT",
      name: "Payroll Tax",
      employeeRate: 0.08,
      employerRate: 0.02,
      employerRateTiers: [
        { maxEmployees: 7, rate: 0.02 },
        { maxEmployees: null, rate: 0.06 },
      ],
      base: "taxable",
      ceiling: null,
      threshold: { amount: 10000, period: "annual", mode: "exempt_amount" },
      eligibility: null,
      rounding: "half_up",
      effectiveFrom: "2024-01-01",
      effectiveTo: null,
      source,
      status: "demo",
      approval: null,
    },
  ];
}
