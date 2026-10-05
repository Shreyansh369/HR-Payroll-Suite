/**
 * Stripe billing (production, BILLING_ENABLED=true).
 *
 * The browser is only ever redirected to Stripe-hosted pages. Access changes
 * exclusively when a signature-verified webhook arrives; the checkout success
 * redirect is never treated as proof of payment. Webhooks are idempotent.
 */
import "server-only";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { stripeEvents } from "@/db/schema";
import type { Db } from "@/repositories/database/database-repository";
import type { Repository } from "@/repositories/interfaces";
import type { License, LicenseStatus, User } from "@/domain/types";
import { PLANS } from "@/config/pricing";
import { AppError } from "@/lib/errors";
import { randomId } from "@/lib/ids";
import { addMonths } from "@/lib/dates";
import type { ServerEnv } from "@/server/env";

export type PlanChoice = "hosted" | "owned";

export function stripeClient(env: ServerEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new AppError("INTERNAL", "Billing is not configured.");
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, appInfo: { name: "hr-payroll-suite" } });
}

/** Hosted plan: recurring billing starts after the trial or the subscription-free months, whichever is later. */
export function hostedTrialEnd(purchase: Date): number {
  const trial = purchase.getTime() + PLANS.hosted.trialDays * 86400_000;
  const months = PLANS.hosted.subscriptionFreeMonthsAfterPurchase;
  const free = months > 0 ? new Date(`${addMonths(purchase.toISOString().slice(0, 10), months)}T${purchase.toISOString().slice(11)}`).getTime() : 0;
  return Math.floor(Math.max(trial, free) / 1000);
}

export async function createCheckout(
  deps: { stripe: Stripe; repo: Repository; env: ServerEnv },
  user: User,
  plan: PlanChoice,
  appUrl: string,
): Promise<string> {
  const { stripe, repo, env } = deps;
  const license = await repo.licenses.getByOrganization(user.organizationId);
  if (license && (license.status === "active" || license.status === "trialing" || license.status === "owned") && license.plan === plan) {
    throw new AppError("CONFLICT", "This plan is already active.");
  }
  const metadata = { organizationId: user.organizationId, plan, requestedBy: user.id };
  const common = {
    client_reference_id: user.organizationId,
    success_url: `${appUrl}/app/billing?checkout=success`,
    cancel_url: `${appUrl}/app/billing?checkout=cancelled`,
    metadata,
    allow_promotion_codes: false,
    ...(license?.stripeCustomerId ? { customer: license.stripeCustomerId } : { customer_email: user.email }),
  } satisfies Partial<Stripe.Checkout.SessionCreateParams>;

  if (plan === "hosted") {
    if (!env.STRIPE_PRICE_HOSTED_MONTHLY || !env.STRIPE_PRICE_HOSTED_SETUP) throw new AppError("INTERNAL", "Hosted plan prices are not configured.");
    const session = await stripe.checkout.sessions.create({
      ...common,
      mode: "subscription",
      line_items: [
        { price: env.STRIPE_PRICE_HOSTED_MONTHLY, quantity: 1 },
        { price: env.STRIPE_PRICE_HOSTED_SETUP, quantity: 1 },
      ],
      subscription_data: { trial_end: hostedTrialEnd(new Date()), metadata },
    });
    if (!session.url) throw new AppError("INTERNAL", "Stripe did not return a checkout link.");
    return session.url;
  }
  if (!env.STRIPE_PRICE_OWNED) throw new AppError("INTERNAL", "Ownership price is not configured.");
  const session = await stripe.checkout.sessions.create({
    ...common,
    mode: "payment",
    line_items: [{ price: env.STRIPE_PRICE_OWNED, quantity: 1 }],
    payment_intent_data: { metadata },
    ...(license?.stripeCustomerId ? {} : { customer_creation: "always" as const }),
    invoice_creation: { enabled: true, invoice_data: { metadata } },
  });
  if (!session.url) throw new AppError("INTERNAL", "Stripe did not return a checkout link.");
  return session.url;
}

export async function createPortal(stripe: Stripe, repo: Repository, user: User, appUrl: string): Promise<string> {
  const license = await repo.licenses.getByOrganization(user.organizationId);
  if (!license?.stripeCustomerId) throw new AppError("INVALID_STATE", "There is no billing account yet. Choose a plan first.");
  const portal = await stripe.billingPortal.sessions.create({ customer: license.stripeCustomerId, return_url: `${appUrl}/app/billing` });
  return portal.url;
}

/* ------------------------------------------------------------------ webhooks */

const STATUS: Record<string, LicenseStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "inactive",
  incomplete_expired: "canceled",
  paused: "inactive",
};

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

async function licenseFor(repo: Repository, organizationId: string | null | undefined, customerId: string | null): Promise<License | null> {
  if (organizationId) {
    const existing = await repo.licenses.getByOrganization(organizationId);
    if (existing) return existing;
    const org = await repo.organizations.get(organizationId);
    if (!org) return null;
    const at = new Date().toISOString();
    return { id: randomId("lic"), organizationId, plan: "none", status: "inactive", features: [], createdAt: at, updatedAt: at };
  }
  return customerId ? repo.licenses.getByStripeCustomer(customerId) : null;
}

async function auditBilling(repo: Repository, license: License, summary: string, event: Stripe.Event) {
  await repo.audit.append({
    id: randomId("aud"),
    organizationId: license.organizationId,
    companyId: null,
    at: new Date().toISOString(),
    actorId: "stripe",
    actorName: "Stripe webhook",
    action: "billing.updated",
    entityType: "license",
    entityId: license.id,
    summary,
    after: { plan: license.plan, status: license.status, event: event.type, eventId: event.id },
  });
}

function syncSubscription(license: License, sub: Stripe.Subscription, eventId: string): License {
  return {
    ...license,
    plan: "hosted",
    status: STATUS[sub.status] ?? "inactive",
    stripeCustomerId: idOf(sub.customer),
    stripeSubscriptionId: sub.id,
    trialStart: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : (license.trialStart ?? null),
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    activatedAt: license.activatedAt ?? new Date().toISOString(),
    lastEventId: eventId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Applies a verified Stripe event. Returns false when the event was already
 * processed (idempotency) or is irrelevant.
 */
export async function applyStripeEvent(
  deps: { db: Db; repo: Repository; retrieveSubscription: (id: string) => Promise<Stripe.Subscription>; now?: () => Date },
  event: Stripe.Event,
): Promise<boolean> {
  const inserted = await deps.db.insert(stripeEvents).values({ id: event.id, type: event.type, receivedAt: (deps.now?.() ?? new Date()).toISOString() }).onConflictDoNothing().returning({ id: stripeEvents.id });
  if (!inserted.length) return false;
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object;
        const license = await licenseFor(deps.repo, s.metadata?.organizationId ?? s.client_reference_id, idOf(s.customer));
        if (!license) return false;
        if (s.mode === "payment") {
          if (s.payment_status !== "paid") return false; // async methods: wait for async_payment_succeeded
          const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
          const next: License = {
            ...license,
            plan: "owned",
            status: "owned",
            stripeCustomerId: idOf(s.customer) ?? license.stripeCustomerId ?? null,
            stripeCheckoutSessionId: s.id,
            activatedAt: new Date().toISOString(),
            subscriptionFreeUntil: addMonths(today, PLANS.owned.subscriptionFreeMonths),
            maintenanceUntil: addMonths(today, PLANS.owned.includedMaintenanceMonths),
            lastEventId: event.id,
            updatedAt: new Date().toISOString(),
          };
          await deps.repo.licenses.upsert(next);
          await auditBilling(deps.repo, next, "Ownership licence activated after confirmed payment", event);
          return true;
        }
        const subId = idOf(s.subscription);
        if (!subId) return false;
        const next = syncSubscription({ ...license, stripeCheckoutSessionId: s.id }, await deps.retrieveSubscription(subId), event.id);
        await deps.repo.licenses.upsert(next);
        await auditBilling(deps.repo, next, `Subscription started (${next.status})`, event);
        return true;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const license = await licenseFor(deps.repo, sub.metadata?.organizationId, idOf(sub.customer));
        if (!license) return false;
        // An ownership licence is never downgraded by subscription events.
        if (license.plan === "owned" && license.status === "owned") return false;
        const next = syncSubscription(license, event.type === "customer.subscription.deleted" ? { ...sub, status: "canceled" } : sub, event.id);
        await deps.repo.licenses.upsert(next);
        await auditBilling(deps.repo, next, `Subscription ${event.type.split(".").pop()} → ${next.status}`, event);
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    // Allow Stripe to retry: forget the event so the retry is processed.
    await deps.db.delete(stripeEvents).where(eq(stripeEvents.id, event.id));
    throw e;
  }
}
