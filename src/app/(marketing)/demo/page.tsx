import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { PageIntro, Section } from "@/components/marketing/site";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/repositories/demo/seed-accounts";
import { IS_DEMO, SALES_EMAIL } from "@/config/env";

export const metadata: Metadata = { title: "Live demo", description: "Explore three fictional companies with payroll history, leave, timesheets and documents." };

const TOUR = [
  ["Review a payroll", "Sign in as the Payroll Officer, switch to Tortola Marine and open the semi-monthly payroll in review. Acknowledge the pre-flight warnings and open an employee to see every formula."],
  ["Approve unpaid leave", "As the Supervisor, approve a pending leave request. Then, as Payroll, recalculate the open payroll and watch the deduction appear."],
  ["Correct a locked payroll", "As the Owner, open a locked month and create a correction run. The original stays untouched; the correction references it."],
  ["Change a statutory rule", "Open Statutory rules, edit a rate with a future effective date and preview its effect before approving it."],
  ["Import a spreadsheet", "Download the sample file from Import data. The dry run shows row-level errors and a duplicate before anything is saved."],
  ["See it as an employee", "Sign in as the Employee on your phone: payslips, YTD, leave balance and requests."],
];

export default function DemoPage() {
  return (
    <>
      <PageIntro eyebrow="Live demo" title="Explore with fictional data — nothing to install" lead="The demo runs entirely in your browser. Three made-up companies come with months of payroll history, leave, timesheets, documents and a correction run. Your changes stay in your browser and can be reset at any time.">
        <div className="mt-6 flex flex-wrap gap-3">
          {IS_DEMO ? <ButtonLink href="/login" variant="primary" size="lg">Open the demo</ButtonLink> : <ButtonLink href={`mailto:${SALES_EMAIL}?subject=Demo%20request`} variant="primary" size="lg">Request a demo</ButtonLink>}
        </div>
      </PageIntro>
      {IS_DEMO && (
        <Section>
          <h2 className="text-[20px] font-semibold tracking-tight">Demo accounts</h2>
          <p className="mt-1 text-[13.5px] text-ink-2">Every account uses the password <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12.5px]">{DEMO_PASSWORD}</code>. On the sign-in page you can pick one with a single click.</p>
          <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[560px] text-left text-[13.5px]">
              <thead className="bg-surface-2 text-[12px] text-ink-3"><tr><th className="px-4 py-2.5 font-medium">Role</th><th className="px-4 py-2.5 font-medium">Email</th><th className="px-4 py-2.5 font-medium">What they can do</th></tr></thead>
              <tbody className="divide-y divide-line">
                {DEMO_ACCOUNTS.map((a) => (
                  <tr key={a.email}><td className="px-4 py-3 font-medium">{a.role}</td><td className="px-4 py-3 font-mono text-[12.5px] text-ink-2">{a.email}</td><td className="px-4 py-3 text-ink-2">{a.description}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <Section className={IS_DEMO ? "pt-0" : undefined}>
        <h2 className="text-[20px] font-semibold tracking-tight">A ten-minute tour</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TOUR.map(([title, body], i) => (
            <li key={title} className="rounded-xl border border-line bg-surface p-5">
              <span className="grid size-7 place-items-center rounded-full bg-accent text-[12px] font-semibold text-white">{i + 1}</span>
              <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-[12.5px] text-ink-3">All names, companies, identifiers and amounts in the demo are fictional. Statutory rates in the demo are illustrative placeholders, not legal values.</p>
      </Section>
    </>
  );
}
