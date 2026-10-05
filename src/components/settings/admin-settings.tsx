"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getTransport, useM, useQ, call } from "@/client/api";
import { useSession } from "@/client/session";
import { DemoTransport, type DemoMeta } from "@/client/demo-transport";
import { Panel, PanelHeader, LoadingRows, Callout, DescriptionList } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { IS_DEMO } from "@/config/env";
import { formatDate, formatDateTime } from "@/lib/dates";
import { saveBlob } from "@/lib/download";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ companies */

function NewCompanyDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { switchCompany } = useSession();
  const [f, setF] = useState({ legalName: "", tradingName: "", shortName: "", currency: "USD", timezone: "America/Tortola", payFrequency: "monthly" as "weekly" | "biweekly" | "semi_monthly" | "monthly", accentColor: "#1f5c4d" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const create = useM("company.create", {
    onSuccess: async (c) => {
      toast.success("Company created", "Default leave types, account mappings and draft statutory rules were added.");
      onClose();
      await switchCompany(c.id);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a company" description="Each company keeps its own employees, payroll, statutory rules and settings. Data never mixes between companies." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!f.legalName.trim() || !f.shortName.trim()} onClick={() => create.mutate(f)}>Create company</Button></>}>
      <div className="space-y-4">
        {create.error && <Callout tone="danger">{create.error.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Legal name" required><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} /></Field>
          <Field label="Trading name"><Input value={f.tradingName} onChange={(e) => set("tradingName", e.target.value)} placeholder="Same as legal name" /></Field>
          <Field label="Short code" required hint="1–4 letters, used for badges"><Input value={f.shortName} maxLength={4} onChange={(e) => set("shortName", e.target.value.toUpperCase())} /></Field>
          <Field label="Primary pay frequency">
            <Select value={f.payFrequency} onChange={(e) => set("payFrequency", e.target.value as typeof f.payFrequency)}>
              <option value="monthly">Monthly</option><option value="semi_monthly">Semi-monthly</option><option value="biweekly">Biweekly</option><option value="weekly">Weekly</option>
            </Select>
          </Field>
          <Field label="Currency"><Input value={f.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
          <Field label="Accent colour"><Input type="color" value={f.accentColor} onChange={(e) => set("accentColor", e.target.value)} className="h-9 w-20 p-1" /></Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

export function CompaniesSettings() {
  const { ctx, can, switchCompany } = useSession();
  const [open, setOpen] = useState(false);
  const multi = ctx.entitlements.features.includes("multi_company");
  return (
    <Panel>
      <PanelHeader title="Companies" description="Switch companies from the sidebar. Access is granted per company in Users & roles." actions={can("company.manage") && <Button size="sm" icon="add" disabled={!multi} onClick={() => setOpen(true)}>Add company</Button>} />
      <ul className="divide-y divide-line">
        {ctx.companies.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white" style={{ background: c.accentColor }}>{c.shortName}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{c.tradingName}</span>
              <span className="block truncate text-[12px] text-ink-3">{c.legalName}</span>
            </span>
            {c.id === ctx.company.id ? <Badge tone="accent">Current</Badge> : <Button size="sm" variant="ghost" onClick={() => switchCompany(c.id)}>Switch</Button>}
          </li>
        ))}
      </ul>
      {!multi && <div className="border-t border-line px-4 py-3 text-[12.5px] text-ink-3">Your plan includes one company.</div>}
      {open && <NewCompanyDialog onClose={() => setOpen(false)} />}
    </Panel>
  );
}

/* ------------------------------------------------------------------ go-live checklist */

const STEPS: { key: string; title: string; detail: string; href: string; auto?: "rules" | "employees" | "mappings" }[] = [
  { key: "company_profile", title: "Company profile and employer IDs", detail: "Legal name, address and registration numbers appear on payslips and reports.", href: "/app/settings?tab=company" },
  { key: "payroll_settings", title: "Payroll methodology and calendars", detail: "Daily-rate method, proration, overtime, rounding and pay dates. Confirm with your accountant.", href: "/app/settings?tab=payroll" },
  { key: "statutory_rules", title: "Statutory rules reviewed and approved", detail: "Enter current rates from official sources and approve them. Production payroll cannot finalize with unapproved rules.", href: "/app/statutory", auto: "rules" },
  { key: "employees", title: "Employees and pay rates loaded", detail: "Import from spreadsheet or add manually. Check bank details and statutory IDs.", href: "/app/import", auto: "employees" },
  { key: "opening_balances", title: "Opening YTD and leave balances", detail: "Import prior payroll history (as locked historical runs) and opening leave balances so YTD figures are correct.", href: "/app/import" },
  { key: "account_mappings", title: "Accounting accounts mapped", detail: "Map payroll lines to your QuickBooks chart of accounts.", href: "/app/accounting", auto: "mappings" },
  { key: "parallel_run", title: "Parallel run reconciled", detail: "Run one period alongside your current process and reconcile the register line by line.", href: "/app/payroll" },
  { key: "go_live", title: "Go live", detail: "Mark the company live. The first live payroll becomes the reference period.", href: "/app/payroll" },
];

export function SetupChecklist() {
  const { can } = useSession();
  const company = useQ("company.get", {});
  const rules = useQ("statutory.list", {}, { enabled: can("statutory_rules.view") });
  const employees = useQ("employees.list", { page: 1, pageSize: 10 }, { enabled: can("employee.view") });
  const update = useM("company.updateSetup");
  if (company.isLoading) return <LoadingRows />;
  const c = company.data!;
  const done = new Set(c.setup.completedSteps);
  const today = rules.data ? rules.data.rules : [];
  const autoState = {
    rules: today.length > 0 && today.filter((r) => r.status !== "retired" && r.status !== "draft").every((r) => r.status === "approved"),
    employees: (employees.data?.total ?? 0) > 0,
    mappings: c.accountMappings.length > 0 && c.accountMappings.every((m) => !!m.accountName.trim()),
  };
  const completed = STEPS.filter((s) => done.has(s.key)).length;
  const editable = can("company.manage");
  return (
    <Panel>
      <PanelHeader
        title="Go-live checklist"
        description={c.setup.liveSince ? `Live since ${formatDate(c.setup.liveSince)}` : `${completed} of ${STEPS.length} steps complete`}
        actions={c.setup.liveSince ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Setting up</Badge>}
      />
      <div className="h-1 bg-surface-3"><div className="h-1 bg-accent transition-all" style={{ width: `${(completed / STEPS.length) * 100}%` }} /></div>
      <ol className="divide-y divide-line">
        {STEPS.map((s, i) => {
          const isDone = done.has(s.key);
          const hint = s.auto ? autoState[s.auto] : undefined;
          return (
            <li key={s.key} className="flex items-start gap-3 px-4 py-3">
              <button
                type="button"
                disabled={!editable || update.isPending}
                onClick={() => update.mutate({ step: s.key, done: !isDone })}
                aria-label={isDone ? `Mark "${s.title}" as not done` : `Mark "${s.title}" as done`}
                className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold", isDone ? "border-accent bg-accent text-white" : "border-line-strong text-ink-3 enabled:hover:border-accent")}
              >
                {isDone ? <Icon name="check" size="sm" /> : i + 1}
              </button>
              <div className="min-w-0 flex-1">
                <p className={cn("text-[13px] font-medium", isDone && "text-ink-3 line-through decoration-ink-4")}>{s.title}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{s.detail}</p>
                {hint !== undefined && !isDone && (
                  <p className={cn("mt-1 text-[12px]", hint ? "text-success" : "text-warning")}>{hint ? "Looks ready — confirm and tick." : s.auto === "rules" ? (today.some((r) => r.status === "demo") ? "Rules are illustrative demo values — replace with verified rates and approve." : "Some active rules are not yet approved.") : s.auto === "employees" ? "No employees yet." : "Some payroll lines have no account."}</p>
                )}
              </div>
              <Link href={s.href} className="shrink-0 text-[12.5px] font-medium text-accent hover:underline">Open</Link>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ------------------------------------------------------------------ demo panel */

export function DemoPanel() {
  const toast = useToast();
  const [meta, setMeta] = useState<DemoMeta | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"reset" | "export" | null>(null);
  useEffect(() => {
    let alive = true;
    getTransport().then(async (t) => {
      if (t instanceof DemoTransport) {
        const m = await t.meta();
        if (alive) setMeta(m);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!IS_DEMO) return null;
  const exportData = async () => {
    setBusy("export");
    try {
      const t = await getTransport();
      if (!(t instanceof DemoTransport)) return;
      const state = await t.exportState();
      await call("audit.logExport", { kind: "demo_export", title: "Demo data export", format: "json" });
      saveBlob(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }), `demo-data-${new Date().toISOString().slice(0, 10)}.json`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel>
      <PanelHeader title="Demo environment" description="Everything here is fictional and stored only in this browser." actions={<Badge tone="warning">DEMO DATA</Badge>} />
      <div className="space-y-4 p-4">
        <DescriptionList
          cols={2}
          items={[
            { label: "Data generated for", value: meta ? formatDate(meta.seededOn) : "—" },
            { label: "Generated at", value: meta ? formatDateTime(meta.seededAt) : "—" },
            { label: "Storage", value: "Browser IndexedDB (no server, no database)" },
            { label: "Demo password", value: <code className="font-mono text-[12.5px]">demo-payroll-2026</code> },
          ]}
        />
        <Callout tone="neutral">Payroll history, leave and timesheets are generated relative to the day the demo was prepared, so dates always look current. Statutory rates are illustrative placeholders, not legal values.</Callout>
        <div className="flex flex-wrap gap-2">
          <Button icon="refresh" onClick={() => setConfirm(true)}>Reset demo data</Button>
          <Button icon="download" loading={busy === "export"} onClick={exportData}>Export demo data (JSON)</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset demo data?"
        description="All changes made in this browser are replaced with a fresh copy of the fictional companies."
        confirmLabel="Reset demo"
        tone="danger"
        loading={busy === "reset"}
        onConfirm={async () => {
          setBusy("reset");
          try {
            const t = await getTransport();
            if (t instanceof DemoTransport) await t.reset();
            toast.success("Demo data reset");
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/app");
          } catch (e) {
            toast.error("Reset failed", (e as Error).message);
            setBusy(null);
          }
        }}
      />
    </Panel>
  );
}
