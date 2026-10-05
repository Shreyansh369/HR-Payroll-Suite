"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, FormGrid, FormSection, Input, Select } from "@/components/ui/form";
import { Callout, Panel } from "@/components/ui/panel";
import { APP_NAME, IS_DEMO } from "@/config/env";

type Status = { needsSetup: boolean; setupEnabled: boolean } | null;

export default function SetupPage() {
  const [status, setStatus] = useState<Status>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [f, setF] = useState({ setupToken: "", organizationName: "", legalName: "", tradingName: "", shortName: "", currency: "USD", timezone: "America/Tortola", payFrequency: "monthly", name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (IS_DEMO) return;
    fetch("/api/setup", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error?.message ?? "Setup status unavailable.");
        setStatus(body);
      })
      .catch((e) => setLoadError((e as Error).message));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          setupToken: f.setupToken,
          organizationName: f.organizationName,
          company: { legalName: f.legalName, tradingName: f.tradingName, shortName: f.shortName, currency: f.currency, timezone: f.timezone, payFrequency: f.payFrequency },
          owner: { name: f.name, email: f.email, password: f.password },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message ?? "Setup failed.");
      window.location.href = body.signedIn ? "/app/settings?tab=setup" : "/login";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-dvh bg-canvas px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-white">HP</span>
          <span className="text-[14px] font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        {children}
      </div>
    </div>
  );

  if (IS_DEMO) {
    return shell(
      <Callout tone="info" title="Setup is for production installations">
        This deployment runs the browser-only demo with fictional data, so there is nothing to set up. <Link className="underline" href="/login">Open the demo</Link>.
      </Callout>,
    );
  }
  if (loadError) return shell(<Callout tone="danger" title="Cannot reach the server">{loadError} Check that DATABASE_URL and DATA_ENCRYPTION_KEY are set and migrations have run (pnpm db:migrate).</Callout>);
  if (!status) return shell(<p className="text-[13px] text-ink-3">Checking installation…</p>);
  if (!status.needsSetup) {
    return shell(
      <Callout tone="success" title="This installation is already set up" action={<ButtonLink href="/login" variant="primary">Sign in</ButtonLink>}>
        Ask an owner to create an account for you.
      </Callout>,
    );
  }
  if (!status.setupEnabled) {
    return shell(
      <Callout tone="warning" title="Setup is locked">
        Set a <code>SETUP_TOKEN</code> of at least 16 characters in the server environment (for example with <code>node scripts/generate-secrets.mjs</code>), restart, and return to this page.
      </Callout>,
    );
  }

  const passwordIssue = f.password && f.password.length < 12 ? "Use at least 12 characters" : f.confirm && f.confirm !== f.password ? "Passwords do not match" : null;
  return shell(
    <>
      <h1 className="text-[24px] font-semibold tracking-tight">Set up your installation</h1>
      <p className="mt-1 text-[13px] text-ink-2">Creates your organisation, first company and owner account. You can add more companies and users afterwards.</p>
      <Panel className="mt-6">
        <form onSubmit={submit} className="space-y-6 p-5">
          {error && <Callout tone="danger">{error}</Callout>}
          <FormSection title="Setup token" description="The SETUP_TOKEN value from the server environment. It proves you deployed this installation.">
            <Field label="Setup token" required><Input type="password" autoComplete="off" value={f.setupToken} onChange={(e) => set("setupToken", e.target.value)} /></Field>
          </FormSection>
          <FormSection title="Organisation and first company">
            <FormGrid cols={2}>
              <Field label="Organisation name" required hint="Your group or holding name"><Input value={f.organizationName} onChange={(e) => set("organizationName", e.target.value)} /></Field>
              <Field label="Company legal name" required><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
              <Field label="Trading name"><Input value={f.tradingName} onChange={(e) => set("tradingName", e.target.value)} placeholder="Same as legal name" /></Field>
              <Field label="Short code" required hint="1–4 letters"><Input value={f.shortName} maxLength={4} onChange={(e) => set("shortName", e.target.value.toUpperCase())} /></Field>
              <Field label="Currency"><Input value={f.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
              <Field label="Primary pay frequency">
                <Select value={f.payFrequency} onChange={(e) => set("payFrequency", e.target.value)}>
                  <option value="monthly">Monthly</option><option value="semi_monthly">Semi-monthly</option><option value="biweekly">Biweekly</option><option value="weekly">Weekly</option>
                </Select>
              </Field>
              <Field label="Time zone" hint="IANA name, e.g. America/Tortola"><Input value={f.timezone} onChange={(e) => set("timezone", e.target.value)} /></Field>
            </FormGrid>
          </FormSection>
          <FormSection title="Owner account">
            <FormGrid cols={2}>
              <Field label="Your name" required><Input autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="Email" required><Input type="email" autoComplete="username" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
              <Field label="Password" required error={passwordIssue ?? undefined}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} /></Field>
              <Field label="Confirm password" required><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => set("confirm", e.target.value)} /></Field>
            </FormGrid>
          </FormSection>
          <Callout tone="warning" title="Statutory rules start as drafts">
            The company is created with placeholder Social Security, NHI and Payroll Tax rules marked as drafts. Enter verified rates from official sources and have them approved before running live payroll.
          </Callout>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!f.setupToken || !f.organizationName || !f.legalName || !f.shortName || !f.name || !f.email || f.password.length < 12 || f.password !== f.confirm}>
              Create installation
            </Button>
          </div>
        </form>
      </Panel>
    </>,
  );
}
