"use client";

import { useState } from "react";
import { useQ } from "@/client/api";
import { PageHeader, Panel, PanelHeader, LoadingRows, ErrorState, Callout, DescriptionList } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PlanCards, ComparisonTable } from "@/components/billing/plan-cards";
import { useToast } from "@/components/ui/toast";
import { BILLING_ENABLED, IS_DEMO, SALES_EMAIL } from "@/config/env";
import { formatDate } from "@/lib/dates";

const PLAN_LABEL: Record<string, string> = { demo: "Demo", hosted: "Flexible Subscription", owned: "Own the Software", none: "No plan" };

async function redirectTo(endpoint: string, body: unknown): Promise<void> {
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify(body), credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
  window.location.assign(data.url);
}

export default function BillingPage() {
  const toast = useToast();
  const q = useQ("billing.status", {});
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (key: string, endpoint: string, body: unknown) => {
    setBusy(key);
    try {
      await redirectTo(endpoint, body);
    } catch (e) {
      toast.error("Billing unavailable", (e as Error).message);
      setBusy(null);
    }
  };
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState message={q.error.message} />;
  const s = q.data!;
  const license = s.license;
  const current = license?.plan === "hosted" || license?.plan === "owned" ? license.plan : null;
  const checkoutLive = BILLING_ENABLED && !IS_DEMO && s.canManage;
  const action = (plan: "hosted" | "owned") =>
    current === plan ? null : (
      <Button variant={plan === "owned" ? "primary" : "secondary"} className="w-full" disabled={!checkoutLive} loading={busy === plan} onClick={() => go(plan, "/api/billing/checkout", { plan })}>
        {plan === "hosted" ? "Start 7-day trial" : "Buy licence"}
      </Button>
    );

  return (
    <>
      <PageHeader title="Billing" description="Plan, payment and licence status. Access changes only after payment is confirmed by the payment provider — never from a browser redirect." />
      {IS_DEMO && (
        <Callout tone="warning" title="Payments are disabled in the demo" className="mb-4">
          This demo runs entirely in your browser with fictional data, so no checkout is possible here. In a production deployment with billing enabled, these buttons open a secure hosted checkout and your plan activates when the payment provider confirms it.
        </Callout>
      )}
      {!IS_DEMO && !BILLING_ENABLED && (
        <Callout tone="info" title="Billing is turned off for this installation" className="mb-4">
          This is a self-hosted or licensed installation. All features are enabled and no payments are taken in the application. Contact <a className="underline" href={`mailto:${SALES_EMAIL}`}>{SALES_EMAIL}</a> about maintenance renewals.
        </Callout>
      )}
      {s.entitlements.reason && <Callout tone={s.entitlements.active ? "warning" : "danger"} className="mb-4">{s.entitlements.reason}</Callout>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <PlanCards current={current} hostedAction={action("hosted")} ownedAction={action("owned")} />
          <ComparisonTable />
        </div>
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Current status" actions={<Badge tone={s.entitlements.active ? "success" : "danger"} dot>{s.entitlements.active ? "Active" : "Inactive"}</Badge>} />
            <div className="p-4">
              <DescriptionList
                cols={1}
                items={[
                  { label: "Plan", value: PLAN_LABEL[s.entitlements.plan] ?? s.entitlements.plan },
                  { label: "Status", value: <StatusBadge status={s.entitlements.status} /> },
                  ...(license?.trialEnd ? [{ label: "Trial ends", value: formatDate(license.trialEnd.slice(0, 10)) }] : []),
                  ...(license?.subscriptionFreeUntil ? [{ label: "No subscription until", value: formatDate(license.subscriptionFreeUntil) }] : []),
                  ...(license?.maintenanceUntil ? [{ label: "Maintenance included until", value: formatDate(license.maintenanceUntil) }] : []),
                  ...(license?.activatedAt ? [{ label: "Activated", value: formatDate(license.activatedAt.slice(0, 10)) }] : []),
                  { label: "Employee limit", value: s.entitlements.employeeLimit ?? "Unlimited" },
                ]}
              />
            </div>
            {checkoutLive && license?.hasCustomer && (
              <div className="border-t border-line p-4">
                <Button className="w-full" icon="card" loading={busy === "portal"} onClick={() => go("portal", "/api/billing/portal", {})}>Manage payment & invoices</Button>
              </div>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Good to know" />
            <ul className="space-y-2 p-4 text-[12.5px] text-ink-2">
              <li>Card details are entered on the payment provider’s hosted page and never touch this application.</li>
              <li>Cancelling a subscription keeps your data available for export; see the subscription and refund terms.</li>
              <li>Payment provider availability depends on the merchant’s country. Businesses incorporated in some territories (including the BVI) may need to invoice through a supported entity or use bank transfer.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
