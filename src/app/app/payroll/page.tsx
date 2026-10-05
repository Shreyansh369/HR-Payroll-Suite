"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { PayFrequency } from "@/domain/types";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormGrid, Input, Select, Segmented } from "@/components/ui/form";
import { DataTable, Money } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icon";
import { FREQUENCY_LABELS } from "@/domain/payroll/rates";
import { formatDate, formatRange, yearOf } from "@/lib/dates";

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const company = useQ("company.get", {});
  const calendars = company.data?.payCalendars.filter((c) => c.active) ?? [];
  const [type, setType] = useState<"regular" | "off_cycle">("regular");
  const [frequency, setFrequency] = useState<PayFrequency | "">("");
  const freq = (frequency || calendars[0]?.frequency || "monthly") as PayFrequency;
  const suggestion = useQ("payroll.runs.suggest", { frequency: freq }, { enabled: !!company.data });
  const [period, setPeriod] = useState<{ start: string; end: string; payDate: string } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the suggested period when it changes
    if (suggestion.data) setPeriod({ start: suggestion.data.start, end: suggestion.data.end, payDate: suggestion.data.payDate });
  }, [suggestion.data]);
  const [name, setName] = useState("");
  const create = useM("payroll.runs.create", {
    onSuccess: (run) => {
      toast.success("Payroll created", `${run.employeeIds.length} employees included. Add one-time items, then calculate.`);
      router.push(`/app/payroll/${run.id}`);
    },
    onError: (e) => toast.error("Payroll not created", e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New payroll run"
      description="Employees are included automatically based on their pay frequency and employment dates."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!period} loading={create.isPending} onClick={() => period && create.mutate({ type, payFrequency: freq, periodStart: period.start, periodEnd: period.end, payDate: period.payDate, name: name || undefined, employeeIds: type === "off_cycle" ? [] : undefined })}>
            Create payroll
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error && <Callout tone="danger">{create.error.message}</Callout>}
        <Segmented label="Run type" value={type} onChange={setType} options={[{ value: "regular", label: "Regular payroll" }, { value: "off_cycle", label: "Off-cycle payment" }]} />
        {type === "off_cycle" && <p className="text-[12.5px] text-ink-2">Off-cycle runs pay one-time items only (bonuses, commissions, adjustments) with statutory contributions. You choose the employees after creating it.</p>}
        <FormGrid cols={2}>
          <Field label="Pay frequency">
            <Select value={freq} onChange={(e) => setFrequency(e.target.value as PayFrequency)}>
              {(calendars.length ? calendars.map((c) => c.frequency) : (Object.keys(FREQUENCY_LABELS) as PayFrequency[])).map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
            </Select>
          </Field>
          <Field label="Name" hint="Optional">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestion.data?.name} />
          </Field>
          <Field label="Period start" hint={type === "regular" ? "Must match the pay calendar" : undefined}>
            <Input type="date" value={period?.start ?? ""} onChange={(e) => period && setPeriod({ ...period, start: e.target.value })} disabled={type === "regular"} />
          </Field>
          <Field label="Period end">
            <Input type="date" value={period?.end ?? ""} onChange={(e) => period && setPeriod({ ...period, end: e.target.value })} disabled={type === "regular"} />
          </Field>
          <Field label="Pay date">
            <Input type="date" value={period?.payDate ?? ""} onChange={(e) => period && setPeriod({ ...period, payDate: e.target.value })} />
          </Field>
        </FormGrid>
        {suggestion.data && type === "regular" && (
          <Callout tone="neutral" icon="calendar">
            Next {FREQUENCY_LABELS[freq].toLowerCase()} period: <span className="font-medium text-ink">{formatRange(suggestion.data.start, suggestion.data.end)}</span> · {suggestion.data.eligibleCount} eligible employees.
          </Callout>
        )}
      </div>
    </Dialog>
  );
}

function PayrollList() {
  const { can, ctx } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const [creating, setCreating] = useState(params.get("new") === "1" && can("payroll.create"));
  const [year, setYear] = useState(yearOf(ctx.today));
  const [show, setShow] = useState<"all" | "regular" | "corrections">("all");
  const q = useQ("payroll.runs.list", { year });
  const open = q.data?.filter((r) => !["finalized", "locked"].includes(r.status)) ?? [];
  const history = (q.data ?? []).filter((r) => ["finalized", "locked"].includes(r.status)).filter((r) => show === "all" || (show === "regular" ? r.type === "regular" : r.type === "correction"));
  const cur = ctx.company.currency;

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Calculate, review, approve, finalize and lock payroll. Locked payrolls are changed only through correction runs."
        actions={can("payroll.create") && <Button variant="primary" icon="add" onClick={() => setCreating(true)}>New payroll run</Button>}
      />
      {q.isLoading ? <LoadingRows /> : q.error ? <ErrorState message={q.error.message} /> : (
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="In progress" description={open.length ? undefined : "No payroll is being prepared"} />
            {open.length ? (
              <ul className="divide-y divide-line">
                {open.map((r) => (
                  <li key={r.id}>
                    <Link href={`/app/payroll/${r.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-6">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                          {r.name} <StatusBadge status={r.status} />
                          {r.type !== "regular" && <Badge tone="info">{r.type === "correction" ? "Correction" : "Off-cycle"}</Badge>}
                          {r.stale && <Badge tone="warning">Recalculate</Badge>}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-3">{formatRange(r.periodStart, r.periodEnd)} · pay {formatDate(r.payDate)} · {r.employeeIds.length} employees · {r.inputCount} one-time items</p>
                      </div>
                      <div className="flex gap-2 text-[12px]">
                        {r.preflight.errors > 0 && <Badge tone="danger">{r.preflight.errors} errors</Badge>}
                        {r.preflight.unacknowledged > 0 && <Badge tone="warning">{r.preflight.unacknowledged} warnings</Badge>}
                        {r.totals && r.preflight.canApprove && <Badge tone="success">Pre-flight clear</Badge>}
                      </div>
                      <div className="text-right">
                        <p className="text-[11.5px] text-ink-3">Net pay</p>
                        <Money value={r.totals?.net ?? null} currency={cur} className="text-[14px] font-semibold" />
                      </div>
                      <Icon name="chevronRight" className="hidden text-ink-4 sm:block" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon="wallet" title="Nothing in progress" description="Start the next regular payroll when you're ready." action={can("payroll.create") ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New payroll run</Button> : undefined} />
            )}
          </Panel>
          <Panel>
            <PanelHeader
              title="Finalized & locked"
              actions={
                <>
                  <Segmented size="sm" label="Show" value={show} onChange={setShow} options={[{ value: "all", label: "All" }, { value: "regular", label: "Regular" }, { value: "corrections", label: "Corrections" }]} />
                  <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-24" aria-label="Year">
                    {[0, 1, 2].map((i) => <option key={i} value={yearOf(ctx.today) - i}>{yearOf(ctx.today) - i}</option>)}
                  </Select>
                </>
              }
            />
            <DataTable
              onRowClick={(r) => router.push(`/app/payroll/${r.id}`)}
              columns={[
                { key: "name", header: "Payroll", sortValue: (r) => r.payDate, cell: (r) => <span className="flex flex-wrap items-center gap-1.5 font-medium">{r.name}{r.type === "correction" && <Badge tone="info">Correction</Badge>}{r.type === "historical" && <Badge>Imported</Badge>}</span> },
                { key: "pay", header: "Pay date", hideBelow: "sm", sortValue: (r) => r.payDate, cell: (r) => <span className="num text-ink-2">{formatDate(r.payDate)}</span> },
                { key: "emps", header: "Employees", align: "right", hideBelow: "md", cell: (r) => r.totals?.employees ?? r.employeeIds.length },
                { key: "gross", header: "Gross", align: "right", sortValue: (r) => r.totals?.gross ?? 0, cell: (r) => <Money value={r.totals?.gross ?? null} currency={cur} /> },
                { key: "stat", header: "Statutory (ee + er)", align: "right", hideBelow: "lg", cell: (r) => <Money value={r.totals ? r.totals.employeeStatutory + r.totals.employerStatutory : null} currency={cur} /> },
                { key: "net", header: "Net", align: "right", sortValue: (r) => r.totals?.net ?? 0, cell: (r) => <Money value={r.totals?.net ?? null} currency={cur} className="font-medium" /> },
                { key: "cost", header: "Employer cost", align: "right", hideBelow: "xl", cell: (r) => <Money value={r.totals?.employerCost ?? null} currency={cur} /> },
                { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
              ]}
              rows={history}
              rowKey={(r) => r.id}
              initialSort={{ key: "pay", dir: "desc" }}
              empty={<EmptyState compact icon="wallet" title={`No finalized payroll in ${year}`} />}
            />
          </Panel>
        </div>
      )}
      {creating && <NewRunDialog onClose={() => setCreating(false)} />}
    </>
  );
}

export default function PayrollPage() {
  return (
    <Suspense>
      <PayrollList />
    </Suspense>
  );
}
