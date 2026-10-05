import type { ReactNode } from "react";
import { PLANS, comparePlans } from "@/config/pricing";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Plan cards driven entirely by src/config/pricing.ts (shared by marketing and billing). */
export function PlanCards({ hostedAction, ownedAction, current }: { hostedAction?: ReactNode; ownedAction?: ReactNode; current?: "hosted" | "owned" | null }) {
  const h = PLANS.hosted;
  const o = PLANS.owned;
  const cmp = comparePlans(12);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className={cn("flex flex-col rounded-xl border bg-surface p-5", current === "hosted" ? "border-accent ring-1 ring-accent" : "border-line")}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold">{h.name}</h3>
          {current === "hosted" && <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">Current plan</span>}
        </div>
        <p className="mt-3 flex items-baseline gap-1.5"><span className="text-[28px] font-semibold tracking-tight num">{usd(h.setupFee)}</span><span className="text-[13px] text-ink-3">one-time setup</span></p>
        <p className="mt-0.5 text-[13px] text-ink-2">then <span className="font-medium text-ink num">{usd(h.recurringMonthly)}</span>/month · {h.trialDays}-day free trial</p>
        {h.subscriptionFreeMonthsAfterPurchase > 0 && <p className="mt-1 text-[12px] text-ink-3">Monthly billing starts {h.subscriptionFreeMonthsAfterPurchase} calendar months after purchase.</p>}
        <ul className="mt-4 flex-1 space-y-1.5 text-[13px]">
          {h.includes.map((x) => <li key={x} className="flex gap-2"><Icon name="check" size="sm" className="mt-0.5 shrink-0 text-accent" />{x}</li>)}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">First 12 months: <span className="font-medium text-ink num">{usd(cmp.hosted.total)}</span></p>
        {hostedAction && <div className="mt-3">{hostedAction}</div>}
      </div>
      <div className={cn("flex flex-col rounded-xl border bg-surface p-5", current === "owned" ? "border-accent ring-1 ring-accent" : "border-line")}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[15px] font-semibold">{o.name}</h3>
          {current === "owned" ? <span className="rounded-sm bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">Current plan</span> : cmp.cheaper === "owned" && <span className="rounded-sm bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">Lower first-year cost</span>}
        </div>
        <p className="mt-3 flex items-baseline gap-1.5"><span className="text-[28px] font-semibold tracking-tight num">{usd(o.oneTime)}</span><span className="text-[13px] text-ink-3">one-time</span></p>
        <p className="mt-0.5 text-[13px] text-ink-2">No software subscription for {o.subscriptionFreeMonths} months</p>
        <p className="mt-1 text-[12px] text-ink-3">{o.includedMaintenanceMonths} months of maintenance included.</p>
        <ul className="mt-4 flex-1 space-y-1.5 text-[13px]">
          {o.includes.map((x) => <li key={x} className="flex gap-2"><Icon name="check" size="sm" className="mt-0.5 shrink-0 text-accent" />{x}</li>)}
        </ul>
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">
          First 12 months: <span className="font-medium text-ink num">{usd(cmp.owned.total)}</span>
          {cmp.cheaper === "owned" && cmp.difference > 0 && <> · <span className="font-medium text-success">save {usd(cmp.difference)}</span> vs. subscription</>}
        </p>
        {ownedAction && <div className="mt-3">{ownedAction}</div>}
      </div>
    </div>
  );
}

export function ComparisonTable() {
  const cmp = comparePlans(12);
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="grid gap-px overflow-hidden rounded-t-xl bg-line sm:grid-cols-2">
        {([["hosted", PLANS.hosted.name, cmp.hosted.lines, cmp.hosted.total], ["owned", PLANS.owned.name, cmp.owned.lines, cmp.owned.total]] as const).map(([k, name, lines, total]) => (
          <div key={k} className="bg-surface p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-3">{name} — first 12 months</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              {lines.map((l) => <div key={l.label} className="flex justify-between gap-3"><dt className="text-ink-2">{l.label}</dt><dd className="num">{usd(l.amount)}</dd></div>)}
              <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold"><dt>Total</dt><dd className="num">{usd(total)}</dd></div>
            </dl>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-4">
        {cmp.cheaper !== "equal" && <p className="text-[13px] font-medium">{cmp.cheaper === "owned" ? PLANS.owned.name : PLANS.hosted.name} costs {usd(cmp.difference)} less over the first 12 months.</p>}
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px] text-ink-3">
          {cmp.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
}
