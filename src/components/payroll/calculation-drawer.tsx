"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { ProcOutput } from "@/services/registry";
import type { PayrollLine } from "@/domain/types";
import { Drawer } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/panel";
import { Icon } from "@/components/ui/icon";
import { formatMoney, formatNumber, formatPercent } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { describeWorkDays } from "@/domain/employee/schedule";
import { BASIS_SUFFIX } from "@/lib/labels";
import { cn } from "@/lib/cn";

type Result = ProcOutput<"payroll.runs.get">["results"][number];

function Row({ label, formula, amount, currency, sign, strong, muted, source }: { label: ReactNode; formula?: string; amount: number; currency: string; sign?: "+" | "−" | "="; strong?: boolean; muted?: boolean; source?: string }) {
  return (
    <div className={cn("grid grid-cols-[18px_minmax(0,1fr)_auto] items-baseline gap-x-2 py-1.5", strong && "border-t border-line-strong pt-2")}>
      <span className="text-center text-[12px] text-ink-3 num">{sign}</span>
      <div className="min-w-0">
        <p className={cn("text-[13px]", strong ? "font-semibold text-ink" : muted ? "text-ink-2" : "text-ink")}>
          {label}
          {source && <span className="ml-1.5 rounded-sm bg-surface-3 px-1 py-px text-[10.5px] font-medium uppercase tracking-[0.03em] text-ink-3">{source}</span>}
        </p>
        {formula && <p className="text-[11.5px] leading-snug text-ink-3">{formula}</p>}
      </div>
      <span className={cn("text-right num text-[13px]", strong && "font-semibold", amount < 0 && "text-danger")}>{formatMoney(amount, currency)}</span>
    </div>
  );
}

const SOURCE_LABEL: Record<PayrollLine["source"], string> = {
  pay_rate: "rate",
  attendance: "timesheet",
  leave: "leave",
  recurring: "recurring",
  one_time: "one-time",
  loan: "loan",
  statutory: "statutory",
  correction: "correction",
  historical: "imported",
};

export function CalculationDrawer({ result: r, currency, open, onOpenChange, actions }: { result: Result | null; currency: string; open: boolean; onOpenChange: (o: boolean) => void; actions?: ReactNode }) {
  if (!r) return null;
  const earn = r.lines.filter((l) => l.section === "earning");
  const pre = r.lines.filter((l) => l.section === "pre_tax_deduction");
  const stat = r.lines.filter((l) => l.section === "statutory_employee");
  const er = r.lines.filter((l) => l.section === "statutory_employer");
  const ded = r.lines.filter((l) => l.section === "deduction");
  const info = r.lines.filter((l) => l.section === "info");
  const nonTaxable = earn.filter((l) => !l.taxable).reduce((s, l) => s + l.amount, 0);
  const delta = r.previousNet !== null ? r.totals.net - r.previousNet : null;

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {r.employee.name}
          <Badge>{r.employee.code}</Badge>
        </span>
      }
      description={`${r.employee.position} · ${r.employee.departmentName} · ${r.employee.payType === "salary" ? "Salaried" : "Hourly"}`}
      footer={
        <>
          <Link href={`/app/employees/${r.employeeId}`} className="mr-auto text-[12.5px] font-medium text-accent hover:underline">Open profile</Link>
          {actions}
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
          {[
            ["Gross", r.totals.gross],
            ["Net pay", r.totals.net],
            ["Employer cost", r.totals.employerCost],
          ].map(([k, v]) => (
            <div key={k as string} className="bg-surface px-3 py-2.5">
              <p className="text-[11.5px] text-ink-3">{k}</p>
              <p className="text-[16px] font-semibold num">{formatMoney(v as number, currency)}</p>
            </div>
          ))}
        </div>
        {delta !== null && Math.abs(delta) >= 0.01 && (
          <p className="text-[12px] text-ink-2">
            Net pay {delta > 0 ? "up" : "down"} <span className="font-medium num">{formatMoney(Math.abs(delta), currency)}</span> vs previous period ({formatMoney(r.previousNet!, currency)}).
          </p>
        )}

        {r.warnings.filter((w) => !w.code.startsWith("RULE_NOT_APPROVED")).length > 0 && (
          <div className="space-y-1.5">
            {r.warnings.filter((w) => !w.code.startsWith("RULE_NOT_APPROVED")).map((w) => (
              <Callout key={w.id} tone={w.severity === "error" ? "danger" : w.severity === "warning" ? "warning" : "neutral"}>{w.message}</Callout>
            ))}
          </div>
        )}

        <section>
          <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">Gross to net</h3>
          <div className="rounded-lg border border-line px-3 py-1">
            {earn.map((l, i) => (
              <Row key={i} sign="+" label={l.label} formula={l.formula} amount={l.amount} currency={currency} source={SOURCE_LABEL[l.source]} />
            ))}
            <Row sign="=" label="Gross earnings" amount={r.totals.gross} currency={currency} strong />
            {pre.map((l, i) => (
              <Row key={i} sign="−" label={l.label} formula={l.formula} amount={-l.amount} currency={currency} source={SOURCE_LABEL[l.source]} />
            ))}
            {(pre.length > 0 || nonTaxable !== 0) && <Row sign="=" label="Taxable remuneration" formula={nonTaxable ? `Excludes ${formatMoney(nonTaxable, currency)} non-taxable earnings` : undefined} amount={r.totals.taxable} currency={currency} strong />}
            {stat.map((l, i) => (
              <Row key={i} sign="−" label={l.label} formula={l.formula} amount={-l.amount} currency={currency} />
            ))}
            {ded.map((l, i) => (
              <Row key={i} sign="−" label={l.label} formula={l.formula} amount={-l.amount} currency={currency} source={SOURCE_LABEL[l.source]} />
            ))}
            <Row sign="=" label="Net pay" amount={r.totals.net} currency={currency} strong />
          </div>
        </section>

        {r.statutory.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">Statutory contributions</h3>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.04em] text-ink-3">
                  <tr><th className="px-3 py-1.5 text-left font-medium">Rule</th><th className="px-3 py-1.5 text-right font-medium">Base</th><th className="px-3 py-1.5 text-right font-medium">Employee</th><th className="px-3 py-1.5 text-right font-medium">Employer</th></tr>
                </thead>
                <tbody>
                  {r.statutory.map((s) => (
                    <tr key={s.code} className="border-t border-line align-top">
                      <td className="px-3 py-1.5">
                        <p className="font-medium">{s.name} {s.status !== "approved" && <Badge tone="warning">{s.status === "demo" ? "Illustrative" : s.status}</Badge>}</p>
                        <p className="text-[11.5px] text-ink-3">{s.explanation}</p>
                        <p className="text-[11px] text-ink-4">Rule effective {formatDate(s.effectiveFrom)} · {formatPercent(s.employeeRate)} / {formatPercent(s.employerRate)}</p>
                      </td>
                      <td className="px-3 py-1.5 text-right num">{formatMoney(s.contributableBase, currency)}{s.ceilingApplied && <span className="block text-[10.5px] text-warning">ceiling</span>}</td>
                      <td className="px-3 py-1.5 text-right num">{formatMoney(s.employeeAmount, currency)}</td>
                      <td className="px-3 py-1.5 text-right num">{formatMoney(s.employerAmount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {er.length === 0 && <p className="mt-1 text-[11.5px] text-ink-3">No employer contributions.</p>}
          </section>
        )}

        {info.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">Leave in this period</h3>
            <ul className="space-y-1 text-[12.5px]">
              {info.map((l, i) => (
                <li key={i} className="flex gap-2"><Icon name="calendar" size="sm" className="mt-0.5 text-ink-3" /><span><span className="font-medium">{l.label}</span> — {l.formula}</span></li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink-3">Rates & assumptions</h3>
          <div className="space-y-1.5 rounded-lg border border-line bg-surface-2 p-3 text-[12.5px]">
            {r.rates.segments.length === 0 && <p className="text-ink-3">No pay rate segments (correction or off-cycle payment).</p>}
            {r.rates.segments.map((s, i) => (
              <p key={i}>
                <span className="font-medium num">{formatMoney(s.amount, currency)} {BASIS_SUFFIX[s.basis]}</span>
                <span className="text-ink-3"> · {formatDate(s.from)} – {formatDate(s.to)} · period {formatMoney(s.periodAmount, currency)} · daily {formatMoney(s.dailyRate, currency)} · hourly {formatMoney(s.hourlyRate, currency)}</span>
              </p>
            ))}
            {r.rates.schedule.workDays.length > 0 && <p className="text-ink-2">Schedule: {describeWorkDays(r.rates.schedule.workDays)}, {formatNumber(r.rates.schedule.hoursPerDay)} h/day · {r.workedDays} of {r.scheduledDays} scheduled days employed</p>}
            <p className="text-ink-3">{r.rates.methodology}</p>
            <p className="text-[11.5px] text-ink-4">Calculation version {r.calculationVersion}</p>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
