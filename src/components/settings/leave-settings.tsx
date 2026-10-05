"use client";

import { useState } from "react";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { LeaveCategory, LeavePolicy, LeavePolicyRule, LeaveType } from "@/domain/types";
import { Panel, PanelHeader, LoadingRows, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { NumberInput } from "@/components/app/form-helpers";

const CATEGORY_LABEL: Record<LeaveCategory, string> = { vacation: "Vacation", sick: "Paid sick", unpaid_sick: "Unpaid sick", unpaid: "Unpaid", other: "Other" };

function LeaveTypeDialog({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    code: type?.code ?? "",
    name: type?.name ?? "",
    category: type?.category ?? ("other" as LeaveCategory),
    paid: type?.paid ?? true,
    unit: type?.unit ?? ("days" as const),
    tracksBalance: type?.tracksBalance ?? true,
    requiresApproval: type?.requiresApproval ?? true,
    color: type?.color ?? "#3d6fb6",
    active: type?.active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useM("leave.types.save", { onSuccess: () => { toast.success("Leave type saved"); onClose(); } });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={type ? `Edit ${type.name}` : "New leave type"} description="Unpaid leave types reduce pay in payroll for the days taken." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!f.code.trim() || !f.name.trim()} onClick={() => save.mutate({ id: type?.id, ...f })}>Save</Button></>}>
      <div className="space-y-4">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Name" required><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Code" required hint="Short code shown on calendars and imports"><Input value={f.code} maxLength={12} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Category">
            <Select value={f.category} onChange={(e) => { const c = e.target.value as LeaveCategory; setF((x) => ({ ...x, category: c, paid: !(c === "unpaid" || c === "unpaid_sick"), tracksBalance: !(c === "unpaid" || c === "unpaid_sick") })); }}>
              {(Object.keys(CATEGORY_LABEL) as LeaveCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </Select>
          </Field>
          <Field label="Unit"><Select value={f.unit} onChange={(e) => set("unit", e.target.value as "days" | "hours")}><option value="days">Days</option><option value="hours">Hours</option></Select></Field>
          <Field label="Calendar colour"><Input type="color" value={f.color} onChange={(e) => set("color", e.target.value)} className="h-9 w-20 p-1" /></Field>
        </FormGrid>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox label="Paid leave" description="Unpaid days are deducted in payroll" checked={f.paid} onChange={(v) => set("paid", v)} />
          <Checkbox label="Track a balance" description="Uses the leave policy entitlement" checked={f.tracksBalance} onChange={(v) => set("tracksBalance", v)} />
          <Checkbox label="Requires approval" checked={f.requiresApproval} onChange={(v) => set("requiresApproval", v)} />
          <Checkbox label="Active" checked={f.active} onChange={(v) => set("active", v)} />
        </div>
      </div>
    </Dialog>
  );
}

function PolicyDialog({ policy, types, onClose }: { policy: LeavePolicy | null; types: LeaveType[]; onClose: () => void }) {
  const toast = useToast();
  const balanceTypes = types.filter((t) => t.tracksBalance);
  const [name, setName] = useState(policy?.name ?? "");
  const [isDefault, setIsDefault] = useState(policy?.isDefault ?? false);
  const [rules, setRules] = useState<LeavePolicyRule[]>(
    () => balanceTypes.map((t) => policy?.rules.find((r) => r.leaveTypeId === t.id) ?? { leaveTypeId: t.id, annualEntitlement: 0, accrual: "upfront", carryForwardMax: 0, carryForwardExpiryMonths: 0 }),
  );
  const setRule = (i: number, patch: Partial<LeavePolicyRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = useM("leave.policies.save", { onSuccess: () => { toast.success("Policy saved", "New entitlements apply from the next accrual or year start."); onClose(); } });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={policy ? `Edit ${policy.name}` : "New leave policy"} description="Entitlements are configured per company. Confirm statutory minimums with your adviser." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate({ id: policy?.id, name, isDefault, rules: rules.filter((r) => r.annualEntitlement > 0 || policy?.rules.some((p) => p.leaveTypeId === r.leaveTypeId)) })}>Save policy</Button></>}>
      <div className="space-y-4">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Policy name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="flex items-end pb-1"><Checkbox label="Default for new employees" checked={isDefault} onChange={setIsDefault} /></div>
        </FormGrid>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="bg-surface-2 text-left text-[11.5px] text-ink-3">
              <tr><th className="px-3 py-2 font-medium">Leave type</th><th className="px-3 py-2 font-medium">Per year</th><th className="px-3 py-2 font-medium">Accrual</th><th className="px-3 py-2 font-medium">Carry forward max</th><th className="px-3 py-2 font-medium">Expires after (months, 0 = never)</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rules.map((r, i) => {
                const t = balanceTypes.find((x) => x.id === r.leaveTypeId)!;
                return (
                  <tr key={r.leaveTypeId}>
                    <td className="px-3 py-2"><span className="mr-2 inline-block size-2 rounded-full" style={{ background: t.color }} />{t.name}</td>
                    <td className="px-3 py-1.5"><NumberInput value={r.annualEntitlement} min={0} step={0.5} onChange={(v) => setRule(i, { annualEntitlement: v ?? 0 })} suffix={t.unit} /></td>
                    <td className="px-3 py-1.5"><Select value={r.accrual} onChange={(e) => setRule(i, { accrual: e.target.value as "upfront" | "monthly" })}><option value="upfront">Up front</option><option value="monthly">Monthly</option></Select></td>
                    <td className="px-3 py-1.5"><NumberInput value={r.carryForwardMax} min={0} step={0.5} onChange={(v) => setRule(i, { carryForwardMax: v ?? 0 })} /></td>
                    <td className="px-3 py-1.5"><NumberInput value={r.carryForwardExpiryMonths} min={0} max={12} step={1} onChange={(v) => setRule(i, { carryForwardExpiryMonths: v ?? 0 })} title="0 = never expires" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  );
}

export function LeaveSettings() {
  const { can } = useSession();
  const types = useQ("leave.types.list", { includeInactive: true });
  const policies = useQ("leave.policies.list", {});
  const [typeOpen, setTypeOpen] = useState<LeaveType | null | "new">(null);
  const [policyOpen, setPolicyOpen] = useState<LeavePolicy | null | "new">(null);
  const editable = can("leave.configure");
  if (types.isLoading || policies.isLoading) return <LoadingRows />;
  const typeName = new Map((types.data ?? []).map((t) => [t.id, t]));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <PanelHeader title="Leave types" actions={editable && <Button size="sm" icon="add" onClick={() => setTypeOpen("new")}>Leave type</Button>} />
        <ul className="divide-y divide-line">
          {(types.data ?? []).map((t) => (
            <li key={t.id}>
              <button type="button" disabled={!editable} onClick={() => setTypeOpen(t)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-surface-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                <span className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium">{t.name}</span> <span className="text-[11.5px] text-ink-3">{t.code}</span>
                  <span className="block text-[12px] text-ink-3">{CATEGORY_LABEL[t.category]} · {t.paid ? "paid" : "unpaid — deducted in payroll"} · {t.unit}{t.tracksBalance ? " · balance tracked" : ""}</span>
                </span>
                {!t.active && <Badge>Inactive</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel>
        <PanelHeader title="Leave policies" description="Assign a policy on the employee profile; the default applies to new hires." actions={editable && <Button size="sm" icon="add" onClick={() => setPolicyOpen("new")}>Policy</Button>} />
        <ul className="divide-y divide-line">
          {(policies.data ?? []).map((p) => (
            <li key={p.id}>
              <button type="button" disabled={!editable} onClick={() => setPolicyOpen(p)} className="w-full px-4 py-2.5 text-left enabled:hover:bg-surface-2">
                <span className="text-[13px] font-medium">{p.name}</span> {p.isDefault && <Badge tone="accent">Default</Badge>}
                <span className="mt-0.5 block text-[12px] text-ink-3">
                  {p.rules.map((r) => `${typeName.get(r.leaveTypeId)?.name ?? "?"} ${r.annualEntitlement} ${typeName.get(r.leaveTypeId)?.unit ?? ""}${r.accrual === "monthly" ? " (monthly)" : ""}`).join(" · ") || "No entitlements"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      {typeOpen && <LeaveTypeDialog type={typeOpen === "new" ? null : typeOpen} onClose={() => setTypeOpen(null)} />}
      {policyOpen && <PolicyDialog policy={policyOpen === "new" ? null : policyOpen} types={(types.data ?? []).filter((t) => t.active)} onClose={() => setPolicyOpen(null)} />}
    </div>
  );
}
