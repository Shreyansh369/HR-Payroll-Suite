/**
 * Pay-rate conversion. Every conversion goes through an annual amount and exposes
 * the formula used, so the UI and payslips can show exactly how a figure was derived.
 */
import { d, Decimal, type Numeric } from "@/lib/money";
import { daysInYear } from "@/lib/dates";
import type { DailyRateMethod, PayFrequency, RateBasis } from "@/domain/types";

export interface RateConfig {
  weeksPerYear: number;
  dailyRateMethod: DailyRateMethod;
  fixedDaysPerMonth: number;
}

export interface ScheduleShape {
  daysPerWeek: number;
  hoursPerDay: number;
}

export const DEFAULT_RATE_CONFIG: RateConfig = {
  weeksPerYear: 52,
  dailyRateMethod: "annual_working_days",
  fixedDaysPerMonth: 21.67,
};

export const BASIS_LABELS: Record<RateBasis, string> = {
  annual: "Annual",
  monthly: "Monthly",
  semi_monthly: "Semi-monthly",
  biweekly: "Biweekly",
  weekly: "Weekly",
  daily: "Daily",
  hourly: "Hourly",
};

export const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  semi_monthly: "Semi-monthly",
  monthly: "Monthly",
};

export const DAILY_METHOD_LABELS: Record<DailyRateMethod, string> = {
  annual_working_days: "Annual ÷ working days per year",
  fixed_days_per_month: "Monthly ÷ fixed days per month",
  calendar_days: "Annual ÷ calendar days in year",
};

export function periodsPerYear(frequency: PayFrequency, weeksPerYear: number): Decimal {
  switch (frequency) {
    case "monthly":
      return d(12);
    case "semi_monthly":
      return d(24);
    case "biweekly":
      return d(weeksPerYear).div(2);
    case "weekly":
      return d(weeksPerYear);
  }
}

function assertSchedule(schedule: ScheduleShape) {
  if (!(schedule.daysPerWeek > 0) || !(schedule.hoursPerDay > 0)) {
    throw new Error("A work schedule with at least one working day and positive hours is required.");
  }
}

/** Convert an amount expressed on any basis into an annual amount. */
export function annualize(
  amount: Numeric,
  basis: RateBasis,
  schedule: ScheduleShape,
  config: RateConfig,
  year = 2026,
): Decimal {
  const a = d(amount);
  const wpy = d(config.weeksPerYear);
  switch (basis) {
    case "annual":
      return a;
    case "monthly":
      return a.times(12);
    case "semi_monthly":
      return a.times(24);
    case "biweekly":
      return a.times(wpy.div(2));
    case "weekly":
      return a.times(wpy);
    case "daily":
      assertSchedule(schedule);
      if (config.dailyRateMethod === "fixed_days_per_month") return a.times(config.fixedDaysPerMonth).times(12);
      if (config.dailyRateMethod === "calendar_days") return a.times(daysInYear(year));
      return a.times(schedule.daysPerWeek).times(wpy);
    case "hourly":
      assertSchedule(schedule);
      return a.times(schedule.hoursPerDay).times(schedule.daysPerWeek).times(wpy);
  }
}

export interface RateEquivalents {
  annual: Decimal;
  monthly: Decimal;
  semiMonthly: Decimal;
  biweekly: Decimal;
  weekly: Decimal;
  daily: Decimal;
  hourly: Decimal;
  formulas: Record<"annual" | "monthly" | "semiMonthly" | "biweekly" | "weekly" | "daily" | "hourly", string>;
  assumptions: string[];
}

const fmt = (x: Decimal, dp = 2) => x.toDecimalPlaces(dp).toString();

/**
 * All rate equivalents for one rate. The entered basis is returned unchanged
 * (no round-trip drift); other bases derive from the annual amount.
 */
export function rateEquivalents(
  amount: Numeric,
  basis: RateBasis,
  schedule: ScheduleShape,
  config: RateConfig,
  year = 2026,
): RateEquivalents {
  assertSchedule(schedule);
  const a = d(amount);
  const annual = annualize(a, basis, schedule, config, year);
  const wpy = d(config.weeksPerYear);
  const workingDaysPerYear = wpy.times(schedule.daysPerWeek);
  const hoursPerYear = workingDaysPerYear.times(schedule.hoursPerDay);

  const monthly = basis === "monthly" ? a : annual.div(12);
  const semiMonthly = basis === "semi_monthly" ? a : annual.div(24);
  const biweekly = basis === "biweekly" ? a : annual.div(wpy.div(2));
  const weekly = basis === "weekly" ? a : annual.div(wpy);

  let daily: Decimal;
  let dailyFormula: string;
  switch (config.dailyRateMethod) {
    case "fixed_days_per_month":
      daily = monthly.div(config.fixedDaysPerMonth);
      dailyFormula = `monthly ${fmt(monthly)} ÷ ${config.fixedDaysPerMonth} days per month`;
      break;
    case "calendar_days":
      daily = annual.div(daysInYear(year));
      dailyFormula = `annual ${fmt(annual)} ÷ ${daysInYear(year)} calendar days (${year})`;
      break;
    default:
      daily = annual.div(workingDaysPerYear);
      dailyFormula = `annual ${fmt(annual)} ÷ (${schedule.daysPerWeek} days × ${config.weeksPerYear} weeks)`;
  }
  if (basis === "daily") {
    daily = a;
    dailyFormula = `entered daily rate`;
  }

  let hourly: Decimal;
  let hourlyFormula: string;
  if (basis === "hourly") {
    hourly = a;
    hourlyFormula = "entered hourly rate";
  } else if (config.dailyRateMethod === "calendar_days") {
    hourly = annual.div(hoursPerYear);
    hourlyFormula = `annual ${fmt(annual)} ÷ (${schedule.hoursPerDay} h × ${schedule.daysPerWeek} days × ${config.weeksPerYear} weeks)`;
  } else {
    hourly = daily.div(schedule.hoursPerDay);
    hourlyFormula = `daily ${fmt(daily, 4)} ÷ ${schedule.hoursPerDay} hours per day`;
  }

  const annualFormula: Record<RateBasis, string> = {
    annual: "entered annual amount",
    monthly: `${fmt(a)} × 12 months`,
    semi_monthly: `${fmt(a)} × 24 periods`,
    biweekly: `${fmt(a)} × ${fmt(wpy.div(2), 4)} periods`,
    weekly: `${fmt(a)} × ${config.weeksPerYear} weeks`,
    daily:
      config.dailyRateMethod === "fixed_days_per_month"
        ? `${fmt(a)} × ${config.fixedDaysPerMonth} days × 12 months`
        : config.dailyRateMethod === "calendar_days"
          ? `${fmt(a)} × ${daysInYear(year)} calendar days`
          : `${fmt(a)} × ${schedule.daysPerWeek} days × ${config.weeksPerYear} weeks`,
    hourly: `${fmt(a)} × ${schedule.hoursPerDay} h × ${schedule.daysPerWeek} days × ${config.weeksPerYear} weeks`,
  };

  return {
    annual,
    monthly,
    semiMonthly,
    biweekly,
    weekly,
    daily,
    hourly,
    formulas: {
      annual: annualFormula[basis],
      monthly: basis === "monthly" ? "entered monthly amount" : `annual ${fmt(annual)} ÷ 12`,
      semiMonthly: basis === "semi_monthly" ? "entered semi-monthly amount" : `annual ${fmt(annual)} ÷ 24`,
      biweekly:
        basis === "biweekly" ? "entered biweekly amount" : `annual ${fmt(annual)} ÷ ${fmt(wpy.div(2), 4)}`,
      weekly: basis === "weekly" ? "entered weekly amount" : `annual ${fmt(annual)} ÷ ${config.weeksPerYear}`,
      daily: dailyFormula,
      hourly: hourlyFormula,
    },
    assumptions: [
      `${schedule.daysPerWeek} working days per week, ${schedule.hoursPerDay} hours per day`,
      `${config.weeksPerYear} weeks per year`,
      `Daily rate method: ${DAILY_METHOD_LABELS[config.dailyRateMethod]}`,
    ],
  };
}

/** Salary amount for one pay period of the given frequency. */
export function periodAmount(
  amount: Numeric,
  basis: RateBasis,
  frequency: PayFrequency,
  schedule: ScheduleShape,
  config: RateConfig,
  year = 2026,
): Decimal {
  if (
    (basis === "monthly" && frequency === "monthly") ||
    (basis === "semi_monthly" && frequency === "semi_monthly") ||
    (basis === "biweekly" && frequency === "biweekly") ||
    (basis === "weekly" && frequency === "weekly")
  ) {
    return d(amount);
  }
  return annualize(amount, basis, schedule, config, year).div(periodsPerYear(frequency, config.weeksPerYear));
}
