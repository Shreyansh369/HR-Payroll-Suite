"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getTransport } from "@/client/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Callout } from "@/components/ui/panel";
import { Icon } from "@/components/ui/icon";
import { APP_NAME, IS_DEMO } from "@/config/env";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/repositories/demo/seed-accounts";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState(IS_DEMO ? "demo.admin@example.com" : "");
  const [password, setPassword] = useState(IS_DEMO ? DEMO_PASSWORD : "");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    if (IS_DEMO) return;
    fetch("/api/setup", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { needsSetup?: boolean } | null) => setNeedsSetup(!!b?.needsSetup))
      .catch(() => undefined);
  }, []);

  async function submit(e?: React.FormEvent, overrideEmail?: string) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await getTransport();
      await t.init((m) => setStatus(m));
      const res = await t.login(overrideEmail ?? email, password, needsTotp ? totp : undefined);
      if (!res.ok) {
        setError(res.error);
        if (res.needsTotp) setNeedsTotp(true);
        setBusy(false);
        setStatus(null);
        return;
      }
      const isEmployee = (overrideEmail ?? email) === "demo.employee@example.com";
      router.replace(next && next.startsWith("/app") ? next : isEmployee ? "/app/me" : "/app");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,1fr)_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="flex items-center gap-2 self-start">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-white">HP</span>
          <span className="text-[14px] font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-[24px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-2">{IS_DEMO ? "This is a demo workspace with fictional companies. Pick an account on the right or use the admin login below." : "Use the email address your administrator registered."}</p>
          {needsSetup && (
            <Callout tone="info" title="New installation" className="mt-5" action={<Link href="/setup" className="text-[13px] font-medium text-accent hover:underline">Set up</Link>}>
              No organisation exists yet. Create the owner account first.
            </Callout>
          )}
          <form onSubmit={submit} className="mt-6 space-y-3.5" noValidate>
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-9" />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-9" />
            </Field>
            {needsTotp && (
              <Field label="Authentication code" htmlFor="totp" hint="Enter the 6-digit code from your authenticator app.">
                <Input id="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} className="h-9 tracking-[0.3em]" />
              </Field>
            )}
            {error && <Callout tone="danger">{error}</Callout>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {busy && status ? status : "Sign in"}
            </Button>
          </form>
          {IS_DEMO && (
            <p className="mt-4 text-[12px] text-ink-3">
              Demo password for every account: <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11.5px] text-ink-2">{DEMO_PASSWORD}</code>
            </p>
          )}
        </div>
        <p className="text-[11.5px] text-ink-4">
          <Link href="/privacy" className="hover:text-ink-2">Privacy</Link> · <Link href="/terms" className="hover:text-ink-2">Terms</Link> · <Link href="/security" className="hover:text-ink-2">Security</Link>
        </p>
      </div>

      <div className="hidden border-l border-line bg-surface-2 lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20">
        {IS_DEMO ? (
          <div className="max-w-lg">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-warning">Demo accounts</p>
            <h2 className="mt-2 text-[20px] font-semibold tracking-tight">See the same workspace through each role</h2>
            <p className="mt-1.5 text-[13px] text-ink-2">Permissions are enforced by the same service layer used in production. A supervisor never receives salary data; an employee only sees their own records.</p>
            <ul className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                      void submit(undefined, a.email);
                    }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[13px] font-semibold text-ink">{a.role}</span>
                        <span className="truncate text-[12px] text-ink-3">{a.name}</span>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-ink-2">{a.description}</span>
                      <span className="mt-0.5 block font-mono text-[11px] text-ink-3">{a.email}</span>
                    </span>
                    <Icon name="chevronRight" size="sm" className="text-ink-4" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] text-ink-3">Changes are saved only in this browser. Reset the demo at any time from the account menu.</p>
          </div>
        ) : (
          <div className="max-w-md">
            <h2 className="text-[20px] font-semibold tracking-tight">Payroll you can explain line by line</h2>
            <ul className="mt-5 space-y-3 text-[13px] text-ink-2">
              <li className="flex gap-2"><Icon name="check" size="sm" className="mt-0.5 text-accent" />Effective-dated statutory rules, approved by your accountant</li>
              <li className="flex gap-2"><Icon name="check" size="sm" className="mt-0.5 text-accent" />Locked payrolls are corrected with traceable correction runs</li>
              <li className="flex gap-2"><Icon name="check" size="sm" className="mt-0.5 text-accent" />Every sensitive change is recorded in the audit log</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
