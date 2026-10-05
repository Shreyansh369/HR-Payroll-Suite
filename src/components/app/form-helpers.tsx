"use client";

import { cn } from "@/lib/cn";
import { AppError } from "@/lib/errors";
import { WEEKDAYS } from "@/lib/labels";
import { Input } from "@/components/ui/form";
import { WEEKDAY_PRESETS } from "@/domain/employee/schedule";
import { rateEquivalents, type RateConfig } from "@/domain/payroll/rates";
import { formatMoney } from "@/lib/money";
import type { RateBasis } from "@/domain/types";

/** Map server validation issues ("address.city") to field messages. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!error) return {};
  const e = AppError.from(error);
  const out: Record<string, string> = {};
  for (const i of e.issues ?? []) if (!out[i.path]) out[i.path] = i.message;
  return out;
}

export function WorkDaysPicker({ value, onChange, disabled }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Working days">
        {WEEKDAYS.map((d) => {
          const on = value.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== d.value) : [...value, d.value].sort())}
              className={cn(
                "h-8 w-11 rounded-md border text-[12.5px] font-medium transition-colors max-sm:h-10",
                on ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-ink-3 hover:text-ink",
              )}
            >
              {d.short}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAY_PRESETS.map((p) => (
          <button key={p.label} type="button" disabled={disabled} onClick={() => onChange(p.days)} className="text-[11.5px] text-ink-3 underline-offset-2 hover:text-accent hover:underline">
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RateEquivalentsPreview({ amount, basis, workDays, hoursPerDay, config, currency }: { amount: number; basis: RateBasis; workDays: number[]; hoursPerDay: number; config: RateConfig; currency: string }) {
  if (!(amount > 0) || workDays.length === 0 || !(hoursPerDay > 0)) {
    return <p className="text-[12px] text-ink-3">Enter a rate and schedule to see annual, monthly, daily and hourly equivalents.</p>;
  }
  const eq = rateEquivalents(amount, basis, { daysPerWeek: workDays.length, hoursPerDay }, config);
  const rows: [string, number, string][] = [
    ["Annual", Number(eq.annual), eq.formulas.annual],
    ["Monthly", Number(eq.monthly), eq.formulas.monthly],
    ["Semi-monthly", Number(eq.semiMonthly), eq.formulas.semiMonthly],
    ["Biweekly", Number(eq.biweekly), eq.formulas.biweekly],
    ["Weekly", Number(eq.weekly), eq.formulas.weekly],
    ["Daily", Number(eq.daily), eq.formulas.daily],
    ["Hourly", Number(eq.hourly), eq.formulas.hourly],
  ];
  return (
    <div className="rounded-md border border-line bg-surface-2">
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([label, value, formula]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <td className="px-3 py-1.5 text-ink-2">{label}</td>
              <td className="px-3 py-1.5 text-right font-medium num">{formatMoney(value, currency, { decimals: label === "Hourly" || label === "Daily" ? 2 : 2 })}</td>
              <td className="hidden px-3 py-1.5 text-[11.5px] text-ink-3 md:table-cell">{formula}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line px-3 py-1.5 text-[11.5px] text-ink-3">{eq.assumptions.join(" · ")}</p>
    </div>
  );
}

export function NumberInput({ value, onChange, ...rest }: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Input
      {...rest}
      type="number"
      inputMode="decimal"
      value={value === null || Number.isNaN(value) ? "" : value}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}
