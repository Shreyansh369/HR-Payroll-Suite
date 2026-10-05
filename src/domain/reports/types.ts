import type { Permission } from "@/domain/auth/permissions";

export type ColumnType = "text" | "money" | "number" | "date" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Optional: hide on narrow screens. */
  priority?: 1 | 2 | 3;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportResult {
  id: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  generatedAt: string;
  companyName: string;
  currency: string;
  notes: string[];
}

export type ReportParam = "run" | "year" | "range" | "asOf";

export interface ReportDefinition {
  id: string;
  title: string;
  category: "payroll" | "statutory" | "hr";
  description: string;
  permission: Permission;
  params: ReportParam[];
}

export const REPORTS: ReportDefinition[] = [
  { id: "payroll_register", title: "Payroll register", category: "payroll", description: "Every employee in a payroll run with earnings, deductions, statutory and net pay.", permission: "reports.payroll", params: ["run"] },
  { id: "payroll_summary", title: "Payroll summary", category: "payroll", description: "Totals for each finalized payroll in a year.", permission: "reports.payroll", params: ["year"] },
  { id: "gross_to_net", title: "Gross-to-net", category: "payroll", description: "How each employee's gross pay becomes net pay for a run.", permission: "reports.payroll", params: ["run"] },
  { id: "earnings_history", title: "Earnings history", category: "payroll", description: "Every earning line paid in finalized payrolls in a date range.", permission: "reports.payroll", params: ["range"] },
  { id: "deduction_history", title: "Deduction history", category: "payroll", description: "Every deduction and employee statutory line in a date range.", permission: "reports.payroll", params: ["range"] },
  { id: "ytd", title: "Year-to-date", category: "payroll", description: "Year-to-date gross, statutory, deductions and net per employee.", permission: "reports.payroll", params: ["year"] },
  { id: "employer_cost", title: "Employer payroll cost", category: "payroll", description: "Gross pay plus employer contributions, by department and employee.", permission: "reports.payroll", params: ["range"] },
  { id: "corrections", title: "Payroll corrections", category: "payroll", description: "Correction runs with their reasons and adjustment lines.", permission: "reports.payroll", params: ["year"] },
  { id: "loans", title: "Loans & advances", category: "payroll", description: "Principal, repayments and outstanding balance for each loan or advance.", permission: "reports.payroll", params: [] },
  { id: "payroll_audit", title: "Payroll audit trail", category: "payroll", description: "Payroll calculations, approvals, locks, reopenings and corrections.", permission: "reports.payroll", params: ["range"] },
  { id: "social_security", title: "Social Security contributions", category: "statutory", description: "Employee and employer Social Security per employee for a date range.", permission: "reports.statutory", params: ["range"] },
  { id: "nhi", title: "NHI contributions", category: "statutory", description: "Employee and employer National Health Insurance per employee.", permission: "reports.statutory", params: ["range"] },
  { id: "payroll_tax", title: "Payroll Tax", category: "statutory", description: "Employee and employer Payroll Tax per employee.", permission: "reports.statutory", params: ["range"] },
  { id: "headcount", title: "Headcount", category: "hr", description: "Headcount by department with hires and leavers this year.", permission: "reports.hr", params: ["asOf"] },
  { id: "employee_master", title: "Employee master", category: "hr", description: "Core record for every employee.", permission: "reports.hr", params: [] },
  { id: "employment_history", title: "Employment history", category: "hr", description: "Hires, promotions, transfers, manager changes and terminations.", permission: "reports.hr", params: ["range"] },
  { id: "leave_report", title: "Leave & absence", category: "hr", description: "Leave requests overlapping a date range.", permission: "reports.hr", params: ["range"] },
  { id: "leave_balance", title: "Leave balances", category: "hr", description: "Available balance per employee and leave type.", permission: "reports.hr", params: ["asOf"] },
];
