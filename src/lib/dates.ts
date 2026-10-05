/**
 * Calendar-date helpers that operate on ISO `YYYY-MM-DD` strings.
 *
 * Payroll works with calendar dates, not instants, so every helper here uses UTC
 * internally to stay independent of the host time zone.
 */

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toDate(iso: ISODate): Date {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function fromDate(d: Date): ISODate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${m}-${day}`;
}

/** Today's calendar date for the given IANA time zone (defaults to UTC). */
export function todayISO(timeZone = "UTC", now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromDate(new Date(toDate(iso).getTime() + days * DAY_MS));
}

export function addMonths(iso: ISODate, months: number): ISODate {
  const d = toDate(iso);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(day, last));
  return fromDate(target);
}

export function addYears(iso: ISODate, years: number): ISODate {
  return addMonths(iso, years * 12);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(...dates: (ISODate | null | undefined)[]): ISODate {
  const xs = dates.filter((d): d is ISODate => !!d);
  return xs.reduce((a, b) => (a < b ? a : b));
}

export function maxDate(...dates: (ISODate | null | undefined)[]): ISODate {
  const xs = dates.filter((d): d is ISODate => !!d);
  return xs.reduce((a, b) => (a > b ? a : b));
}

/** Inclusive number of calendar days from `start` to `end`. */
export function daysInclusive(start: ISODate, end: ISODate): number {
  if (end < start) return 0;
  return Math.round((toDate(end).getTime() - toDate(start).getTime()) / DAY_MS) + 1;
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  if (end < start) return out;
  let cur = toDate(start).getTime();
  const last = toDate(end).getTime();
  while (cur <= last) {
    out.push(fromDate(new Date(cur)));
    cur += DAY_MS;
  }
  return out;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: ISODate): number {
  return toDate(iso).getUTCDay();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function yearOf(iso: ISODate): number {
  return +iso.slice(0, 4);
}

export function monthOf(iso: ISODate): number {
  return +iso.slice(5, 7);
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: ISODate): ISODate {
  const y = yearOf(iso);
  const m = monthOf(iso);
  return `${iso.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function startOfYear(iso: ISODate): ISODate {
  return `${iso.slice(0, 4)}-01-01`;
}

export function endOfYear(iso: ISODate): ISODate {
  return `${iso.slice(0, 4)}-12-31`;
}

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

export function overlap(a: DateRange, b: DateRange): DateRange | null {
  const start = maxDate(a.start, b.start);
  const end = minDate(a.end, b.end);
  return start <= end ? { start, end } : null;
}

export function inRange(iso: ISODate, range: DateRange): boolean {
  return iso >= range.start && iso <= range.end;
}

/** Completed whole years between two dates (age, tenure). */
export function wholeYearsBetween(from: ISODate, to: ISODate): number {
  const a = toDate(from);
  const b = toDate(to);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  const beforeAnniversary =
    b.getUTCMonth() < a.getUTCMonth() ||
    (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return years;
}

/**
 * Next occurrence (on or after `from`) of the month/day of `iso`.
 * 29 February falls back to 28 February in non-leap years.
 */
export function nextAnniversary(iso: ISODate, from: ISODate): ISODate {
  const month = monthOf(iso);
  const day = +iso.slice(8, 10);
  const build = (year: number) => {
    const d = Math.min(day, daysInMonth(year, month));
    return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  const y = yearOf(from);
  const candidate = build(y);
  return candidate >= from ? candidate : build(y + 1);
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function monthName(month1: number, style: "short" | "long" = "short"): string {
  return (style === "short" ? MONTHS_SHORT : MONTHS_LONG)[month1 - 1];
}

export function weekdayName(dow: number): string {
  return WEEKDAYS_SHORT[dow];
}

/** "5 Oct 2026" */
export function formatDate(iso: ISODate | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return "—";
  const d = +iso.slice(8, 10);
  const m = monthName(monthOf(iso));
  return opts.year === false ? `${d} ${m}` : `${d} ${m} ${yearOf(iso)}`;
}

/** "1–15 Oct 2026", "28 Sep – 11 Oct 2026", "16 Dec 2026 – 15 Jan 2027" */
export function formatRange(start: ISODate, end: ISODate): string {
  if (start === end) return formatDate(start);
  if (yearOf(start) !== yearOf(end)) return `${formatDate(start)} – ${formatDate(end)}`;
  if (monthOf(start) !== monthOf(end)) return `${formatDate(start, { year: false })} – ${formatDate(end)}`;
  return `${+start.slice(8, 10)}–${formatDate(end)}`;
}

export function formatDateTime(isoDateTime: string | null | undefined): string {
  if (!isoDateTime) return "—";
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return "—";
  const date = formatDate(fromDate(d));
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date}, ${hh}:${mm} UTC`;
}
