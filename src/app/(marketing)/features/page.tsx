import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { PageIntro, Section } from "@/components/marketing/site";
import { IS_DEMO } from "@/config/env";

export const metadata: Metadata = { title: "Features", description: "HR records, leave, attendance, documents, payroll, statutory rules, reports, imports and accounting exports." };

const MODULES: { icon: IconName; title: string; lead: string; points: string[] }[] = [
  {
    icon: "users",
    title: "Employee records",
    lead: "One profile per person with effective-dated history.",
    points: ["Hires, promotions, transfers, pay changes and terminations as dated events", "Scheduled future changes applied on their effective date", "Org chart, departments, managers and work locations", "Statutory IDs and bank details encrypted at rest and masked for roles without salary access"],
  },
  {
    icon: "wallet",
    title: "Payroll",
    lead: "Weekly, biweekly, semi-monthly and monthly calendars per company.",
    points: ["Salaried and hourly pay with mid-period starters, leavers and rate changes", "Overtime, bonuses, commissions, allowances, recurring and one-time items", "Loans and advances with automatic repayments", "Draft → calculated → review → approved → finalized → locked, with correction runs"],
  },
  {
    icon: "calculator",
    title: "Configurable pay-rate conversion",
    lead: "Your methodology, written down and visible.",
    points: ["Daily rate by annual working days, fixed days per month or calendar days", "Proration by scheduled working days or calendar days", "Every conversion shows its formula on screen and on the calculation detail", "Rounding mode chosen per company"],
  },
  {
    icon: "shield",
    title: "Statutory rules",
    lead: "Social Security, NHI and Payroll Tax as data, not code.",
    points: ["Employee and employer rates, ceilings (per period or annual), thresholds and age eligibility", "Employer rate tiers by headcount", "Effective dates with automatic version selection by pay date or period end", "Draft → approved workflow with source reference; production payroll requires approval"],
  },
  {
    icon: "calendar",
    title: "Leave",
    lead: "Policies, balances and approvals that payroll understands.",
    points: ["Vacation, sick, unpaid and custom leave types", "Up-front or monthly accrual, carry-forward caps and expiry", "Team calendar with public holidays", "Approved unpaid leave becomes a payroll deduction automatically"],
  },
  {
    icon: "clock",
    title: "Attendance",
    lead: "Timesheets that pay hourly staff directly.",
    points: ["Weekly grid with fill-from-schedule", "Supervisor approval of hours and overtime", "Employee correction requests with an approval trail", "Absences without leave flagged in payroll pre-flight"],
  },
  {
    icon: "folder",
    title: "Documents and workflows",
    lead: "Contracts, permits and checklists in one place.",
    points: ["Uploads validated by content, not just file extension", "Expiry tracking with dashboard reminders", "Onboarding and offboarding checklists with owners and due dates", "Employee-visible or HR-only documents"],
  },
  {
    icon: "chart",
    title: "Reports and exports",
    lead: "Eighteen reports in PDF, Excel and CSV.",
    points: ["Payroll register, gross-to-net, summaries and year-to-date", "Social Security, NHI and Payroll Tax schedules", "Headcount, employee master, history, leave and balances", "Payslip PDFs individually or as a ZIP for the whole run"],
  },
  {
    icon: "book",
    title: "Accounting export",
    lead: "Journal entries ready for QuickBooks.",
    points: ["Balanced journal per payroll in summary or per-employee detail", "Map wages, contributions, deductions and net pay to your chart of accounts", "CSV formatted for QuickBooks Online journal import", "Exports recorded in the audit log"],
  },
  {
    icon: "import",
    title: "Spreadsheet import",
    lead: "Move in without retyping.",
    points: ["CSV, Excel and TSV with automatic column matching", "Dry run with row-level errors and duplicate detection before anything is saved", "Download rejected rows to fix and re-import", "Employees, rates, leave balances, history and more"],
  },
  {
    icon: "key",
    title: "Security and access",
    lead: "Role × company × data scope, checked on the server.",
    points: ["Seven system roles plus custom roles with explicit permissions", "Supervisors see their team; employees see only themselves", "scrypt password hashing, optional two-factor authentication, rate-limited sign-in", "Append-only audit log enforced by the database"],
  },
  {
    icon: "building",
    title: "Multi-company",
    lead: "Group structures without mixed-up data.",
    points: ["Separate employees, calendars, rules and settings per company", "Switch companies in one click; access granted per company", "Consolidated audit view across companies for administrators", "Per-company branding on payslips and reports"],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <PageIntro eyebrow="Features" title="Everything HR and payroll needs, connected" lead="Each module feeds the next: approved leave and timesheets flow into payroll, payroll flows into payslips, reports and your accounting system — with an audit trail throughout.">
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href={IS_DEMO ? "/login" : "/demo"} variant="primary">Try it in the demo</ButtonLink>
          <ButtonLink href="/pricing">Pricing</ButtonLink>
        </div>
      </PageIntro>
      <Section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <article key={m.title} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name={m.icon} /></span>
              <h2 className="text-[16px] font-semibold">{m.title}</h2>
            </div>
            <p className="mt-3 text-[13.5px] text-ink-2">{m.lead}</p>
            <ul className="mt-3 space-y-2 text-[13px] text-ink-2">
              {m.points.map((p) => <li key={p} className="flex gap-2"><Icon name="check" size="sm" className="mt-0.5 shrink-0 text-accent" />{p}</li>)}
            </ul>
          </article>
        ))}
      </Section>
      <Section className="pt-0">
        <div className="rounded-xl border border-warning-line bg-warning-soft p-5 text-[13.5px] text-ink-2">
          <p className="font-semibold text-ink">What the software does not do</p>
          <p className="mt-1">It does not file returns with government agencies, transmit bank payments, or decide which statutory rates apply to you. It calculates using the rules and methodology you configure and approve, and produces the reports and files you submit. Confirm your setup with a qualified payroll or accounting professional.</p>
        </div>
      </Section>
    </>
  );
}
