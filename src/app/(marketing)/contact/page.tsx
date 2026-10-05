import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/marketing/site";
import { ContactForm } from "@/components/marketing/contact-form";
import { SALES_EMAIL } from "@/config/env";

export const metadata: Metadata = { title: "Contact", description: "Questions about plans, setup or a demo." };

export default function ContactPage() {
  return (
    <>
      <PageIntro eyebrow="Contact" title="Talk to a person" lead="Tell us about your companies and how you run payroll today. We aim to reply within one business day." />
      <Section className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <ContactForm />
        <aside className="space-y-4 text-[13.5px] text-ink-2">
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="font-semibold text-ink">Email</p>
            <a href={`mailto:${SALES_EMAIL}`} className="mt-1 inline-block font-medium text-accent hover:underline">{SALES_EMAIL}</a>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="font-semibold text-ink">Helpful to include</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Number of companies and employees</li>
              <li>Pay frequencies you use</li>
              <li>Your current payroll tool or spreadsheet</li>
              <li>Whether you prefer hosted or self-hosted</li>
            </ul>
          </div>
          <p className="text-[12.5px] text-ink-3">Please don’t send employee personal data, IDs or payroll files by email.</p>
        </aside>
      </Section>
    </>
  );
}
