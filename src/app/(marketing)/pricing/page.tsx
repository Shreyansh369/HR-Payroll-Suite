import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { PageIntro, Section } from "@/components/marketing/site";
import { ComparisonTable, PlanCards } from "@/components/billing/plan-cards";
import { PLANS } from "@/config/pricing";
import { BILLING_ENABLED, IS_DEMO, SALES_EMAIL } from "@/config/env";

export const metadata: Metadata = { title: "Pricing", description: "Flexible Subscription or Own the Software. Transparent first-year cost comparison." };

const FAQ = [
  { q: "What happens during the free trial?", a: `The Flexible Subscription starts with a ${PLANS.hosted.trialDays}-day trial. The one-time setup fee covers onboarding and data import. ${PLANS.hosted.subscriptionFreeMonthsAfterPurchase > 0 ? `Monthly billing starts ${PLANS.hosted.subscriptionFreeMonthsAfterPurchase} calendar months after purchase.` : ""}` },
  { q: "What does “Own the Software” include?", a: `A perpetual licence for your organisation, no software subscription for ${PLANS.owned.subscriptionFreeMonths} months, and ${PLANS.owned.includedMaintenanceMonths} months of maintenance and support. Ongoing maintenance after that is optional and quoted separately.` },
  { q: "Are statutory rates included?", a: "The software includes illustrative example rules only. You or your accountant enter the current official rates, with their source, and approve them. Production payroll cannot be finalized with unapproved rules." },
  { q: "Can I switch plans later?", a: "Yes. Contact us and we will move your data between hosted and self-hosted installations." },
  { q: "How do payments work?", a: "Card payments are processed on Stripe's hosted checkout; card details never reach our servers. Stripe availability depends on the merchant's country, so bank transfer invoicing is also available." },
];

export default function PricingPage() {
  const action = (plan: "hosted" | "owned") =>
    IS_DEMO ? (
      <ButtonLink href="/contact" variant={plan === "owned" ? "primary" : "secondary"} className="w-full">{plan === "hosted" ? "Start with a trial" : "Buy a licence"}</ButtonLink>
    ) : BILLING_ENABLED ? (
      <ButtonLink href="/login?next=/app/billing" variant={plan === "owned" ? "primary" : "secondary"} className="w-full">{plan === "hosted" ? "Start 7-day trial" : "Buy licence"}</ButtonLink>
    ) : (
      <ButtonLink href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(plan === "hosted" ? "Flexible Subscription" : "Own the Software")}`} variant={plan === "owned" ? "primary" : "secondary"} className="w-full">Contact sales</ButtonLink>
    );
  return (
    <>
      <PageIntro eyebrow="Pricing" title="Two simple ways to pay" lead="Both plans include every module, multiple companies and guided setup. Choose a subscription for flexibility, or a one-time licence for the lowest first-year cost." />
      <Section>
        {IS_DEMO && <p className="mb-6 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">You are viewing the public demo, where online checkout is turned off. Get in touch and we will set up your plan.</p>}
        <PlanCards hostedAction={action("hosted")} ownedAction={action("owned")} />
        <h2 className="mt-14 text-[20px] font-semibold tracking-tight">First-year cost comparison</h2>
        <p className="mt-1 text-[13.5px] text-ink-2">Calculated from the plan terms above — no hidden assumptions.</p>
        <div className="mt-4"><ComparisonTable /></div>
      </Section>
      <Section className="pt-0">
        <h2 className="text-[20px] font-semibold tracking-tight">Questions about pricing</h2>
        <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-surface">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-[14px] font-medium marker:hidden">{f.q}</summary>
              <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-[12.5px] text-ink-3">See also the <Link href="/subscription-terms" className="underline">subscription terms</Link>, <Link href="/license" className="underline">software licence</Link> and <Link href="/refund-cancellation" className="underline">refund and cancellation policy</Link>.</p>
      </Section>
    </>
  );
}
