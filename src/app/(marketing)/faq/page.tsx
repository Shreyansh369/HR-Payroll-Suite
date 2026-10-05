import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section } from "@/components/marketing/site";

export const metadata: Metadata = { title: "FAQ", description: "Answers about payroll calculations, statutory rules, security, data and plans." };

const GROUPS: { title: string; items: { q: string; a: React.ReactNode }[] }[] = [
  {
    title: "Payroll and statutory rules",
    items: [
      { q: "Does the software know the current BVI rates?", a: "No rates are treated as fact. New companies start with clearly labelled draft placeholders. You or your accountant enter the official rates with their source and approve them; the approval is recorded. Production payroll cannot be finalized while a rule in use is unapproved." },
      { q: "How are daily and hourly rates worked out?", a: "You choose the method per company — annual working days, fixed days per month, or calendar days — and the weeks per year and hours per day. Every converted rate shows its formula on screen and in the calculation detail." },
      { q: "What happens when a rate changes mid-period?", a: "Pay is split into segments at the effective date and each segment is prorated by your chosen method. Statutory rules are selected by pay date or period end, as configured." },
      { q: "Can a locked payroll be changed?", a: "Not silently. An authorized person can reopen an approved or finalized run with a reason (audited), or create a correction run that references the original. Locked runs stay as they were." },
      { q: "Does it file returns or pay employees?", a: "No. It produces the schedules, payslips, bank-ready totals and accounting journals you use to file and pay through your usual channels." },
    ],
  },
  {
    title: "Security and data",
    items: [
      { q: "Who can see salaries?", a: "Only roles with salary permission. Supervisors manage their team's leave and timesheets without seeing pay; employees see only their own records. These rules are enforced on the server, not just hidden in the interface." },
      { q: "How is sensitive data protected?", a: <>Passwords are hashed with scrypt, statutory IDs and bank accounts are encrypted at rest, sessions use secure HttpOnly cookies, sign-in is rate-limited and two-factor authentication is available. See the <Link href="/security" className="underline">security overview</Link>.</> },
      { q: "Can I export my data?", a: "Yes. Every report exports to PDF, Excel and CSV, and administrators can export full data on request. Leaving does not hold your records hostage." },
      { q: "Is the demo using real data?", a: "No. The demo runs in your browser with fictional companies and people, and is never connected to a production database." },
    ],
  },
  {
    title: "Plans and setup",
    items: [
      { q: "How long does setup take?", a: "A typical setup: import employees from a spreadsheet, configure calendars and statutory rules, map accounts, then compare one period against your current process." },
      { q: "Can I host it myself?", a: "Yes, with the Own the Software plan. It runs on any Node.js host with PostgreSQL. Deployment instructions are included." },
      { q: "Do you support multiple companies?", a: "Yes, on both plans. Each company keeps separate employees, calendars, rules and reports." },
    ],
  },
];

export default function FaqPage() {
  return (
    <>
      <PageIntro eyebrow="FAQ" title="Questions we hear most" lead={<>Can’t find what you need? <Link href="/contact" className="font-medium text-accent hover:underline">Ask us directly</Link>.</>} />
      <Section className="space-y-10">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h2 className="text-[18px] font-semibold tracking-tight">{g.title}</h2>
            <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
              {g.items.map((f) => (
                <details key={f.q} className="px-5 py-4">
                  <summary className="cursor-pointer list-none text-[14px] font-medium">{f.q}</summary>
                  <div className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{f.a}</div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}
