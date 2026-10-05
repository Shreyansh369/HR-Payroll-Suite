import type { Permission } from "@/domain/auth/permissions";
import type { IconName } from "@/components/ui/icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  any: Permission[];
  /** Requires a linked employee record (self-service). */
  needsEmployee?: boolean;
  /** Hide for users whose only access is self-service. */
  notSelfOnly?: boolean;
  keywords?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/app", label: "Overview", icon: "dashboard", any: ["employee.view", "payroll.view", "leave.approve", "audit.view", "reports.payroll"], keywords: "dashboard home" },
      { href: "/app/me", label: "My profile", icon: "user", any: ["self.view"], needsEmployee: true, keywords: "self service payslips my leave" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/app/employees", label: "Employees", icon: "users", any: ["employee.view"], keywords: "directory staff people" },
      { href: "/app/organization", label: "Organization", icon: "hierarchy", any: ["employee.view"], keywords: "org chart departments" },
      { href: "/app/onboarding", label: "On/offboarding", icon: "checklist", any: ["workflows.manage"], keywords: "onboarding offboarding checklist termination" },
      { href: "/app/celebrations", label: "Celebrations", icon: "birthday", any: ["employee.view"], keywords: "birthdays anniversaries" },
    ],
  },
  {
    label: "Time",
    items: [
      { href: "/app/leave", label: "Leave", icon: "calendar", any: ["leave.view"], keywords: "vacation sick absence time off" },
      { href: "/app/attendance", label: "Attendance", icon: "clock", any: ["attendance.view"], keywords: "timesheets overtime hours" },
      { href: "/app/documents", label: "Documents", icon: "folder", any: ["documents.view"], keywords: "files contracts permits expiry" },
    ],
  },
  {
    label: "Payroll",
    items: [
      { href: "/app/payroll", label: "Payroll runs", icon: "wallet", any: ["payroll.view"], keywords: "pay run payslips" },
      { href: "/app/loans", label: "Loans & advances", icon: "coins", any: ["salary.view"], keywords: "loan advance repayment" },
      { href: "/app/statutory", label: "Statutory rules", icon: "shield", any: ["statutory_rules.view"], keywords: "social security nhi payroll tax rates" },
      { href: "/app/accounting", label: "Accounting export", icon: "book", any: ["accounting.export"], keywords: "quickbooks journal ledger" },
    ],
  },
  {
    label: "Insight",
    items: [
      { href: "/app/reports", label: "Reports", icon: "chart", any: ["reports.hr", "reports.payroll", "reports.statutory"], keywords: "register ytd export" },
      { href: "/app/audit", label: "Audit log", icon: "taskDone", any: ["audit.view"], keywords: "history activity" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/app/import", label: "Import data", icon: "import", any: ["imports.run"], keywords: "spreadsheet csv xlsx upload migrate" },
      { href: "/app/settings", label: "Settings", icon: "settings", any: ["company.manage", "users.manage", "roles.manage", "leave.configure", "company.view"], notSelfOnly: true, keywords: "company users roles holidays calendar" },
      { href: "/app/billing", label: "Billing", icon: "card", any: ["billing.manage"], keywords: "plan subscription invoice" },
    ],
  },
];
