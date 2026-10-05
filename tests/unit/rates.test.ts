import { describe, expect, it } from "vitest";
import { annualize, periodAmount, rateEquivalents, DEFAULT_RATE_CONFIG } from "@/domain/payroll/rates";
import { money, round } from "@/lib/money";

const FIVE_BY_EIGHT = { daysPerWeek: 5, hoursPerDay: 8 };
const n = (x: { toDecimalPlaces: (dp: number) => { toString(): string } }, dp = 2) => Number(x.toDecimalPlaces(dp).toString());

describe("rate equivalents", () => {
  it("converts a monthly salary on a 5-day / 40-hour schedule", () => {
    const eq = rateEquivalents(2000, "monthly", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG, 2026);
    expect(n(eq.annual)).toBe(24000);
    expect(n(eq.monthly)).toBe(2000);
    expect(n(eq.semiMonthly)).toBe(1000);
    expect(n(eq.biweekly)).toBe(923.08);
    expect(n(eq.weekly)).toBe(461.54);
    expect(n(eq.daily, 4)).toBe(92.3077);
    expect(n(eq.hourly, 4)).toBe(11.5385);
    expect(eq.formulas.daily).toContain("5 days × 52 weeks");
    expect(eq.assumptions).toHaveLength(3);
  });

  it("handles a 6-day schedule", () => {
    const eq = rateEquivalents(2000, "monthly", { daysPerWeek: 6, hoursPerDay: 7 }, DEFAULT_RATE_CONFIG);
    expect(n(eq.daily, 4)).toBe(76.9231);
    expect(n(eq.hourly, 4)).toBe(10.989);
  });

  it("handles a part-time hourly schedule without round-trip drift", () => {
    const eq = rateEquivalents(15, "hourly", { daysPerWeek: 3, hoursPerDay: 6 }, DEFAULT_RATE_CONFIG);
    expect(n(eq.annual)).toBe(14040);
    expect(n(eq.monthly)).toBe(1170);
    expect(n(eq.hourly)).toBe(15);
    expect(n(eq.daily)).toBe(90);
  });

  it("supports the fixed-days-per-month method", () => {
    const eq = rateEquivalents(2000, "monthly", FIVE_BY_EIGHT, { ...DEFAULT_RATE_CONFIG, dailyRateMethod: "fixed_days_per_month", fixedDaysPerMonth: 21.67 });
    expect(n(eq.daily, 4)).toBe(92.2935);
    expect(eq.formulas.daily).toContain("21.67");
  });

  it("uses 366 days in a leap year for the calendar-day method", () => {
    const cfg = { ...DEFAULT_RATE_CONFIG, dailyRateMethod: "calendar_days" as const };
    expect(n(rateEquivalents(36600, "annual", FIVE_BY_EIGHT, cfg, 2024).daily)).toBe(100);
    expect(n(rateEquivalents(36600, "annual", FIVE_BY_EIGHT, cfg, 2026).daily, 4)).toBe(100.274);
  });

  it("annualizes every basis consistently", () => {
    expect(n(annualize(1000, "weekly", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG))).toBe(52000);
    expect(n(annualize(2000, "biweekly", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG))).toBe(52000);
    expect(n(annualize(2000, "semi_monthly", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG))).toBe(48000);
    expect(n(annualize(200, "daily", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG))).toBe(52000);
    expect(n(annualize(25, "hourly", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG))).toBe(52000);
  });

  it("rejects an empty schedule", () => {
    expect(() => rateEquivalents(10, "hourly", { daysPerWeek: 0, hoursPerDay: 8 }, DEFAULT_RATE_CONFIG)).toThrow();
  });
});

describe("period amounts for each pay frequency", () => {
  it("divides an annual salary by periods per year", () => {
    const pa = (f: "weekly" | "biweekly" | "semi_monthly" | "monthly") => money(periodAmount(52000, "annual", f, FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG));
    expect(pa("weekly")).toBe(1000);
    expect(pa("biweekly")).toBe(2000);
    expect(pa("semi_monthly")).toBe(2166.67);
    expect(pa("monthly")).toBe(4333.33);
  });

  it("passes through an amount entered on the same basis as the frequency", () => {
    expect(money(periodAmount(1234.56, "monthly", "monthly", FIVE_BY_EIGHT, DEFAULT_RATE_CONFIG))).toBe(1234.56);
  });

  it("respects weeks-per-year configuration", () => {
    const cfg = { ...DEFAULT_RATE_CONFIG, weeksPerYear: 52.1429 };
    expect(money(periodAmount(52142.9, "annual", "weekly", FIVE_BY_EIGHT, cfg))).toBe(1000);
  });
});

describe("rounding boundaries", () => {
  it("rounds half up by default without floating-point error", () => {
    expect(money(0.005)).toBe(0.01);
    expect(money(2.675)).toBe(2.68);
    expect(money(1.004999)).toBe(1);
    expect(money(-0.005)).toBe(-0.01);
  });

  it("supports banker's rounding, truncation and rounding up", () => {
    expect(Number(round(0.005, "half_even").toString())).toBe(0);
    expect(Number(round(0.015, "half_even").toString())).toBe(0.02);
    expect(Number(round(1.239, "down").toString())).toBe(1.23);
    expect(Number(round(1.231, "up").toString())).toBe(1.24);
  });
});
