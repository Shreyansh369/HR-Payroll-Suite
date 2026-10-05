/**
 * Stripe webhook. The raw body is verified against STRIPE_WEBHOOK_SECRET before
 * anything is read from it; unsigned or tampered requests are rejected.
 */
import { applyStripeEvent, stripeClient } from "@/server/billing";
import { billingConfigured, serverEnv } from "@/server/env";
import { runtime } from "@/server/runtime";

export async function POST(req: Request) {
  const env = serverEnv();
  if (!billingConfigured(env)) return new Response("Billing disabled", { status: 404 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  const stripe = stripeClient(env);
  const body = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  const rt = runtime();
  try {
    const applied = await applyStripeEvent({ db: rt.db, repo: rt.repo, retrieveSubscription: (id) => stripe.subscriptions.retrieve(id) }, event);
    return Response.json({ received: true, applied });
  } catch (e) {
    console.error("[stripe] webhook processing failed", event.type, event.id, e);
    return new Response("Processing failed", { status: 500 });
  }
}
