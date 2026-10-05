/**
 * Generic, effective-dated statutory contribution engine.
 *
 * This module contains no jurisdiction-specific numbers. Rates, ceilings,
 * thresholds and eligibility come from `StatutoryRule` records that must be
 * approved by the customer's payroll/accounting professional.
 */
import { d, Decimal, money, round, minD, maxD, formatMoney, formatPercent } from "@/lib/money";
import type { ISODate } from "@/lib/dates";
import { periodsPerYear } from "@/domain/payroll/rates";
import type {
  AmountPeriod,
  EmploymentType,
  PayFrequency,
  StatutoryApplication,
  StatutoryRule,
  StatutoryType,
} from "@/domain/types";

export const STATUTORY_TYPE_LABELS: Record<StatutoryType, string> = {
  social_security: "Social Security",
  nhi: "National Health Insurance",
  payroll_tax: "Payroll Tax",
  other: "Other statutory",
};

export const STATUTORY_SHORT_LABELS: Record<StatutoryType, string> = {
  social_security: "Social Security",
  nhi: "NHI",
  payroll_tax: "Payroll Tax",
  other: "Other",
};

/** Rules in force on `date`, one per code (latest effectiveFrom wins). Retired/draft rules are ignored. */
export function selectRules(rules: StatutoryRule[], date: ISODate): StatutoryRule[] {
  const byCode = new Map<string, StatutoryRule>();
  for (const r of rules) {
    if (r.status === "retired" || r.status === "draft") continue;
    if (r.effectiveFrom > date) continue;
    if (r.effectiveTo && r.effectiveTo < date) continue;
    const cur = byCode.get(r.code);
    if (!cur || r.effectiveFrom > cur.effectiveFrom) byCode.set(r.code, r);
  }
  const order: StatutoryType[] = ["social_security", "nhi", "payroll_tax", "other"];
  return [...byCode.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.code.localeCompare(b.code));
}

/** Detect overlapping effective intervals for the same code (data-integrity check). */
export function findOverlaps(rules: StatutoryRule[]): [StatutoryRule, StatutoryRule][] {
  const active = rules.filter((r) => r.status !== "retired" && r.status !== "draft");
  const out: [StatutoryRule, StatutoryRule][] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.code !== b.code) continue;
      const aEnd = a.effectiveTo ?? "9999-12-31";
      const bEnd = b.effectiveTo ?? "9999-12-31";
      if (a.effectiveFrom <= bEnd && b.effectiveFrom <= aEnd) out.push([a, b]);
    }
  }
  return out;
}

export function perPeriodAmount(amount: number, period: AmountPeriod, frequency: PayFrequency, weeksPerYear: number): Decimal {
  const ppy = periodsPerYear(frequency, weeksPerYear);
  switch (period) {
    case "annual":
      return d(amount).div(ppy);
    case "monthly":
      return d(amount).times(12).div(ppy);
    case "weekly":
      return d(amount).times(weeksPerYear).div(ppy);
  }
}

function annualAmount(amount: number, period: AmountPeriod, weeksPerYear: number): Decimal {
  switch (period) {
    case "annual":
      return d(amount);
    case "monthly":
      return d(amount).times(12);
    case "weekly":
      return d(amount).times(weeksPerYear);
  }
}

export function employerRateFor(rule: StatutoryRule, headcount: number): number {
  if (rule.employerRateTiers && rule.employerRateTiers.length > 0) {
    const tiers = [...rule.employerRateTiers].sort(
      (a, b) => (a.maxEmployees ?? Infinity) - (b.maxEmployees ?? Infinity),
    );
    const tier = tiers.find((t) => t.maxEmployees === null || headcount <= t.maxEmployees);
    return tier ? tier.rate : rule.employerRate;
  }
  return rule.employerRate;
}

export interface StatutoryContext {
  /** Statutory remuneration before pre-tax deductions (taxable earnings only). */
  grossBase: number;
  /** grossBase minus pre-tax deductions. */
  taxableBase: number;
  frequency: PayFrequency;
  weeksPerYear: number;
  /** Age at the end of the pay period; null when date of birth is unknown. */
  age: number | null;
  employmentType: EmploymentType;
  headcount: number;
  /** Contributable base already used this calendar year, by rule code (annual ceilings). */
  ytdContributable: Record<string, number>;
  currency: string;
}

export function applyRule(rule: StatutoryRule, ctx: StatutoryContext): StatutoryApplication {
  const base = d(rule.base === "gross" ? ctx.grossBase : ctx.taxableBase);
  const employerRate = employerRateFor(rule, ctx.headcount);
  const fm = (x: Decimal | number) => formatMoney(money(x), ctx.currency);
  const result = (
    partial: Partial<Omit<StatutoryApplication, "contributableBase">> & { contributableBase: Decimal; explanation: string },
  ): StatutoryApplication => {
    const contributable = partial.contributableBase;
    const employeeAmount = money(round(contributable.times(rule.employeeRate), rule.rounding));
    const employerAmount = money(round(contributable.times(employerRate), rule.rounding));
    return {
      ruleId: rule.id,
      code: rule.code,
      name: rule.name,
      type: rule.type,
      status: rule.status,
      effectiveFrom: rule.effectiveFrom,
      employeeRate: rule.employeeRate,
      employerRate,
      base: money(base),
      exemptAmount: partial.exemptAmount ?? 0,
      ceilingApplied: partial.ceilingApplied ?? false,
      contributableBase: money(contributable),
      employeeAmount,
      employerAmount,
      explanation: partial.explanation,
    };
  };

  // Eligibility
  const el = rule.eligibility;
  if (el) {
    if (el.exemptEmploymentTypes?.includes(ctx.employmentType)) {
      return result({ contributableBase: d(0), explanation: `Not applicable: ${ctx.employmentType.replace("_", "-")} employment is exempt` });
    }
    if (ctx.age !== null) {
      if (el.minAge != null && ctx.age < el.minAge) {
        return result({ contributableBase: d(0), explanation: `Not applicable: age ${ctx.age} is below minimum ${el.minAge}` });
      }
      if (el.maxAge != null && ctx.age > el.maxAge) {
        return result({ contributableBase: d(0), explanation: `Not applicable: age ${ctx.age} is above maximum ${el.maxAge}` });
      }
    }
  }

  const parts: string[] = [];
  let contributable = maxD(base, 0);
  let exempt = d(0);

  if (rule.threshold && rule.threshold.amount > 0) {
    const t = perPeriodAmount(rule.threshold.amount, rule.threshold.period, ctx.frequency, ctx.weeksPerYear);
    if (rule.threshold.mode === "exempt_amount") {
      exempt = minD(contributable, t);
      contributable = contributable.minus(exempt);
      parts.push(`first ${fm(t)} per period exempt`);
    } else if (contributable.lt(t)) {
      return result({
        contributableBase: d(0),
        explanation: `Below minimum earnings of ${fm(t)} per period — no contribution`,
      });
    }
  }

  let ceilingApplied = false;
  if (rule.ceiling && rule.ceiling.amount > 0) {
    if (rule.ceiling.mode === "annual_cumulative") {
      const annualCap = annualAmount(rule.ceiling.amount, rule.ceiling.period, ctx.weeksPerYear);
      const used = d(ctx.ytdContributable[rule.code] ?? 0);
      const remaining = maxD(annualCap.minus(used), 0);
      if (contributable.gt(remaining)) {
        contributable = remaining;
        ceilingApplied = true;
        parts.push(`annual ceiling ${fm(annualCap)} reached (${fm(used)} used before this period)`);
      }
    } else {
      const cap = perPeriodAmount(rule.ceiling.amount, rule.ceiling.period, ctx.frequency, ctx.weeksPerYear);
      if (contributable.gt(cap)) {
        contributable = cap;
        ceilingApplied = true;
        parts.push(`capped at ceiling ${fm(cap)} per period`);
      }
    }
  }

  const rates = [
    rule.employeeRate > 0 ? `employee ${formatPercent(rule.employeeRate)}` : null,
    employerRate > 0 ? `employer ${formatPercent(employerRate)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const explanation = `${rates} of ${fm(contributable)}${parts.length ? ` (${parts.join("; ")})` : ""}`;

  return result({ contributableBase: contributable, exemptAmount: money(exempt), ceilingApplied, explanation });
}

export function applyStatutory(rules: StatutoryRule[], date: ISODate, ctx: StatutoryContext): StatutoryApplication[] {
  return selectRules(rules, date).map((r) => applyRule(r, ctx));
}
