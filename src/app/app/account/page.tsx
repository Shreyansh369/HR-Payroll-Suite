"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { useSession } from "@/client/session";
import { PageHeader, Panel, PanelHeader, Callout, DescriptionList } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { IS_DEMO } from "@/config/env";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? data?.error ?? "Request failed.");
  return data as T;
}

function QrCode({ value }: { value: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const out: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) out.push([c, r]);
    return { n, out };
  }, [value]);
  const pad = 4;
  return (
    <svg viewBox={`0 0 ${cells.n + pad * 2} ${cells.n + pad * 2}`} className="size-44 rounded-md border border-line bg-white" role="img" aria-label="QR code for your authenticator app" shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      {cells.out.map(([x, y]) => <rect key={`${x}-${y}`} x={x + pad} y={y + pad} width="1" height="1" fill="#111" />)}
    </svg>
  );
}

function PasswordPanel() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== next;
  return (
    <Panel>
      <PanelHeader title="Password" description="At least 12 characters. A passphrase of several words is easiest to remember." />
      <form
        className="space-y-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post("/api/auth/password", { current, next });
            toast.success("Password changed", "Other devices have been signed out.");
            setCurrent("");
            setNext("");
            setConfirm("");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Current password" htmlFor="pw-current"><Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <FormGrid cols={2}>
          <Field label="New password" htmlFor="pw-next" hint={next && next.length < 12 ? `${12 - next.length} more characters` : undefined}><Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? "Passwords do not match" : undefined}><Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        </FormGrid>
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 12 || next !== confirm}>Change password</Button></div>
      </form>
    </Panel>
  );
}

function TwoFactorPanel() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    post<{ enabled: boolean }>("/api/auth/two-factor", { action: "status" }).then((r) => setEnabled(r.enabled), () => setEnabled(false));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      <PanelHeader title="Two-factor authentication" description="A code from an authenticator app is required at sign-in, in addition to your password." actions={enabled === null ? null : enabled ? <Badge tone="success" dot>On</Badge> : <Badge>Off</Badge>} />
      <div className="space-y-4 p-4">
        {error && <Callout tone="danger">{error}</Callout>}
        {enabled === false && !setup && (
          <Button icon="shield" loading={busy} onClick={() => run(async () => setSetup(await post("/api/auth/two-factor", { action: "begin" })))}>Set up two-factor</Button>
        )}
        {enabled === false && setup && (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <QrCode value={setup.uri} />
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-4 text-[13px] text-ink-2">
                <li>Scan the code with an authenticator app (for example 1Password, Google Authenticator or Microsoft Authenticator).</li>
                <li>Or enter this key manually: <code className="break-all rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px] text-ink">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <div className="flex items-end gap-2">
                <Field label="Code" htmlFor="totp-code"><Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="w-32 tracking-[0.3em]" /></Field>
                <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={() => run(async () => { await post("/api/auth/two-factor", { action: "enable", code }); setEnabled(true); setSetup(null); setCode(""); toast.success("Two-factor authentication is on"); })}>Turn on</Button>
              </div>
            </div>
          </div>
        )}
        {enabled && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Confirm with your password to turn off" htmlFor="tf-pw"><Input id="tf-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-64" /></Field>
            <Button variant="danger" loading={busy} disabled={!password} onClick={() => run(async () => { await post("/api/auth/two-factor", { action: "disable", password }); setEnabled(false); setPassword(""); toast.success("Two-factor authentication is off"); })}>Turn off</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default function AccountPage() {
  const { ctx } = useSession();
  return (
    <>
      <PageHeader title="Account & security" description="Your sign-in details. Changes are recorded in the audit log." />
      <div className="grid max-w-4xl gap-4">
        <Panel>
          <PanelHeader title="Profile" />
          <div className="p-4">
            <DescriptionList
              cols={2}
              items={[
                { label: "Name", value: ctx.user.name },
                { label: "Email", value: ctx.user.email },
                { label: "Role in this company", value: ctx.role.name },
                { label: "Companies", value: ctx.companies.map((c) => c.tradingName).join(", ") },
              ]}
            />
          </div>
        </Panel>
        {IS_DEMO ? (
          <Callout tone="neutral" title="Managed in production">
            Demo accounts share one fictional password and cannot change it. In a production installation each person sets their own password (scrypt-hashed, never stored in plain text) and can turn on two-factor authentication here.
          </Callout>
        ) : (
          <>
            <PasswordPanel />
            <TwoFactorPanel />
          </>
        )}
      </div>
    </>
  );
}
