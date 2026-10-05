/**
 * Pay period generation for weekly, biweekly, semi-monthly and monthly calendars.
 */
import {
  addDays,
  diffDays,
  endOfMonth,
  startOfMonth,
  type ISODate,
  daysInMonth,
  yearOf,
  monthOf,
  formatRange,
  monthName,
} from "@/lib/dates";
import type { PayCalendar, PayFrequency } from "@/domain/types";

export interface PayPeriod {
  frequency: PayFrequency;
  start: ISODate;
  end: ISODate;
  payDate: ISODate;
}

function withPayDate(calendar: PayCalendar, start: ISODate, end: ISODate): PayPeriod {
  return { frequency: calendar.frequency, start, end, payDate: addDays(end, calendar.payDateOffsetDays) };
}

/** The pay period that contains `date`. */
export function periodContaining(calendar: PayCalendar, date: ISODate): PayPeriod {
  switch (calendar.frequency) {
    case "monthly":
      return withPayDate(calendar, startOfMonth(date), endOfMonth(date));
    case "semi_monthly": {
      const day = +date.slice(8, 10);
      const mid = `${date.slice(0, 7)}-15`;
      return day <= 15
        ? withPayDate(calendar, startOfMonth(date), mid)
        : withPayDate(calendar, `${date.slice(0, 7)}-16`, endOfMonth(date));
    }
    case "weekly":
    case "biweekly": {
      const length = calendar.frequency === "weekly" ? 7 : 14;
      const offset = diffDays(calendar.anchorDate, date);
      const index = Math.floor(offset / length);
      const start = addDays(calendar.anchorDate, index * length);
      return withPayDate(calendar, start, addDays(start, length - 1));
    }
  }
}

export function nextPeriod(calendar: PayCalendar, previous: { end: ISODate }): PayPeriod {
  return periodContaining(calendar, addDays(previous.end, 1));
}

export function previousPeriod(calendar: PayCalendar, current: { start: ISODate }): PayPeriod {
  return periodContaining(calendar, addDays(current.start, -1));
}

/** Validates that a period lines up with the calendar. */
export function isAlignedPeriod(calendar: PayCalendar, start: ISODate, end: ISODate): boolean {
  const p = periodContaining(calendar, start);
  return p.start === start && p.end === end;
}

export function periodLabel(frequency: PayFrequency, start: ISODate, end: ISODate): string {
  if (frequency === "monthly" && start === startOfMonth(start) && end === endOfMonth(start)) {
    return `${monthName(monthOf(start), "long")} ${yearOf(start)}`;
  }
  return formatRange(start, end);
}

export { daysInMonth };
