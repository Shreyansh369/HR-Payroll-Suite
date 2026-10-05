import Image from "next/image";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FeatureCard, ScreenFrame, Section, SectionHeading } from "@/components/marketing/site";
import { PlanCards } from "@/components/billing/plan-cards";
import { comparePlans, PLANS } from "@/config/pricing";
import { IS_DEMO } from "@/config/env";

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

export default function HomePage() {
  const cmp = comparePlans(12);
  return (
    <>
      <div className="relative overflow-hidden border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:items-center lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-ink-2">
              <span className="size-1.5 rounded-full bg-accent" aria-hidden /> For small and multi-company businesses
            </p>
            <h1 className="mt-5 text-[38px] font-semibold leading-[1.08] tracking-tight text-balance sm:text-[52px]">Payroll you can explain, line by line.</h1>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2 text-pretty">
              Employee records, leave, attendance and payroll in one place. Every figure shows its formula, every statutory rate is effective-dated and approved by your team, and every change lands in an audit trail.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href={IS_DEMO ? "/login" : "/demo"} variant="primary" size="lg" iconRight="chevronRight">Try the live demo</ButtonLink>
              <ButtonLink href="/pricing" size="lg">See pricing</ButtonLink>
            </div>
            <p className="mt-4 text-[12.5px] text-ink-3">No sign-up needed for the demo. It runs in your browser with fictional companies.</p>
          </div>
          <ScreenFrame label="Payroll review screen with pre-flight checks and per-employee totals" className="lg:-mr-24">
            <Image src="/marketing/payroll-review.jpg" alt="Payroll review: totals, pre-flight warnings and an employee table" width={1440} height={900} priority className="h-auto w-full" />
          </ScreenFrame>
        </div>
      </div>

      <Section>
        <SectionHeading eyebrow="Why teams switch" title="Spreadsheets break quietly. This shows its working." lead="Payroll errors are rarely dramatic — a missed unpaid day, an outdated rate, a formula dragged one row too far. The suite is built so those mistakes surface before you approve." />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <FeatureCard icon="calculator" title="Transparent calculations">Open any employee in a payroll and see each line with its formula: rate conversion, proration, overtime, unpaid leave, contributions and ceilings.</FeatureCard>
          <FeatureCard icon="shield" title="Rules you control">Social Security, NHI and Payroll Tax are configurable, effective-dated records with a source reference and an approval step. Nothing is hard-coded.</FeatureCard>
          <FeatureCard icon="lock" title="Locked means locked">Approve, finalize and lock. Later fixes are made with correction runs that reference the original, so history never silently changes.</FeatureCard>
          <FeatureCard icon="calendar" title="Leave and attendance feed payroll">Approved unpaid leave and timesheets flow into the next payroll automatically. No re-keying between systems.</FeatureCard>
          <FeatureCard icon="building" title="Multiple companies">Run several companies from one login with separate employees, calendars, rules and reports. Access is granted per company.</FeatureCard>
          <FeatureCard icon="taskDone" title="Audit trail">Who changed a salary, approved a rule or exported a report — recorded with before and after values, and never editable.</FeatureCard>
        </div>
      </Section>

      <div className="border-y border-line bg-surface-2">
        <Section className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading eyebrow="Pre-flight checks" title="Problems flagged before anyone is paid" />
            <ul className="mt-6 space-y-3 text-[14px] text-ink-2">
              {[
                "Absences recorded without approved leave",
                "Net pay that moved more than your variance threshold",
                "New starters, leavers and missing employee details",
                "Statutory rules that are still drafts or unapproved",
                "Deductions that exceed a share of gross pay",
              ].map((t) => (
                <li key={t} className="flex gap-2.5"><Icon name="check" size="sm" className="mt-0.5 shrink-0 text-accent" />{t}</li>
              ))}
            </ul>
            <p className="mt-6 text-[13.5px] text-ink-3">Errors block approval. Warnings must be acknowledged by name, and the acknowledgement is audited.</p>
          </div>
          <ScreenFrame label="Overview dashboard">
            <Image src="/marketing/dashboard.jpg" alt="Overview dashboard with payroll trend, approvals and expiring documents" width={1440} height={900} className="h-auto w-full" />
          </ScreenFrame>
        </Section>
      </div>

      <Section className="grid gap-12 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <SectionHeading eyebrow="Self-service" title="Employees help themselves — and see only their own records" lead="Payslips and year-to-date totals, leave balances and requests, timesheet corrections and personal details, all on a phone. Supervisors approve their team's leave without ever seeing salaries." />
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {["Payslip PDFs and YTD", "Leave requests and balances", "Attendance corrections", "Document expiry reminders"].map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13.5px]"><Icon name="check" size="sm" className="text-accent" />{t}</div>
            ))}
          </div>
        </div>
        <div className="mx-auto w-[260px] overflow-hidden rounded-[28px] border-[6px] border-ink bg-ink shadow-xl">
          <Image src="/marketing/self-service-mobile.jpg" alt="Employee self-service on a phone: year-to-date totals and payslips" width={780} height={1688} className="h-auto w-full rounded-[22px]" />
        </div>
      </Section>

      <div className="border-y border-line bg-surface-2">
        <Section>
          <SectionHeading center eyebrow="Pricing" title="Rent it, or own it" lead={<>Over the first year, owning costs <strong className="text-ink">{usd(cmp.difference)}</strong> less than subscribing — {usd(cmp.owned.total)} versus {usd(cmp.hosted.total)}. Both include every module.</>} />
          <div className="mx-auto mt-10 max-w-4xl">
            <PlanCards hostedAction={<ButtonLink href="/pricing" className="w-full">Plan details</ButtonLink>} ownedAction={<ButtonLink href="/pricing" variant="primary" className="w-full">Plan details</ButtonLink>} />
          </div>
          <p className="mt-6 text-center text-[12.5px] text-ink-3">Flexible Subscription: {PLANS.hosted.trialDays}-day free trial. Prices in USD, excluding applicable taxes. <Link href="/pricing" className="underline">How the comparison is calculated</Link>.</p>
        </Section>
      </div>

      <Section>
        <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center sm:px-12">
          <h2 className="text-[28px] font-semibold tracking-tight text-balance">See your next payroll run before you commit</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] text-ink-2">The demo includes three fictional companies with months of payroll history, a correction run, leave, timesheets and documents. Sign in as an owner, payroll officer, supervisor or employee.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <ButtonLink href={IS_DEMO ? "/login" : "/demo"} variant="primary" size="lg">Open the demo</ButtonLink>
            <ButtonLink href="/contact" size="lg">Ask a question</ButtonLink>
          </div>
        </div>
      </Section>
    </>
  );
}
