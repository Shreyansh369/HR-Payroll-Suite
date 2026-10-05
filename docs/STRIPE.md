# Stripe billing setup

Billing applies only to hosted (SaaS) production deployments. Demo mode and self-hosted
ownership installs leave `BILLING_ENABLED=false`.

> **Merchant eligibility.** Stripe does not currently support businesses based in the
> British Virgin Islands. The selling entity and its Stripe account country must be
> confirmed before enabling billing (DECISIONS.md D-016). Without Stripe, sell by invoice
> and leave billing off.

## How it works

1. A user with `billing.manage` clicks a plan in **Billing**.
2. `POST /api/billing/checkout` creates a Stripe Checkout Session and returns its URL.
3. The browser goes to Stripe's hosted page. Card details never reach this application.
4. Stripe calls `POST /api/billing/webhook`. The signature is verified with
   `STRIPE_WEBHOOK_SECRET`; the event id is stored for idempotency; the organisation's
   licence is updated and audited.
5. The success redirect (`/app/billing?checkout=success`) only shows "waiting for
   confirmation" and polls. **It never grants access.**

Handled events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`customer.subscription.created|updated|deleted`. An ownership licence is never
downgraded by subscription events.

## 1. Products and prices

Create these in the Stripe dashboard (test mode first). Amounts must match
`src/config/pricing.ts`:

| Env variable | Product | Price |
|---|---|---|
| `STRIPE_PRICE_HOSTED_MONTHLY` | Flexible Subscription | $149.00 USD, recurring monthly |
| `STRIPE_PRICE_HOSTED_SETUP` | Flexible Subscription setup | $599.00 USD, one-time |
| `STRIPE_PRICE_OWNED` | Own the Software licence | $1,299.00 USD, one-time |

The hosted checkout is a subscription with `trial_end` set to the later of the 7-day
trial and purchase + `subscriptionFreeMonthsAfterPurchase` calendar months (default 2),
with the setup fee as a one-time line item. **Verify in test mode** that the setup fee
is charged at checkout and the first monthly charge falls on the expected date, and
align `src/config/pricing.ts` and the subscription terms with the final commercial offer.

## 2. Customer portal

In **Settings → Billing → Customer portal**, enable payment method updates, invoice
history and cancellation. The app opens it via `POST /api/billing/portal`.

## 3. Webhook endpoint

Add an endpoint `https://your-host/api/billing/webhook` subscribed to the events above
and copy its signing secret to `STRIPE_WEBHOOK_SECRET`.

Local testing with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
# use the printed whsec_… as STRIPE_WEBHOOK_SECRET
```

## 4. Environment

```
BILLING_ENABLED=true
STRIPE_SECRET_KEY=sk_test_…        # sk_live_… in production; server-side only
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_HOSTED_SETUP=price_…
STRIPE_PRICE_HOSTED_MONTHLY=price_…
STRIPE_PRICE_OWNED=price_…
APP_URL=https://your-host
```

Rebuild after changing `BILLING_ENABLED` (it is inlined into the browser bundle).

## 5. Test

Use card `4242 4242 4242 4242`. Then run the E2E Stripe scenario:

```bash
E2E_PRODUCTION_URL=https://staging… E2E_PRODUCTION_EMAIL=… E2E_PRODUCTION_PASSWORD=… \
E2E_STRIPE=1 pnpm test:e2e production
```

Check the licence in **Billing** and the `billing.updated` entries in the audit log.

## Entitlements

`src/services/entitlements.ts` maps the licence to access:

| Licence status | Access |
|---|---|
| trialing (before trial end), active, owned | full |
| past_due | full, with a payment warning |
| canceled, inactive, trial ended, no licence | read-only: plan-gated changes are refused |
