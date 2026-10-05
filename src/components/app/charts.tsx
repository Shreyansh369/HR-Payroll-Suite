"use client";

import { useState } from "react";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { cn } from "@/lib/cn";

/**
 * Grouped column chart for payroll trends. Renders real values only; no
 * decorative series. Gross is the primary bar; employer cost is a thin overlay mark.
 */
export function PayrollTrendChart({ data, currency }: { data: { id: string; label: string; gross: number; net: number; employerCost: number }[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.employerCost), 1);
  const nice = niceMax(max);
  const ticks = [0, nice / 2, nice];
  return (
    <figure className="relative">
      <div className="flex gap-3">
        <div className="flex h-40 flex-col justify-between pb-5 text-right text-[10.5px] text-ink-4 num">
          {[...ticks].reverse().map((t) => (
            <span key={t}>{formatMoneyCompact(t, currency)}</span>
          ))}
        </div>
        <div className="relative flex h-40 flex-1 items-end gap-2 border-b border-line pb-0">
          {ticks.map((t) => (
            <div key={t} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${(t / nice) * 100}%` }} />
          ))}
          {data.map((d, i) => (
            <div
              key={d.id}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${d.label}: gross ${formatMoney(d.gross, currency)}, net ${formatMoney(d.net, currency)}, employer cost ${formatMoney(d.employerCost, currency)}`}
            >
              <div className="relative flex w-full max-w-[44px] items-end justify-center gap-[3px]" style={{ height: "100%" }}>
                <div className={cn("w-1/2 rounded-t-[3px] bg-accent transition-opacity", hover !== null && hover !== i && "opacity-40")} style={{ height: `${(d.gross / nice) * 100}%` }} />
                <div className={cn("w-1/2 rounded-t-[3px] bg-accent-line transition-opacity", hover !== null && hover !== i && "opacity-40")} style={{ height: `${(d.net / nice) * 100}%` }} />
                <div className="absolute inset-x-0 h-[2px] bg-ink-2" style={{ bottom: `${(d.employerCost / nice) * 100}%` }} />
              </div>
              <span className="absolute -bottom-5 truncate text-[10.5px] text-ink-3">{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute right-0 top-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] shadow-md">
          <p className="font-medium text-ink">{data[hover].label}</p>
          <p className="num text-ink-2">Gross {formatMoney(data[hover].gross, currency)}</p>
          <p className="num text-ink-2">Net {formatMoney(data[hover].net, currency)}</p>
          <p className="num text-ink-2">Employer cost {formatMoney(data[hover].employerCost, currency)}</p>
        </div>
      )}
      <figcaption className="mt-7 flex flex-wrap gap-4 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-accent" />Gross</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-accent-line" />Net</span>
        <span className="flex items-center gap-1.5"><span className="h-[2px] w-3 bg-ink-2" />Employer cost</span>
      </figcaption>
    </figure>
  );
}

function niceMax(v: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * exp;
}

/** Horizontal proportion bars (e.g. headcount by department). */
export function BarList({ items, format = (n) => String(n) }: { items: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-1.5">
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-[12.5px]">
          <span className="truncate text-ink-2">{it.label}</span>
          <span className="h-1.5 rounded-full bg-surface-3">
            <span className="block h-1.5 rounded-full bg-accent/80" style={{ width: `${(it.value / max) * 100}%` }} />
          </span>
          <span className="num w-8 text-right font-medium text-ink">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProgressBar({ value, total, className }: { value: number; total: number; className?: string }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
