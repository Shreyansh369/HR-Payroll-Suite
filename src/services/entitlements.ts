/**
 * Server-side entitlement evaluation. A license record is only ever changed by
 * verified Stripe webhooks (or by an operator for ownership installs).
 */
import type { License } from "@/domain/types";
import type { AppMode, Entitlements, Feature } from "@/services/core";
import { PLANS } from "@/config/pricing";

const ALL_FEATURES: Feature[] = ["hr", "payroll", "imports", "reports", "accounting", "multi_company"];

export function demoEntitlements(): Entitlements {
  return { active: true, plan: "demo", status: "active", features: new Set(ALL_FEATURES), employeeLimit: null, reason: null };
}

export function evaluateEntitlements(license: License | null, mode: AppMode, now: Date, billingEnabled: boolean): Entitlements {
  if (mode === "demo") return demoEntitlements();
  // Self-hosted ownership installs without billing are fully licensed by configuration.
  if (!billingEnabled) return { active: true, plan: license?.plan ?? "owned", status: license?.status ?? "owned", features: new Set(ALL_FEATURES), employeeLimit: license?.employeeLimit ?? null, reason: null };
  if (!license) {
    return { active: false, plan: "none", status: "inactive", features: new Set(ALL_FEATURES), employeeLimit: null, reason: "No active plan. Start a trial or choose a plan in Billing." };
  }
  const features = new Set<Feature>((license.features.length ? license.features : ALL_FEATURES) as Feature[]);
  const limit = license.employeeLimit ?? (license.plan === "hosted" ? PLANS.hosted.employeeLimit : license.plan === "owned" ? PLANS.owned.employeeLimit : null);
  switch (license.status) {
    case "trialing": {
      const ended = license.trialEnd && new Date(license.trialEnd) < now;
      return ended
        ? { active: false, plan: license.plan, status: license.status, features, employeeLimit: limit, reason: "Your trial has ended. Add a payment method in Billing to continue." }
        : { active: true, plan: license.plan, status: license.status, features, employeeLimit: limit, reason: null };
    }
    case "active":
    case "owned":
      return { active: true, plan: license.plan, status: license.status, features, employeeLimit: limit, reason: null };
    case "past_due":
      // Grace: keep access but surface the payment problem.
      return { active: true, plan: license.plan, status: license.status, features, employeeLimit: limit, reason: "Your last payment failed. Update your payment method in Billing." };
    default:
      return { active: false, plan: license.plan, status: license.status, features, employeeLimit: limit, reason: "Your subscription is not active. Reactivate it in Billing to make changes." };
  }
}
