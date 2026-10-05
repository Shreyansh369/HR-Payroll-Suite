"use client";

import { useState } from "react";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { ProcOutput } from "@/services/registry";
import type { PayFrequency, RateBasis, PayItem } from "@/domain/types";
import { Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select, Checkbox } from "@/components/ui/form";
import { DataTable, Money } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { NumberInput, RateEquivalentsPreview, WorkDaysPicker, fieldErrors } from "@/components/app/form-helpers";
import { BASIS_LABELS, FREQUENCY_LABELS, DAILY_METHOD_LABELS } from "@/domain/payroll/rates";
import { describeWorkDays } from "@/domain/employee/schedule";
import { BASIS_SUFFIX, FREQUENCY_SHORT } from "@/lib/labels";
import { addDays, formatDate } from "@/lib/dates";
import { formatMoney, formatNumber } from "@/lib/money";

type Comp = ProcOutput<"compensation.get">;

export function CompensationTab({ employeeId }: { employeeId: string }) {
  const { can } = useSession();
  const q = useQ("compensation.get", { employeeId });
  const [rateOpen, setRateOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [item, setItem] = useState<PayItem | "new-earning" | "new-deduction" | null>(null);
  const [loanOpen, setLoanOpen] = useState(false);
  const toast = useToast();
  const delItem = useM("compensation.deletePayItem", { onSuccess: (r) => toast.success(r.ended ? "Item ended (kept for payroll history)" : "Item deleted"), onError: (e) => toast.error("Not removed", e.message) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const edit = can("salary.edit");
  const eq = c.equivalents;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Current pay"
            description={c.currentRate ? `Effective ${formatDate(c.currentRate.effectiveFrom)} · ${c.currentRate.reason}` : "No pay rate recorded"}
            actions={edit && <Button size="sm" icon="add" onClick={() => setRateOpen(true)}>Change pay</Button>}
          />
          {c.currentRate ? (
            <div className="p-4">
              <p className="text-[26px] font-semibold tracking-tight num">
                {formatMoney(c.currentRate.amount, c.currency)} <span className="text-[14px] font-normal text-ink-3">{BASIS_SUFFIX[c.currentRate.basis]}</span>
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-2">
                {c.currentRate.payType === "salary" ? "Salaried" : "Hourly"} · paid {FREQUENCY_SHORT[c.currentRate.payFrequency]}
              </p>
              {eq && (
                <div className="mt-4 overflow-hidden rounded-md border border-line">
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {(
                        [
                          ["Annual", eq.annual, eq.formulas.annual],
                          ["Monthly", eq.monthly, eq.formulas.monthly],
                          ["Semi-monthly", eq.semiMonthly, eq.formulas.semiMonthly],
                          ["Biweekly", eq.biweekly, eq.formulas.biweekly],
                          ["Weekly", eq.weekly, eq.formulas.weekly],
                          ["Daily", eq.daily, eq.formulas.daily],
                          ["Hourly", eq.hourly, eq.formulas.hourly],
                        ] as [string, number, string][]
                      ).map(([label, v, f]) => (
                        <tr key={label} className="border-b border-line last:border-0">
                          <td className="bg-surface-2 px-3 py-1.5 text-ink-2">{label}</td>
                          <td className="px-3 py-1.5 text-right font-medium num">{formatMoney(v, c.currency)}</td>
                          <td className="hidden px-3 py-1.5 text-[11.5px] text-ink-3 sm:table-cell">{f}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-line bg-surface-2 px-3 py-1.5 text-[11.5px] text-ink-3">
                    {eq.assumptions.join(" · ")}. Proration by {c.settings.prorationMethod.replace("_", " ")}; overtime × {c.settings.overtimeMultiplier}.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState compact icon="wallet" title="No pay rate" description="This employee is excluded from payroll until a rate is recorded." action={edit ? <Button size="sm" variant="primary" onClick={() => setRateOpen(true)}>Add pay rate</Button> : undefined} />
          )}
        </Panel>
        <Panel>
          <PanelHeader
            title="Work schedule"
            description={c.currentSchedule ? `Effective ${formatDate(c.currentSchedule.effectiveFrom)}` : "No schedule"}
            actions={(edit || can("employee.edit")) && <Button size="sm" icon="add" onClick={() => setSchedOpen(true)}>Change schedule</Button>}
          />
          <div className="p-4">
            {c.currentSchedule && (
              <p className="text-[15px] font-semibold">
                {describeWorkDays(c.currentSchedule.workDays)} · {formatNumber(c.currentSchedule.hoursPerDay)} h/day{" "}
                <span className="text-[13px] font-normal text-ink-3">({formatNumber(c.currentSchedule.workDays.length * c.currentSchedule.hoursPerDay)} h/week)</span>
              </p>
            )}
            <p className="mt-3 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">History</p>
            <ul className="mt-1.5 divide-y divide-line rounded-md border border-line">
              {c.schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                  <span>
                    {describeWorkDays(s.workDays)} · {formatNumber(s.hoursPerDay)} h
                    <span className="ml-2 text-ink-3">{s.reason}</span>
                  </span>
                  <span className="num text-ink-3">
                    {formatDate(s.effectiveFrom)} – {s.effectiveTo ? formatDate(s.effectiveTo) : "present"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      {c.lockedThrough && (
        <Callout tone="neutral" icon="lock">
          Payroll is finalized through {formatDate(c.lockedThrough)}. New rates and schedules must start after that date; earlier differences are paid with a correction run.
        </Callout>
      )}

      <Panel>
        <PanelHeader title="Pay rate history" description="Effective-dated. Past payroll results keep the rate they were calculated with." />
        <DataTable
          columns={[
            { key: "from", header: "Effective", cell: (r) => <span className="num">{formatDate(r.effectiveFrom)} – {r.effectiveTo ? formatDate(r.effectiveTo) : "present"}</span> },
            { key: "amount", header: "Rate", align: "right", cell: (r) => <span className="font-medium">{formatMoney(r.amount, c.currency)} <span className="font-normal text-ink-3">{BASIS_SUFFIX[r.basis]}</span></span> },
            { key: "type", header: "Type", hideBelow: "sm", cell: (r) => (r.payType === "salary" ? "Salary" : "Hourly") },
            { key: "freq", header: "Paid", hideBelow: "md", cell: (r) => FREQUENCY_LABELS[r.payFrequency] },
            { key: "reason", header: "Reason", hideBelow: "md", cell: (r) => <span className="text-ink-2">{r.reason}</span> },
            {
              key: "status",
              header: "",
              align: "right",
              cell: (r) => (r.effectiveFrom > (c.currentRate?.effectiveFrom ?? "") ? <Badge tone="info">Scheduled</Badge> : r.id === c.currentRate?.id ? <Badge tone="success">Current</Badge> : null),
            },
          ]}
          rows={c.rates}
          rowKey={(r) => r.id}
          empty={<EmptyState compact title="No pay rates" />}
        />
      </Panel>

      <Panel>
        <PanelHeader
          title="Recurring earnings & deductions"
          description="Applied automatically every pay period while active."
          actions={
            edit && (
              <>
                <Button size="sm" icon="add" onClick={() => setItem("new-earning")}>Earning</Button>
                <Button size="sm" icon="add" onClick={() => setItem("new-deduction")}>Deduction</Button>
              </>
            )
          }
        />
        <DataTable
          columns={[
            { key: "label", header: "Item", cell: (i) => <span className="font-medium">{i.label}</span> },
            { key: "kind", header: "Kind", cell: (i) => (i.kind === "earning" ? <Badge tone="success">Earning</Badge> : <Badge>Deduction</Badge>) },
            { key: "cat", header: "Category", hideBelow: "md", cell: (i) => <span className="capitalize text-ink-2">{i.category}</span> },
            { key: "amount", header: "Amount", align: "right", cell: (i) => (i.method === "percent_of_base" ? `${formatNumber(i.amount * 100)}% of base pay` : formatMoney(i.amount, c.currency)) },
            { key: "flags", header: "Treatment", hideBelow: "lg", cell: (i) => <span className="text-ink-2">{i.kind === "earning" ? (i.taxable ? "Taxable" : "Non-taxable") : i.pretax ? "Pre-tax" : "After statutory"}</span> },
            { key: "dates", header: "Period", hideBelow: "md", cell: (i) => <span className="num text-ink-2">{formatDate(i.startDate)} – {i.endDate ? formatDate(i.endDate) : "ongoing"}</span> },
            { key: "status", header: "", cell: (i) => (i.active ? null : <Badge>Ended</Badge>) },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (i) =>
                edit && (
                  <Menu trigger={<IconButton icon="more" label="Item actions" size="sm" />}>
                    <MenuItem icon="edit" onSelect={() => setItem(i)}>Edit</MenuItem>
                    <MenuItem icon="delete" tone="danger" onSelect={() => delItem.mutate({ id: i.id })}>Remove</MenuItem>
                  </Menu>
                ),
            },
          ]}
          rows={c.payItems}
          rowKey={(i) => i.id}
          empty={<EmptyState compact icon="coins" title="No recurring items" description="Allowances, commissions, pension or health deductions." />}
        />
      </Panel>

      <Panel>
        <PanelHeader title="Loans & advances" actions={edit && <Button size="sm" icon="add" onClick={() => setLoanOpen(true)}>Issue loan or advance</Button>} />
        <DataTable
          columns={[
            { key: "ref", header: "Reference", cell: (l) => <span className="font-mono text-[12px]">{l.reference}</span> },
            { key: "type", header: "Type", cell: (l) => (l.type === "loan" ? "Loan" : "Salary advance") },
            { key: "principal", header: "Principal", align: "right", cell: (l) => <Money value={l.principal} currency={c.currency} /> },
            { key: "inst", header: "Installment", align: "right", hideBelow: "md", cell: (l) => <Money value={l.installment} currency={c.currency} /> },
            { key: "repaid", header: "Repaid", align: "right", hideBelow: "sm", cell: (l) => <Money value={l.repaid} currency={c.currency} /> },
            { key: "out", header: "Outstanding", align: "right", cell: (l) => <Money value={l.outstanding} currency={c.currency} className="font-medium" /> },
            { key: "status", header: "Status", cell: (l) => <StatusBadge status={l.status} /> },
          ]}
          rows={c.loans}
          rowKey={(l) => l.id}
          empty={<EmptyState compact icon="coins" title="No loans or advances" />}
        />
      </Panel>

      {rateOpen && <RateDialog comp={c} onClose={() => setRateOpen(false)} />}
      {schedOpen && <ScheduleDialog comp={c} onClose={() => setSchedOpen(false)} />}
      {item && <PayItemDialog comp={c} item={item} onClose={() => setItem(null)} />}
      {loanOpen && <LoanDialog employeeId={c.employee.id} currency={c.currency} onClose={() => setLoanOpen(false)} />}
    </div>
  );
}

function minEffective(c: Comp, today: string) {
  return c.lockedThrough ? addDays(c.lockedThrough, 1) : c.employee.hireDate > today ? c.employee.hireDate : today;
}

function RateDialog({ comp, onClose }: { comp: Comp; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const cur = comp.currentRate;
  const [effectiveFrom, setDate] = useState(minEffective(comp, ctx.today) > ctx.today ? minEffective(comp, ctx.today) : ctx.today);
  const [payType, setPayType] = useState<"salary" | "hourly">(cur?.payType ?? "salary");
  const [amount, setAmount] = useState<number | null>(cur?.amount ?? null);
  const [basis, setBasis] = useState<RateBasis>(cur?.basis ?? "monthly");
  const [payFrequency, setFreq] = useState<PayFrequency>(cur?.payFrequency ?? "monthly");
  const [reason, setReason] = useState("");
  const add = useM("compensation.addRate", {
    onSuccess: () => {
      toast.success("Pay rate saved", `Effective ${formatDate(effectiveFrom)}`);
      onClose();
    },
    onError: (e) => toast.error("Pay rate not saved", e.message),
  });
  const errs = fieldErrors(add.error);
  const change = cur && amount && cur.basis === basis ? (amount - cur.amount) / cur.amount : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change pay"
      description="Creates a new effective-dated rate. The previous rate stays in history and in past payroll results."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} disabled={!amount || !reason.trim()} onClick={() => add.mutate({ employeeId: comp.employee.id, effectiveFrom, payType, amount: amount ?? 0, basis, payFrequency, reason })}>
            Save pay rate
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {add.error && !Object.keys(errs).length && <Callout tone="danger">{add.error.message}</Callout>}
        <FormGrid cols={4}>
          <Field label="Effective from" required error={errs.effectiveFrom}>
            <Input type="date" value={effectiveFrom} min={minEffective(comp, ctx.today)} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Pay type">
            <Select value={payType} onChange={(e) => { const v = e.target.value as "salary" | "hourly"; setPayType(v); if (v === "hourly") setBasis("hourly"); else if (basis === "hourly") setBasis("monthly"); }}>
              <option value="salary">Salary</option>
              <option value="hourly">Hourly</option>
            </Select>
          </Field>
          <Field label="Amount" required error={errs.amount}>
            <NumberInput value={amount} onChange={setAmount} step="0.01" min={0} prefix="$" />
          </Field>
          <Field label="Per">
            <Select value={basis} onChange={(e) => setBasis(e.target.value as RateBasis)}>
              {Object.entries(BASIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Pay frequency">
            <Select value={payFrequency} onChange={(e) => setFreq(e.target.value as PayFrequency)}>
              {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Reason" required className="sm:col-span-3">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual review 2026, promotion" />
          </Field>
        </FormGrid>
        {change !== null && Number.isFinite(change) && <p className="text-[12.5px] text-ink-2">{change >= 0 ? "Increase" : "Decrease"} of {formatNumber(Math.abs(change) * 100, 1)}% vs the current rate.</p>}
        {comp.currentSchedule && (
          <RateEquivalentsPreview amount={amount ?? 0} basis={basis} workDays={comp.currentSchedule.workDays} hoursPerDay={comp.currentSchedule.hoursPerDay} config={comp.settings} currency={comp.currency} />
        )}
        <p className="text-[11.5px] text-ink-3">Daily rate method: {DAILY_METHOD_LABELS[comp.settings.dailyRateMethod]} (company payroll setting).</p>
      </div>
    </Dialog>
  );
}

function ScheduleDialog({ comp, onClose }: { comp: Comp; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const [effectiveFrom, setDate] = useState(minEffective(comp, ctx.today) > ctx.today ? minEffective(comp, ctx.today) : ctx.today);
  const [workDays, setDays] = useState<number[]>(comp.currentSchedule?.workDays ?? [1, 2, 3, 4, 5]);
  const [hoursPerDay, setHours] = useState<number | null>(comp.currentSchedule?.hoursPerDay ?? 8);
  const [reason, setReason] = useState("");
  const add = useM("compensation.addSchedule", {
    onSuccess: () => {
      toast.success("Schedule saved");
      onClose();
    },
    onError: (e) => toast.error("Schedule not saved", e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change work schedule"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.isPending} disabled={!reason.trim() || workDays.length === 0} onClick={() => add.mutate({ employeeId: comp.employee.id, effectiveFrom, workDays, hoursPerDay: hoursPerDay ?? 0, reason })}>
            Save schedule
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {add.error && <Callout tone="danger">{add.error.message}</Callout>}
        <Field label="Effective from" required>
          <Input type="date" value={effectiveFrom} min={minEffective(comp, ctx.today)} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Working days">
          <WorkDaysPicker value={workDays} onChange={setDays} />
        </Field>
        <Field label="Hours per day">
          <NumberInput value={hoursPerDay} onChange={setHours} min={0.5} max={24} step={0.25} />
        </Field>
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved to 4-day week" />
        </Field>
      </div>
    </Dialog>
  );
}

function PayItemDialog({ comp, item, onClose }: { comp: Comp; item: PayItem | "new-earning" | "new-deduction"; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const existing = typeof item === "string" ? null : item;
  const kind = existing?.kind ?? (item === "new-earning" ? "earning" : "deduction");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [category, setCategory] = useState<string>(existing?.category ?? (kind === "earning" ? "allowance" : "health"));
  const [method, setMethod] = useState<"fixed" | "percent_of_base">(existing?.method ?? "fixed");
  const [amount, setAmount] = useState<number | null>(existing ? (existing.method === "percent_of_base" ? existing.amount * 100 : existing.amount) : null);
  const [taxable, setTaxable] = useState(existing?.taxable ?? true);
  const [pretax, setPretax] = useState(existing?.pretax ?? false);
  const [startDate, setStart] = useState(existing?.startDate ?? ctx.today);
  const [endDate, setEnd] = useState(existing?.endDate ?? "");
  const save = useM("compensation.savePayItem", {
    onSuccess: () => {
      toast.success(existing ? "Item updated" : "Item added");
      onClose();
    },
    onError: (e) => toast.error("Not saved", e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${existing ? "Edit" : "Add"} recurring ${kind}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!label.trim() || amount === null}
            onClick={() =>
              save.mutate({
                id: existing?.id,
                employeeId: comp.employee.id,
                kind,
                category: category as never,
                label,
                method,
                amount: method === "percent_of_base" ? (amount ?? 0) / 100 : amount ?? 0,
                taxable,
                pretax,
                startDate,
                endDate: endDate || null,
                active: true,
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        <FormGrid cols={2}>
          <Field label="Description" required className="sm:col-span-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "earning" ? "Housing allowance" : "Group health plan"} />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {(kind === "earning" ? ["allowance", "commission", "bonus", "other"] : ["pension", "health", "union", "garnishment", "other"]).map((x) => (
                <option key={x} value={x} className="capitalize">{x}</option>
              ))}
            </Select>
          </Field>
          <Field label="Calculation">
            <Select value={method} onChange={(e) => setMethod(e.target.value as "fixed" | "percent_of_base")}>
              <option value="fixed">Fixed amount per period</option>
              <option value="percent_of_base">Percent of base pay</option>
            </Select>
          </Field>
          <Field label={method === "fixed" ? "Amount per period" : "Percent"} required>
            <NumberInput value={amount} onChange={setAmount} step="0.01" min={0} prefix={method === "fixed" ? "$" : undefined} suffix={method === "fixed" ? undefined : "%"} />
          </Field>
          <div />
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End date" hint="Leave blank for ongoing">
            <Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </FormGrid>
        {kind === "earning" ? (
          <Checkbox label="Taxable" description="Included in Social Security, NHI and Payroll Tax bases." checked={taxable} onChange={setTaxable} />
        ) : (
          <Checkbox label="Pre-tax deduction" description="Deducted before taxable remuneration is calculated (affects rules based on taxable pay)." checked={pretax} onChange={setPretax} />
        )}
      </div>
    </Dialog>
  );
}

export function LoanDialog({ employeeId, currency, onClose }: { employeeId: string | null; currency: string; onClose: () => void }) {
  const toast = useToast();
  const { ctx } = useSession();
  const people = useQ("employees.options", { includeInactive: false }, { enabled: !employeeId });
  const [emp, setEmp] = useState(employeeId ?? "");
  const [type, setType] = useState<"loan" | "advance">("advance");
  const [principal, setPrincipal] = useState<number | null>(null);
  const [installment, setInstallment] = useState<number | null>(null);
  const [issuedDate, setIssued] = useState(ctx.today);
  const [startDate, setStart] = useState(ctx.today);
  const [note, setNote] = useState("");
  const save = useM("loans.save", {
    onSuccess: (l) => {
      toast.success(`${l.type === "loan" ? "Loan" : "Advance"} ${l.reference} issued`);
      onClose();
    },
    onError: (e) => toast.error("Not saved", e.message),
  });
  const periods = principal && installment ? Math.ceil(principal / installment) : null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Issue loan or advance"
      description="Paid outside payroll; installments are deducted automatically from each payroll from the first deduction date."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!emp || !principal || !installment} onClick={() => save.mutate({ employeeId: emp, type, principal: principal ?? 0, installment: installment ?? 0, issuedDate, startDate, note })}>
            Issue
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {save.error && <Callout tone="danger">{save.error.message}</Callout>}
        {!employeeId && (
          <Field label="Employee" required>
            <Select value={emp} onChange={(e) => setEmp(e.target.value)}>
              <option value="">Select…</option>
              {people.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.employeeCode})</option>)}
            </Select>
          </Field>
        )}
        <FormGrid cols={2}>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as "loan" | "advance")}>
              <option value="advance">Salary advance</option>
              <option value="loan">Loan</option>
            </Select>
          </Field>
          <div />
          <Field label="Principal" required>
            <NumberInput value={principal} onChange={setPrincipal} min={0} step="0.01" prefix="$" />
          </Field>
          <Field label="Installment per payroll" required hint={periods ? `${periods} payroll${periods === 1 ? "" : "s"} to repay` : undefined}>
            <NumberInput value={installment} onChange={setInstallment} min={0} step="0.01" prefix="$" />
          </Field>
          <Field label="Issued on">
            <Input type="date" value={issuedDate} onChange={(e) => setIssued(e.target.value)} />
          </Field>
          <Field label="First deduction on or after">
            <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
        </FormGrid>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {principal && installment ? <p className="text-[12px] text-ink-3">Total {formatMoney(principal, currency)}, deducted {formatMoney(installment, currency)} per payroll.</p> : null}
      </div>
    </Dialog>
  );
}
