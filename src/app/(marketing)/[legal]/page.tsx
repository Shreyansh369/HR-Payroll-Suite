import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "@/components/marketing/site";
import { LEGAL_DOCUMENTS, LEGAL_LAST_UPDATED, legalDocument } from "@/content/legal";

export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((d) => ({ legal: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ legal: string }> }): Promise<Metadata> {
  const doc = legalDocument((await params).legal);
  return doc ? { title: doc.title, description: doc.summary } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ legal: string }> }) {
  const doc = legalDocument((await params).legal);
  if (!doc) notFound();
  return (
    <Section className="grid gap-10 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Legal documents" className="order-2 lg:order-1">
        <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">Legal</p>
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {LEGAL_DOCUMENTS.map((d) => (
            <li key={d.slug}>
              <Link href={`/${d.slug}`} aria-current={d.slug === doc.slug ? "page" : undefined} className={d.slug === doc.slug ? "font-medium text-ink" : "text-ink-3 hover:text-ink"}>{d.title}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="order-1 max-w-3xl lg:order-2">
        <h1 className="text-[32px] font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-[14px] text-ink-2">{doc.summary}</p>
        <div role="note" className="mt-5 rounded-lg border border-warning-line bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
          <strong className="text-ink">Template — not yet in force.</strong> This document is a drafting template. It must be completed and reviewed by qualified counsel before it applies to anyone. Bracketed text marks information the operator must supply. Last updated: {LEGAL_LAST_UPDATED}.
        </div>
        <div className="mt-8 space-y-8">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-[17px] font-semibold tracking-tight">{s.heading}</h2>
              <div className="mt-2 space-y-3 text-[14px] leading-relaxed text-ink-2">
                {s.body.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </section>
          ))}
        </div>
      </article>
    </Section>
  );
}
