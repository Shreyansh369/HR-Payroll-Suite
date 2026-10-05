/** Demo identities. Synthetic example.com addresses only — never real people. */
export const DEMO_PASSWORD = "demo-payroll-2026";

export const DEMO_ACCOUNTS = [
  { email: "demo.admin@example.com", name: "Morgan Reid", role: "Owner", description: "Full access to all three companies, settings and billing." },
  { email: "demo.hr@example.com", name: "Renée Faulkner", role: "HR Manager", description: "Employees, leave, documents and onboarding. No salary or payroll." },
  { email: "demo.payroll@example.com", name: "Alana Christopher", role: "Payroll Officer", description: "Prepares, calculates and approves payroll." },
  { email: "demo.supervisor@example.com", name: "Kervin Stoutt", role: "Supervisor", description: "Sees the Food & Beverage team only. No salary data." },
  { email: "demo.employee@example.com", name: "Shanice Penn", role: "Employee", description: "Self-service: own payslips, leave and documents." },
  { email: "demo.accountant@example.com", name: "Priya Ellis", role: "Accountant", description: "Read-only payroll, statutory reports and accounting export." },
] as const;
