"use client";

import { useEffect, useMemo, useState } from "react";
import { call, useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { AmountPeriod, PayFrequency, StatutoryApplication, StatutoryRule, StatutoryType } from "@/domain/types";
import { PageHeader, Panel, PanelHeader, LoadingRows, ErrorState, Callout, DescriptionList } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { NumberInput } from "@/components/app/form-helpers";
import { STATUTORY_TYPE_LABELS } from "@/domain/statutory/engine";
import { FREQUENCY_LABELS } from "@/domain/payroll/rates";
import { ROUNDING_LABELS, formatMoney, formatPercent } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";

type Draft = Omit<StatutoryRule, "id" | "companyId" | "createdAt" | "updatedAt" | "status" | "approval" | "supersedesId">;

const periodLabel: Record<AmountPeriod, string> = { weekly: "per week", monthly: "per month", annual: "per year" };

function describe(r: Pick<StatutoryRule, "ceiling" | "threshold" | "eligibility" | "base" | "employerRateTiers">, currency: string): string[] {
  const out: string[] = [];
  out.push(`Base: ${r.base === "gross" ? "gross statutory remuneration" : "taxable remuneration (after pre-tax deductions)"}`);
  if (r.ceiling) out.push(`Ceiling ${formatMoney(r.ceiling.amount, currency)} ${periodLabel[r.ceiling.period]}${r.ceiling.mode === "annual_cumulative" ? " (cumulative over the year)" : ""}`);
  if (r.threshold) out.push(r.threshold.mode === "exempt_amount" ? `First ${formatMoney(r.threshold.amount, currency)} ${periodLabel[r.threshold.period]} exempt` : `No contribution below ${formatMoney(r.threshold.amount, currency)} ${periodLabel[r.threshold.period]}`);
  if (r.eligibility?.minAge != null || r.eligibility?.maxAge != null) out.push(`Ages ${r.eligibility?.minAge ?? 0}–${r.eligibility?.maxAge ?? "any"}`);
  if (r.eligibility?.exemptEmploymentTypes?.length) out.push(`Exempt: ${r.eligibility.exemptEmploymentTypes.join(", ")}`);
  if (r.employerRateTiers?.length) out.push(`Employer rate by headcount: ${r.employerRateTiers.map((t) => `${t.maxEmployees ? `≤${t.maxEmployees}` : "above"} ${formatPercent(t.rate)}`).join(", ")}`);
  return out;
}

function RuleEditor({ rule, onClose }: { rule: StatutoryRule | null; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [d, setD] = useState<Draft>(() =>
    rule
      ? { jurisdiction: rule.jurisdiction, type: rule.type, code: rule.code, name: rule.name, employeeRate: rule.employeeRate, employerRate: rule.employerRate, employerRateTiers: rule.employerRateTiers ?? [], base: rule.base, ceiling: rule.ceiling ?? null, threshold: rule.threshold ?? null, eligibility: rule.eligibility ?? null, rounding: rule.rounding, effectiveFrom: rule.status === "approved" ? ctx.today : rule.effectiveFrom, effectiveTo: rule.status === "approved" ? null : (rule.effectiveTo ?? null), source: { reference: rule.source.reference, url: rule.source.url ?? "", notes: rule.source.notes } }
      : { jurisdiction: "VG", type: "other", code: "", name: "", employeeRate: 0, employerRate: 0, employerRateTiers: [], base: "gross", ceiling: null, threshold: null, eligibility: null, rounding: "half_up", effectiveFrom: ctx.today, effectiveTo: null, source: { reference: "", url: "", notes: "" } },
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const [gross, setGross] = useState<number | null>(3000);
  const [frequency, setFrequency] = useState<PayFrequency>("monthly");
  const [age, setAge] = useState<number | null>(35);
  const [preview, setPreview] = useState<StatutoryApplication | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const save = useM("statutory.save", { onSuccess: (r) => { toast.success(r.status === "draft" ? "Draft saved" : "Rule saved", "Approve it to put it into effect."); onClose(); }, onError: (e) => toast.error("Not saved", e.message) });
  const payload = useMemo(() => ({ ...d, ceiling: d.ceiling ?? null, threshold: d.threshold ?? null, effectiveTo: d.effectiveTo ?? null, employerRateTiers: d.employerRateTiers ?? [], eligibility: d.eligibility ? { minAge: d.eligibility.minAge ?? null, maxAge: d.eligibility.maxAge ?? null, exemptEmploymentTypes: d.eligibility.exemptEmploymentTypes ?? [] } : null, source: { reference: d.source.reference, url: d.source.url ?? "", notes: d.source.notes } }), [d]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (!d.code || !d.name || !d.source.reference) {
        setPreview(null);
        setPreviewError("Enter a code, name and source to preview.");
        return;
      }
      try {
        const res = await call("statutory.preview", { rule: payload, gross: gross ?? 0, frequency, age, headcount: 10 });
        if (!cancelled) { setPreview(res); setPreviewError(null); }
      } catch (e) {
        if (!cancelled) { setPreview(null); setPreviewError((e as Error).message); }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [payload, gross, frequency, age, d.code, d.name, d.source.reference]);

  return (
    <Dialog
      open
      size="xl"
      onOpenChange={(o) => !o && onClose()}
      title={rule ? (rule.status === "approved" ? `New version of ${rule.name}` : `Edit ${rule.name}`) : "New statutory rule"}
      description={rule?.status === "approved" ? "Approved rules are never edited. This creates a draft version that supersedes it from the effective date once approved." : "Saved as a draft. Drafts are not used in payroll until approved."}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...payload, id: rule?.id })}>Save draft</Button></>}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          {save.error && <Callout tone="danger">{save.error.message}</Callout>}
          <FormGrid cols={3}>
            <Field label="Type">
              <Select value={d.type} onChange={(e) => set("type", e.target.value as StatutoryType)}>
                {Object.entries(STATUTORY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Code" required hint="Versions share a code"><Input value={d.code} onChange={(e) => set("code", e.target.value.toUpperCase())} disabled={!!rule} /></Field>
            <Field label="Name" required><Input value={d.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Employee rate" hint="Percent"><NumberInput value={+(d.employeeRate * 100).toFixed(4)} onChange={(v) => set("employeeRate", (v ?? 0) / 100)} step="0.01" suffix="%" /></Field>
            <Field label="Employer rate" hint="Percent"><NumberInput value={+(d.employerRate * 100).toFixed(4)} onChange={(v) => set("employerRate", (v ?? 0) / 100)} step="0.01" suffix="%" /></Field>
            <Field label="Calculation base">
              <Select value={d.base} onChange={(e) => set("base", e.target.value as "gross" | "taxable")}><option value="gross">Gross remuneration</option><option value="taxable">Taxable (after pre-tax)</option></Select>
            </Field>
            <Field label="Effective from" required><Input type="date" value={d.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} /></Field>
            <Field label="Effective to" hint="Blank = open-ended"><Input type="date" value={d.effectiveTo ?? ""} onChange={(e) => set("effectiveTo", e.target.value || null)} /></Field>
            <Field label="Rounding">
              <Select value={d.rounding} onChange={(e) => set("rounding", e.target.value as Draft["rounding"])}>{Object.entries(ROUNDING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            </Field>
          </FormGrid>

          <div className="rounded-lg border border-line p-3">
            <Checkbox label="Contribution ceiling" checked={!!d.ceiling} onChange={(v) => set("ceiling", v ? { amount: 4000, period: "monthly", mode: "per_period" } : null)} />
            {d.ceiling && (
              <FormGrid cols={3} className="mt-3">
                <Field label="Amount"><NumberInput value={d.ceiling.amount} onChange={(v) => set("ceiling", { ...d.ceiling!, amount: v ?? 0 })} prefix="$" /></Field>
                <Field label="Period"><Select value={d.ceiling.period} onChange={(e) => set("ceiling", { ...d.ceiling!, period: e.target.value as AmountPeriod })}><option value="weekly">Per week</option><option value="monthly">Per month</option><option value="annual">Per year</option></Select></Field>
                <Field label="Applied"><Select value={d.ceiling.mode} onChange={(e) => set("ceiling", { ...d.ceiling!, mode: e.target.value as "per_period" | "annual_cumulative" })}><option value="per_period">Each pay period (prorated)</option><option value="annual_cumulative">Cumulative over the year</option></Select></Field>
              </FormGrid>
            )}
          </div>
          <div className="rounded-lg border border-line p-3">
            <Checkbox label="Threshold or exemption" checked={!!d.threshold} onChange={(v) => set("threshold", v ? { amount: 10000, period: "annual", mode: "exempt_amount" } : null)} />
            {d.threshold && (
              <FormGrid cols={3} className="mt-3">
                <Field label="Amount"><NumberInput value={d.threshold.amount} onChange={(v) => set("threshold", { ...d.threshold!, amount: v ?? 0 })} prefix="$" /></Field>
                <Field label="Period"><Select value={d.threshold.period} onChange={(e) => set("threshold", { ...d.threshold!, period: e.target.value as AmountPeriod })}><option value="weekly">Per week</option><option value="monthly">Per month</option><option value="annual">Per year</option></Select></Field>
                <Field label="Type"><Select value={d.threshold.mode} onChange={(e) => set("threshold", { ...d.threshold!, mode: e.target.value as "exempt_amount" | "minimum" })}><option value="exempt_amount">First amount exempt</option><option value="minimum">Minimum earnings to contribute</option></Select></Field>
              </FormGrid>
            )}
          </div>
          <div className="rounded-lg border border-line p-3">
            <Checkbox label="Age eligibility" checked={!!d.eligibility} onChange={(v) => set("eligibility", v ? { minAge: 16, maxAge: 65, exemptEmploymentTypes: [] } : null)} />
            {d.eligibility && (
              <FormGrid cols={3} className="mt-3">
                <Field label="Minimum age"><NumberInput value={d.eligibility.minAge ?? null} onChange={(v) => set("eligibility", { ...d.eligibility!, minAge: v })} /></Field>
                <Field label="Maximum age"><NumberInput value={d.eligibility.maxAge ?? null} onChange={(v) => set("eligibility", { ...d.eligibility!, maxAge: v })} /></Field>
              </FormGrid>
            )}
          </div>
          <FormGrid cols={2}>
            <Field label="Source reference" required hint="Publication, schedule or accountant memo"><Input value={d.source.reference} onChange={(e) => set("source", { ...d.source, reference: e.target.value })} /></Field>
            <Field label="Source URL"><Input value={d.source.url ?? ""} onChange={(e) => set("source", { ...d.source, url: e.target.value })} placeholder="https://" /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={d.source.notes} onChange={(e) => set("source", { ...d.source, notes: e.target.value })} rows={2} /></Field>
          </FormGrid>
        </div>
        <aside className="space-y-3 rounded-lg border border-line bg-surface-2 p-3 lg:sticky lg:top-0 lg:self-start">
          <p className="text-[12.5px] font-semibold">Test with an example</p>
          <p className="text-[11.5px] text-ink-3">Compare against your accountant&apos;s worked examples before approving.</p>
          <Field label="Gross pay for the period"><NumberInput value={gross} onChange={setGross} prefix="$" /></Field>
          <Field label="Pay frequency"><Select value={frequency} onChange={(e) => setFrequency(e.target.value as PayFrequency)}>{Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Employee age"><NumberInput value={age} onChange={setAge} /></Field>
          {preview ? (
            <div className="space-y-1 rounded-md border border-line bg-surface p-2.5 text-[12.5px]">
              <p className="flex justify-between"><span className="text-ink-2">Contributable base</span><span className="num">{formatMoney(preview.contributableBase, ctx.company.currency)}</span></p>
              <p className="flex justify-between"><span className="text-ink-2">Employee</span><span className="font-medium num">{formatMoney(preview.employeeAmount, ctx.company.currency)}</span></p>
              <p className="flex justify-between"><span className="text-ink-2">Employer</span><span className="font-medium num">{formatMoney(preview.employerAmount, ctx.company.currency)}</span></p>
              <p className="pt-1 text-[11.5px] text-ink-3">{preview.explanation}</p>
            </div>
          ) : <p className="text-[11.5px] text-ink-3">{previewError}</p>}
        </aside>
      </div>
    </Dialog>
  );
}

export default function StatutoryPage() {
  const { ctx, can } = useSession();
  const toast = useToast();
  const q = useQ("statutory.list", {});
  const [editing, setEditing] = useState<StatutoryRule | null | "new">(null);
  const [approving, setApproving] = useState<StatutoryRule | null>(null);
  const [retiring, setRetiring] = useState<StatutoryRule | null>(null);
  const approve = useM("statutory.approve", { onSuccess: () => { toast.success("Rule approved", "It applies to payroll periods from its effective date."); setApproving(null); }, onError: (e) => toast.error("Not approved", e.message) });
  const retire = useM("statutory.retire", { onSuccess: () => { toast.success("Rule retired"); setRetiring(null); }, onError: (e) => toast.error("Not retired", e.message) });
  const groups = useMemo(() => {
    const m = new Map<string, StatutoryRule[]>();
    for (const r of q.data?.rules ?? []) m.set(r.code, [...(m.get(r.code) ?? []), r]);
    for (const list of m.values()) list.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    const order = ["social_security", "nhi", "payroll_tax", "other"];
    return [...m.entries()].sort((a, b) => order.indexOf(a[1][0].type) - order.indexOf(b[1][0].type));
  }, [q.data]);
  const anyUnapproved = (q.data?.rules ?? []).some((r) => r.status === "demo");
  const cur = ctx.company.currency;

  return (
    <>
      <PageHeader
        title="Statutory rules"
        description="Effective-dated Social Security, NHI and Payroll Tax rules. Each payroll result stores the exact rule version it used, so adding a rule never changes past payroll."
        actions={can("statutory_rules.edit") && <Button variant="primary" icon="add" onClick={() => setEditing("new")}>New rule</Button>}
      />
      <Callout tone="warning" className="mb-4" title="Rates must be confirmed by your payroll or accounting professional">
        {anyUnapproved ? "The rates shown as “Illustrative” are placeholders for evaluation and have not been verified against current official publications. " : ""}
        Before running live payroll, enter the current official values with their source and approve each rule. In production, payroll cannot be finalized with unapproved rules.
      </Callout>
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
        <div className="space-y-4">
          {groups.map(([code, versions]) => (
            <Panel key={code}>
              <PanelHeader title={<span className="flex items-center gap-2">{versions[0].name} <span className="font-mono text-[11.5px] text-ink-3">{code}</span></span>} description={STATUTORY_TYPE_LABELS[versions[0].type]} />
              <ol className="divide-y divide-line">
                {versions.map((r) => {
                  const inForce = (r.status === "approved" || r.status === "demo") && r.effectiveFrom <= ctx.today && (!r.effectiveTo || r.effectiveTo >= ctx.today);
                  return (
                    <li key={r.id} className={cn("grid gap-3 px-4 py-3 md:grid-cols-[200px_minmax(0,1fr)_auto]", r.status === "retired" && "opacity-60")}>
                      <div>
                        <p className="text-[13px] font-medium num">{formatDate(r.effectiveFrom)} – {r.effectiveTo ? formatDate(r.effectiveTo) : "open"}</p>
                        <div className="mt-1 flex flex-wrap gap-1"><StatusBadge status={r.status} />{inForce && <Badge tone="accent">In force today</Badge>}{r.effectiveFrom > ctx.today && r.status !== "retired" && <Badge tone="info">Future</Badge>}</div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px]"><span className="font-semibold num">{formatPercent(r.employeeRate)}</span> employee · <span className="font-semibold num">{formatPercent(r.employerRate)}</span> employer</p>
                        <ul className="mt-0.5 text-[12px] text-ink-2">{describe(r, cur).map((x) => <li key={x}>{x}</li>)}</ul>
                        <p className="mt-1 text-[11.5px] text-ink-3">Source: {r.source.url ? <a className="underline" href={r.source.url} target="_blank" rel="noreferrer">{r.source.reference}</a> : r.source.reference}{r.source.notes && ` — ${r.source.notes}`}</p>
                        {r.approval && <p className="text-[11.5px] text-ink-3">Approved by {r.approval.approvedByName}, {formatDateTime(r.approval.approvedAt)}: “{r.approval.note}”</p>}
                      </div>
                      <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
                        {can("statutory_rules.edit") && r.status !== "retired" && <Button size="sm" onClick={() => setEditing(r)}>{r.status === "approved" ? "New version" : "Edit"}</Button>}
                        {can("statutory_rules.approve") && (r.status === "draft" || r.status === "demo") && <Button size="sm" variant="primary" onClick={() => setApproving(r)}>Approve</Button>}
                        {can("statutory_rules.approve") && r.status !== "retired" && <Button size="sm" variant="ghost" onClick={() => setRetiring(r)}>Retire</Button>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          ))}
        </div>
      )}
      {editing && <RuleEditor rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!approving}
        onOpenChange={(o) => !o && setApproving(null)}
        title={`Approve ${approving?.name}?`}
        description={approving ? <DescriptionList cols={1} items={[{ label: "Effective", value: `${formatDate(approving.effectiveFrom)} – ${approving.effectiveTo ? formatDate(approving.effectiveTo) : "open-ended"}` }, { label: "Rates", value: `${formatPercent(approving.employeeRate)} employee · ${formatPercent(approving.employerRate)} employer` }, { label: "Source", value: approving.source.reference }]} /> : undefined}
        confirmLabel="Approve rule"
        requireReason
        reasonLabel="Approval note (who verified it, against what)"
        loading={approve.isPending}
        onConfirm={(note) => approving && approve.mutate({ id: approving.id, note })}
      >
        <p className="mt-3 text-[12px] text-ink-3">Any open-ended earlier version of this code will end the day before. Approval is blocked if finalized payroll already used the earlier rule after this date.</p>
      </ConfirmDialog>
      <ConfirmDialog open={!!retiring} onOpenChange={(o) => !o && setRetiring(null)} title={`Retire ${retiring?.name}?`} description="Retired rules are ignored by future calculations. Past results keep their snapshot." confirmLabel="Retire" tone="danger" requireReason loading={retire.isPending} onConfirm={(reason) => retiring && retire.mutate({ id: retiring.id, reason })} />
    </>
  );
}
