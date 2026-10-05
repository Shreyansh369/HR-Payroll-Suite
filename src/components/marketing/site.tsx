import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { APP_NAME, IS_DEMO, SALES_EMAIL } from "@/config/env";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/demo", label: "Demo" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-white">HP</span>
      <span className="text-[14px] font-semibold tracking-tight">{APP_NAME}</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink-2 hover:bg-surface-3 hover:text-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" className="hidden sm:inline-flex">Sign in</ButtonLink>
          <ButtonLink href={IS_DEMO ? "/login" : "/contact"} variant="primary">{IS_DEMO ? "Open live demo" : "Talk to us"}</ButtonLink>
        </div>
      </div>
      <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-t border-line/60 px-3 py-1.5 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="shrink-0 rounded-md px-2.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-surface-3">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

const LEGAL = [
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/cookies", label: "Cookie policy" },
  { href: "/data-protection", label: "Data processing" },
  { href: "/acceptable-use", label: "Acceptable use" },
  { href: "/subscription-terms", label: "Subscription terms" },
  { href: "/license", label: "Software licence" },
  { href: "/support-terms", label: "Support & maintenance" },
  { href: "/refund-cancellation", label: "Refunds & cancellation" },
  { href: "/statutory-disclaimer", label: "Statutory disclaimer" },
  { href: "/security", label: "Security" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface-2">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.2fr_1fr_1.6fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-[13px] text-ink-3">HR and payroll software for small and multi-company businesses. Statutory rates are configured and approved by you and your accountant.</p>
          <a href={`mailto:${SALES_EMAIL}`} className="mt-3 inline-block text-[13px] font-medium text-accent hover:underline">{SALES_EMAIL}</a>
        </div>
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">Product</p>
          <ul className="mt-3 space-y-2 text-[13px]">
            {NAV.map((n) => <li key={n.href}><Link href={n.href} className="text-ink-2 hover:text-ink">{n.label}</Link></li>)}
            <li><Link href="/login" className="text-ink-2 hover:text-ink">Sign in</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-3">Legal</p>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
            {LEGAL.map((n) => <li key={n.href}><Link href={n.href} className="text-ink-2 hover:text-ink">{n.label}</Link></li>)}
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-4 text-[12px] text-ink-4 sm:px-6">© {new Date().getFullYear()} {APP_NAME}. Legal documents on this site are templates pending review by qualified counsel.</p>
      </div>
    </footer>
  );
}

export function Section({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20", className)}>
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-accent">{children}</p>;
}

export function SectionHeading({ eyebrow, title, lead, center }: { eyebrow?: string; title: string; lead?: ReactNode; center?: boolean }) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-balance sm:text-[34px]">{title}</h2>
      {lead && <p className="mt-3 text-[15px] leading-relaxed text-ink-2 text-pretty">{lead}</p>}
    </div>
  );
}

export function FeatureCard({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent"><Icon name={icon} /></span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

export function PageIntro({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line bg-surface-2">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 max-w-3xl text-[32px] font-semibold leading-tight tracking-tight text-balance sm:text-[42px]">{title}</h1>
        <p className="mt-3 max-w-2xl text-[15.5px] leading-relaxed text-ink-2 text-pretty">{lead}</p>
        {children}
      </div>
    </div>
  );
}

/** Browser-chrome frame around a product screenshot. */
export function ScreenFrame({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <figure className={cn("overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_24px_60px_-24px_rgba(22,24,27,0.25)]", className)}>
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-3 px-3 py-2" aria-hidden>
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
      </div>
      {children}
      <figcaption className="sr-only">{label}</figcaption>
    </figure>
  );
}
