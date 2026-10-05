/**
 * Commercial configuration. Change prices and terms here; components and the
 * comparison calculator read from this object. Never hard-code savings.
 */
export interface HostedPlan {
  id: "hosted";
  name: string;
  setupFee: number;
  trialDays: number;
  recurringMonthly: number;
  /** Recurring subscription waived for this many calendar months after purchase (D-017). */
  subscriptionFreeMonthsAfterPurchase: number;
  employeeLimit: number | null;
  includes: string[];
}

export interface OwnedPlan {
  id: "owned";
  name: string;
  oneTime: number;
  subscriptionFreeMonths: number;
  includedMaintenanceMonths: number;
  /** Optional maintenance after the included period; null = quoted per contract. */
  maintenanceMonthlyAfterIncluded: number | null;
  /** Whether optional maintenance is included in the first-year comparison. */
  includeMaintenanceInComparison: boolean;
  employeeLimit: number | null;
  includes: string[];
}

export const CURRENCY = "USD";

export const PLANS: { hosted: HostedPlan; owned: OwnedPlan } = {
  hosted: {
    id: "hosted",
    name: "Flexible Subscription",
    setupFee: 599,
    trialDays: 7,
    recurringMonthly: 149,
    subscriptionFreeMonthsAfterPurchase: 2,
    employeeLimit: null,
    includes: [
      "Hosted, backed-up and updated for you",
      "All HR and payroll modules",
      "Multiple companies",
      "Guided data import and setup",
      "Email support",
    ],
  },
  owned: {
    id: "owned",
    name: "Own the Software",
    oneTime: 1299,
    subscriptionFreeMonths: 12,
    includedMaintenanceMonths: 3,
    maintenanceMonthlyAfterIncluded: null,
    includeMaintenanceInComparison: false,
    employeeLimit: null,
    includes: [
      "Perpetual licence for your organisation",
      "All HR and payroll modules",
      "Deploy on your own infrastructure or ours",
      "Guided data import and setup",
      "3 months of maintenance and support included",
    ],
  },
};

export interface ComparisonLine {
  label: string;
  amount: number;
}

export interface PlanComparison {
  months: number;
  hosted: { total: number; lines: ComparisonLine[]; billableMonths: number };
  owned: { total: number; lines: ComparisonLine[] };
  difference: number;
  cheaper: "hosted" | "owned" | "equal";
  assumptions: string[];
}

/** First-N-month cost comparison derived entirely from the plan configuration. */
export function comparePlans(months = 12, plans = PLANS): PlanComparison {
  const h = plans.hosted;
  const o = plans.owned;
  const billableMonths = Math.max(0, months - h.subscriptionFreeMonthsAfterPurchase);
  const hostedLines: ComparisonLine[] = [
    { label: "One-time setup", amount: h.setupFee },
    { label: `${billableMonths} × $${h.recurringMonthly}/month subscription`, amount: billableMonths * h.recurringMonthly },
  ];
  const ownedLines: ComparisonLine[] = [{ label: "One-time licence", amount: o.oneTime }];
  const assumptions = [
    h.subscriptionFreeMonthsAfterPurchase > 0
      ? `Flexible Subscription: no recurring charge for the first ${h.subscriptionFreeMonthsAfterPurchase} calendar months after purchase, then $${h.recurringMonthly}/month.`
      : `Flexible Subscription: $${h.recurringMonthly}/month from purchase.`,
    `Own the Software: no software subscription for ${o.subscriptionFreeMonths} months; ${o.includedMaintenanceMonths} months of maintenance included.`,
  ];
  const paidMaintenanceMonths = Math.max(0, Math.min(months, o.subscriptionFreeMonths) - o.includedMaintenanceMonths);
  if (o.includeMaintenanceInComparison && o.maintenanceMonthlyAfterIncluded && paidMaintenanceMonths > 0) {
    ownedLines.push({ label: `${paidMaintenanceMonths} × $${o.maintenanceMonthlyAfterIncluded}/month optional maintenance`, amount: paidMaintenanceMonths * o.maintenanceMonthlyAfterIncluded });
  } else if (paidMaintenanceMonths > 0) {
    assumptions.push(`Optional maintenance after month ${o.includedMaintenanceMonths} is not included in this comparison${o.maintenanceMonthlyAfterIncluded ? ` ($${o.maintenanceMonthlyAfterIncluded}/month if purchased)` : " and is quoted separately"}.`);
  }
  if (months > o.subscriptionFreeMonths) assumptions.push(`Ownership costs after month ${o.subscriptionFreeMonths} depend on the final contract and are not included.`);
  assumptions.push("Prices exclude any applicable taxes. Card processing fees may apply depending on the merchant setup.");
  const hostedTotal = hostedLines.reduce((s, l) => s + l.amount, 0);
  const ownedTotal = ownedLines.reduce((s, l) => s + l.amount, 0);
  const difference = Math.abs(hostedTotal - ownedTotal);
  return {
    months,
    hosted: { total: hostedTotal, lines: hostedLines, billableMonths },
    owned: { total: ownedTotal, lines: ownedLines },
    difference,
    cheaper: hostedTotal === ownedTotal ? "equal" : ownedTotal < hostedTotal ? "owned" : "hosted",
    assumptions,
  };
}
