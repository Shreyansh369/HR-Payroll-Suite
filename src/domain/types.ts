/**
 * Core domain model. These types are shared by every repository implementation,
 * the service layer and the UI. They contain no persistence or framework concerns.
 */
import type { ISODate } from "@/lib/dates";
import type { RoundingMode } from "@/lib/money";
import type { Permission } from "@/domain/auth/permissions";

export type ID = string;
export type ISODateTime = string;
export type { ISODate };

// ---------------------------------------------------------------------------
// Shared value objects
// ---------------------------------------------------------------------------

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
}

export interface Timestamps {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface CompanyScoped extends Timestamps {
  id: ID;
  companyId: ID;
}

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export interface Organization extends Timestamps {
  id: ID;
  name: string;
  /** Demo organisations are never present in a production database. */
  kind: "demo" | "customer";
}

export type PayFrequency = "weekly" | "biweekly" | "semi_monthly" | "monthly";
export type RateBasis = "annual" | "monthly" | "semi_monthly" | "biweekly" | "weekly" | "daily" | "hourly";
export type PayType = "salary" | "hourly";
export type DailyRateMethod = "annual_working_days" | "fixed_days_per_month" | "calendar_days";
export type ProrationMethod = "working_days" | "calendar_days";

export interface PayrollSettings {
  jurisdiction: string;
  weeksPerYear: number;
  dailyRateMethod: DailyRateMethod;
  fixedDaysPerMonth: number;
  prorationMethod: ProrationMethod;
  overtimeMultiplier: number;
  hourlyFallbackToSchedule: boolean;
  roundingMode: RoundingMode;
  statutoryDateBasis: "period_end" | "pay_date";
  /** Warn when an employee's net pay changes by more than this fraction vs the previous run. */
  varianceWarningThreshold: number;
  /** Warn when non-statutory deductions exceed this fraction of gross pay. */
  maxDeductionRatio: number;
}

export interface PayCalendar {
  frequency: PayFrequency;
  /** First day of any period in the series (weekly/biweekly anchor). */
  anchorDate: ISODate;
  /** Pay date = period end + offset days. */
  payDateOffsetDays: number;
  active: boolean;
}

export interface Holiday {
  date: ISODate;
  name: string;
}

export type AccountKey =
  | "salary_expense"
  | "wages_expense"
  | "overtime_expense"
  | "bonus_expense"
  | "commission_expense"
  | "allowance_expense"
  | "employer_social_security_expense"
  | "employer_nhi_expense"
  | "employer_payroll_tax_expense"
  | "social_security_liability"
  | "nhi_liability"
  | "payroll_tax_liability"
  | "deductions_liability"
  | "loans_receivable"
  | "net_pay_clearing"
  | "bank";

export interface AccountMapping {
  key: AccountKey;
  accountName: string;
  accountCode: string;
}

export interface Company extends Timestamps {
  id: ID;
  organizationId: ID;
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  address: Address;
  contactEmail: string;
  contactPhone: string;
  employerIds: {
    socialSecurity: string;
    nhi: string;
    payrollTax: string;
  };
  currency: string;
  timezone: string;
  /** 1–12. */
  fiscalYearStartMonth: number;
  status: "active" | "inactive";
  branding: { accentColor: string; shortName: string };
  payrollSettings: PayrollSettings;
  payCalendars: PayCalendar[];
  holidays: Holiday[];
  accountMappings: AccountMapping[];
  /** Production go-live checklist state. */
  setup: { completedSteps: string[]; liveSince?: ISODate };
}

export interface Department extends CompanyScoped {
  name: string;
  code: string;
  parentId?: ID | null;
}

// ---------------------------------------------------------------------------
// Users, roles and access
// ---------------------------------------------------------------------------

export type DataScope = "all" | "team" | "self";

export interface Membership {
  companyId: ID;
  roleId: ID;
  scope: DataScope;
  /** Employee record linked to this user in this company (self-service, team scope). */
  employeeId?: ID | null;
  /** Explicitly assigned employees in addition to the reporting line (team scope). */
  assignedEmployeeIds?: ID[];
  /** Extra permissions granted on top of the role (e.g. salary.view for one HR manager). */
  extraPermissions?: Permission[];
}

export interface User extends Timestamps {
  id: ID;
  organizationId: ID;
  email: string;
  name: string;
  status: "active" | "disabled" | "invited";
  memberships: Membership[];
  lastLoginAt?: ISODateTime | null;
  /** Production only — never populated in demo data. */
  passwordHash?: string | null;
  twoFactor?: { enabled: boolean; secretEncrypted?: string | null } | null;
}

export interface Role extends Timestamps {
  id: ID;
  organizationId: ID;
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  system: boolean;
  /** Default data scope applied when this role is assigned. */
  defaultScope: DataScope;
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export type EmployeeStatus = "onboarding" | "active" | "on_leave" | "terminated" | "archived";
export type EmploymentType = "full_time" | "part_time" | "contract" | "temporary";
export type PayMethod = "bank_transfer" | "cheque" | "cash";

export interface EmployeeNote {
  id: ID;
  body: string;
  createdAt: ISODateTime;
  createdBy: ID;
  createdByName: string;
}

export interface Employee extends CompanyScoped {
  employeeCode: string;
  firstName: string;
  lastName: string;
  preferredName?: string;
  dateOfBirth: ISODate;
  email: string;
  phone: string;
  address: Address;
  emergencyContact: { name: string; relationship: string; phone: string };
  statutoryIds: { socialSecurityNumber: string; nhiNumber: string; taxId: string };
  status: EmployeeStatus;
  employmentType: EmploymentType;
  hireDate: ISODate;
  probationEndDate?: ISODate | null;
  terminationDate?: ISODate | null;
  terminationReason?: string | null;
  departmentId: ID | null;
  position: string;
  managerId: ID | null;
  workLocation: string;
  leavePolicyId: ID | null;
  payProfile: {
    payMethod: PayMethod;
    bankName: string;
    bankAccount: string;
  };
  notes: EmployeeNote[];
  userId?: ID | null;
}

export type EmploymentEventType =
  | "hire"
  | "promotion"
  | "transfer"
  | "department_change"
  | "manager_change"
  | "employment_type_change"
  | "position_change"
  | "termination"
  | "rehire";

export interface EmploymentEvent extends CompanyScoped {
  employeeId: ID;
  effectiveDate: ISODate;
  type: EmploymentEventType;
  departmentId?: ID | null;
  position?: string;
  managerId?: ID | null;
  employmentType?: EmploymentType;
  workLocation?: string;
  note: string;
  createdBy: ID;
}

export interface PayRate extends CompanyScoped {
  employeeId: ID;
  effectiveFrom: ISODate;
  payType: PayType;
  amount: number;
  basis: RateBasis;
  payFrequency: PayFrequency;
  reason: string;
  createdBy: ID;
}

export interface WorkSchedule extends CompanyScoped {
  employeeId: ID;
  effectiveFrom: ISODate;
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  hoursPerDay: number;
  reason: string;
  createdBy: ID;
}

export type EarningCategory = "regular" | "overtime" | "allowance" | "commission" | "bonus" | "adjustment" | "other";
export type DeductionCategory = "pension" | "health" | "union" | "garnishment" | "advance" | "loan" | "other";

export interface PayItem extends CompanyScoped {
  employeeId: ID;
  kind: "earning" | "deduction";
  category: EarningCategory | DeductionCategory;
  label: string;
  method: "fixed" | "percent_of_base";
  /** Fixed amount per pay period, or a fraction (0.05 = 5 %) of regular earnings. */
  amount: number;
  /** Earnings only: included in statutory/taxable remuneration. */
  taxable: boolean;
  /** Deductions only: deducted before statutory contributions are calculated. */
  pretax: boolean;
  startDate: ISODate;
  endDate?: ISODate | null;
  active: boolean;
}

export interface LoanRepayment {
  date: ISODate;
  amount: number;
  note: string;
  /** Payroll result that produced this repayment, or null for a manual repayment. */
  payrollResultId?: ID | null;
}

export interface Loan extends CompanyScoped {
  employeeId: ID;
  type: "loan" | "advance";
  reference: string;
  principal: number;
  installment: number;
  issuedDate: ISODate;
  /** First pay date from which installments are deducted. */
  startDate: ISODate;
  status: "active" | "paid" | "cancelled";
  note: string;
  manualRepayments: LoanRepayment[];
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export type LeaveCategory = "vacation" | "sick" | "unpaid_sick" | "unpaid" | "other";

export interface LeaveType extends CompanyScoped {
  code: string;
  name: string;
  category: LeaveCategory;
  paid: boolean;
  unit: "days" | "hours";
  /** When false, no balance is tracked (typical for unpaid leave). */
  tracksBalance: boolean;
  requiresApproval: boolean;
  color: string;
  active: boolean;
}

export interface LeavePolicyRule {
  leaveTypeId: ID;
  annualEntitlement: number;
  accrual: "upfront" | "monthly";
  carryForwardMax: number;
  /** Months after year end after which carried-forward balance expires (0 = never). */
  carryForwardExpiryMonths: number;
}

export interface LeavePolicy extends CompanyScoped {
  name: string;
  isDefault: boolean;
  rules: LeavePolicyRule[];
}

export type LeaveLedgerKind = "allocation" | "carry_forward" | "expiry" | "adjustment" | "taken" | "reversal";

export interface LeaveLedgerEntry extends CompanyScoped {
  employeeId: ID;
  leaveTypeId: ID;
  date: ISODate;
  /** Positive adds to the balance, negative consumes it. */
  amount: number;
  kind: LeaveLedgerKind;
  reason: string;
  requestId?: ID | null;
  createdBy: ID;
}

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequest extends CompanyScoped {
  employeeId: ID;
  leaveTypeId: ID;
  startDate: ISODate;
  endDate: ISODate;
  /** Only for single-day requests measured in hours. */
  hours?: number | null;
  /** Working days (or hours) consumed, computed from the employee schedule and holidays. */
  quantity: number;
  unit: "days" | "hours";
  reason: string;
  status: LeaveRequestStatus;
  decidedBy?: ID | null;
  decidedAt?: ISODateTime | null;
  decisionNote?: string | null;
  createdBy: ID;
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export type ApprovalStatus = "submitted" | "approved" | "rejected";

export interface TimesheetEntry extends CompanyScoped {
  employeeId: ID;
  date: ISODate;
  scheduledHours: number;
  workedHours: number;
  overtimeHours: number;
  lateMinutes: number;
  absent: boolean;
  status: ApprovalStatus;
  source: "manual" | "import" | "correction";
  note: string;
  approvedBy?: ID | null;
  approvedAt?: ISODateTime | null;
}

export interface AttendanceCorrection extends CompanyScoped {
  employeeId: ID;
  entryId?: ID | null;
  date: ISODate;
  requestedWorkedHours: number;
  requestedOvertimeHours: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: ID;
  decidedBy?: ID | null;
  decidedAt?: ISODateTime | null;
  decisionNote?: string | null;
}

// ---------------------------------------------------------------------------
// Documents and workflows
// ---------------------------------------------------------------------------

export type DocumentCategory =
  | "contract"
  | "identification"
  | "work_permit"
  | "certification"
  | "policy"
  | "tax"
  | "medical"
  | "performance"
  | "other";

export interface EmployeeDocument extends CompanyScoped {
  employeeId: ID | null;
  category: DocumentCategory;
  title: string;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  storageKey: string;
  expiryDate?: ISODate | null;
  /** `hr` = HR/admin only; `employee` = also visible to the employee in self-service. */
  visibility: "hr" | "employee";
  uploadedBy: ID;
  uploadedByName: string;
  notes: string;
}

export type WorkflowOwner = "hr" | "manager" | "employee" | "it" | "payroll";

export interface WorkflowTask {
  id: ID;
  title: string;
  owner: WorkflowOwner;
  category: "document" | "asset" | "access" | "payroll" | "training" | "general";
  dueDate: ISODate;
  done: boolean;
  doneAt?: ISODateTime | null;
  doneBy?: ID | null;
}

export interface Workflow extends CompanyScoped {
  employeeId: ID;
  type: "onboarding" | "offboarding";
  status: "in_progress" | "completed" | "cancelled";
  startDate: ISODate;
  /** Offboarding only. */
  terminationDate?: ISODate | null;
  terminationReason?: string | null;
  tasks: WorkflowTask[];
  completedAt?: ISODateTime | null;
  createdBy: ID;
}

// ---------------------------------------------------------------------------
// Statutory rules
// ---------------------------------------------------------------------------

export type StatutoryType = "social_security" | "nhi" | "payroll_tax" | "other";
export type AmountPeriod = "weekly" | "monthly" | "annual";

export interface StatutoryRule extends CompanyScoped {
  jurisdiction: string;
  type: StatutoryType;
  code: string;
  name: string;
  employeeRate: number;
  employerRate: number;
  /**
   * Optional employer-rate tiers by company headcount; the first tier whose
   * `maxEmployees` is ≥ headcount applies. Overrides `employerRate` when present.
   */
  employerRateTiers?: { maxEmployees: number | null; rate: number }[];
  base: "gross" | "taxable";
  ceiling?: { amount: number; period: AmountPeriod; mode: "per_period" | "annual_cumulative" } | null;
  threshold?: { amount: number; period: AmountPeriod; mode: "exempt_amount" | "minimum" } | null;
  eligibility?: { minAge?: number | null; maxAge?: number | null; exemptEmploymentTypes?: EmploymentType[] } | null;
  rounding: RoundingMode;
  effectiveFrom: ISODate;
  effectiveTo?: ISODate | null;
  source: { reference: string; url?: string; notes: string };
  status: "draft" | "demo" | "approved" | "retired";
  approval?: { approvedBy: ID; approvedByName: string; approvedAt: ISODateTime; note: string } | null;
  /** Rule this version supersedes, for traceability. */
  supersedesId?: ID | null;
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export type PayrollStatus = "draft" | "calculated" | "review" | "approved" | "finalized" | "locked";
export type PayrollRunType = "regular" | "off_cycle" | "correction" | "historical";

export interface PayrollInput {
  id: ID;
  employeeId: ID;
  kind: "earning" | "deduction";
  category: EarningCategory | DeductionCategory;
  label: string;
  /** Monetary amount. For overtime adjustments use `hours` instead. */
  amount?: number | null;
  hours?: number | null;
  taxable: boolean;
  pretax: boolean;
  note: string;
}

export type PreflightSeverity = "error" | "warning" | "info";

export interface PreflightIssue {
  id: string;
  severity: PreflightSeverity;
  code: string;
  employeeId?: ID | null;
  message: string;
}

export interface PayrollHistoryEntry {
  status: PayrollStatus | "reopened" | "corrected" | "created";
  at: ISODateTime;
  by: ID;
  byName: string;
  note?: string;
}

export interface PayrollTotals {
  employees: number;
  gross: number;
  preTaxDeductions: number;
  taxable: number;
  employeeStatutory: number;
  employerStatutory: number;
  postTaxDeductions: number;
  net: number;
  employerCost: number;
}

export interface PayrollRun extends CompanyScoped {
  type: PayrollRunType;
  payFrequency: PayFrequency;
  periodStart: ISODate;
  periodEnd: ISODate;
  payDate: ISODate;
  status: PayrollStatus;
  name: string;
  correctsRunId?: ID | null;
  correctionReason?: string | null;
  employeeIds: ID[];
  inputs: PayrollInput[];
  totals: PayrollTotals | null;
  preflight: { issues: PreflightIssue[]; ranAt: ISODateTime | null; acknowledged: string[] };
  calculationVersion: string | null;
  calculatedAt?: ISODateTime | null;
  /** Inputs changed after the last calculation. */
  stale: boolean;
  history: PayrollHistoryEntry[];
  createdBy: ID;
}

export type PayrollLineSection =
  | "earning"
  | "pre_tax_deduction"
  | "statutory_employee"
  | "statutory_employer"
  | "deduction"
  | "info";

export interface PayrollLine {
  code: string;
  section: PayrollLineSection;
  category: string;
  label: string;
  quantity?: number | null;
  unit?: "days" | "hours" | "periods" | null;
  rate?: number | null;
  amount: number;
  taxable: boolean;
  /** Human-readable formula, e.g. "2 days × $92.31 daily rate". */
  formula: string;
  source: "pay_rate" | "attendance" | "leave" | "recurring" | "one_time" | "loan" | "statutory" | "correction" | "historical";
  sourceRef?: ID | null;
}

export interface StatutoryApplication {
  ruleId: ID;
  code: string;
  name: string;
  type: StatutoryType;
  status: StatutoryRule["status"];
  effectiveFrom: ISODate;
  employeeRate: number;
  employerRate: number;
  base: number;
  exemptAmount: number;
  ceilingApplied: boolean;
  contributableBase: number;
  employeeAmount: number;
  employerAmount: number;
  explanation: string;
}

export interface PayrollEmployeeResult extends CompanyScoped {
  runId: ID;
  employeeId: ID;
  payDate: ISODate;
  periodStart: ISODate;
  periodEnd: ISODate;
  runType: PayrollRunType;
  employee: {
    code: string;
    name: string;
    departmentName: string;
    position: string;
    payType: PayType;
    employmentType: EmploymentType;
    payMethod: PayMethod;
    bankAccountMasked: string;
  };
  rates: {
    segments: { from: ISODate; to: ISODate; payType: PayType; amount: number; basis: RateBasis; periodAmount: number; dailyRate: number; hourlyRate: number }[];
    schedule: { workDays: number[]; hoursPerDay: number };
    methodology: string;
  };
  lines: PayrollLine[];
  totals: Omit<PayrollTotals, "employees">;
  statutory: StatutoryApplication[];
  workedDays: number;
  scheduledDays: number;
  warnings: PreflightIssue[];
  calculationVersion: string;
}

// ---------------------------------------------------------------------------
// Imports, audit, billing
// ---------------------------------------------------------------------------

export type ImportEntity =
  | "employees"
  | "departments"
  | "leave_balances"
  | "attendance"
  | "pay_components"
  | "deductions"
  | "loans"
  | "historical_payroll";

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportBatch extends CompanyScoped {
  entity: ImportEntity;
  fileName: string;
  status: "completed" | "completed_with_errors" | "failed";
  totals: { rows: number; imported: number; rejected: number; duplicates: number };
  errors: ImportRowError[];
  mapping: Record<string, string>;
  createdBy: ID;
  createdByName: string;
}

export interface AuditEvent {
  id: ID;
  organizationId: ID;
  companyId: ID | null;
  at: ISODateTime;
  actorId: ID;
  actorName: string;
  action: string;
  entityType: string;
  entityId: ID | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  meta?: { ip?: string | null; userAgent?: string | null } | null;
}

export type PlanKind = "demo" | "hosted" | "owned" | "none";
export type LicenseStatus = "trialing" | "active" | "past_due" | "canceled" | "owned" | "inactive";

export interface License extends Timestamps {
  id: ID;
  organizationId: ID;
  plan: PlanKind;
  status: LicenseStatus;
  activatedAt?: ISODateTime | null;
  trialStart?: ISODateTime | null;
  trialEnd?: ISODateTime | null;
  /** Ownership plan: software subscription waived until this date. */
  subscriptionFreeUntil?: ISODate | null;
  maintenanceUntil?: ISODate | null;
  employeeLimit?: number | null;
  features: string[];
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCheckoutSessionId?: string | null;
  lastEventId?: string | null;
}
