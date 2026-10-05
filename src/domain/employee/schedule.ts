/**
 * Effective-dated lookups and working-day arithmetic.
 */
import { dayOfWeek, eachDay, type DateRange, type ISODate } from "@/lib/dates";
import type { Holiday, PayRate, WorkSchedule } from "@/domain/types";

interface EffectiveFrom {
  effectiveFrom: ISODate;
  createdAt?: string;
}

/** Sort ascending by effective date, ties broken by creation time (later wins). */
export function sortEffective<T extends EffectiveFrom>(records: T[]): T[] {
  return [...records].sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom
      ? (a.createdAt ?? "").localeCompare(b.createdAt ?? "")
      : a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
}

/** The record in force on `date`, or null if none had started yet. */
export function effectiveOn<T extends EffectiveFrom>(records: T[], date: ISODate): T | null {
  let found: T | null = null;
  for (const r of sortEffective(records)) {
    if (r.effectiveFrom <= date) found = r;
    else break;
  }
  return found;
}

/** Attach the computed `effectiveTo` (day before the next record starts). */
export function withEffectiveTo<T extends EffectiveFrom>(records: T[]): (T & { effectiveTo: ISODate | null })[] {
  const sorted = sortEffective(records);
  return sorted.map((r, i) => {
    const next = sorted[i + 1];
    let effectiveTo: ISODate | null = null;
    if (next) {
      const dt = new Date(`${next.effectiveFrom}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - 1);
      effectiveTo = dt.toISOString().slice(0, 10);
    }
    return { ...r, effectiveTo };
  });
}

export function currentPayRate(rates: PayRate[], date: ISODate): PayRate | null {
  return effectiveOn(rates, date);
}

export function currentSchedule(schedules: WorkSchedule[], date: ISODate): WorkSchedule | null {
  return effectiveOn(schedules, date);
}

export function isScheduledDay(date: ISODate, workDays: number[]): boolean {
  return workDays.includes(dayOfWeek(date));
}

export function holidaySet(holidays: Holiday[]): Set<ISODate> {
  return new Set(holidays.map((h) => h.date));
}

/**
 * Working days in a range using the schedule in force on each day.
 * `excludeHolidays` is used for leave counting; proration of salary keeps holidays
 * as paid working days.
 */
export function workingDays(
  range: DateRange,
  schedules: WorkSchedule[],
  opts: { holidays?: Set<ISODate>; excludeHolidays?: boolean } = {},
): ISODate[] {
  const sorted = sortEffective(schedules);
  return eachDay(range.start, range.end).filter((day) => {
    const s = effectiveOn(sorted, day);
    if (!s || !isScheduledDay(day, s.workDays)) return false;
    if (opts.excludeHolidays && opts.holidays?.has(day)) return false;
    return true;
  });
}

export const WEEKDAY_PRESETS: { label: string; days: number[] }[] = [
  { label: "Mon–Fri", days: [1, 2, 3, 4, 5] },
  { label: "Mon–Sat", days: [1, 2, 3, 4, 5, 6] },
  { label: "Mon–Thu", days: [1, 2, 3, 4] },
  { label: "Mon, Wed, Fri", days: [1, 3, 5] },
];

export function describeWorkDays(days: number[]): string {
  const preset = WEEKDAY_PRESETS.find((p) => p.days.length === days.length && p.days.every((d) => days.includes(d)));
  if (preset) return preset.label;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return [...days].sort().map((d) => names[d]).join(", ");
}
