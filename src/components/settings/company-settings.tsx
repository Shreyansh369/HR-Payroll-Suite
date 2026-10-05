"use client";

import { useEffect, useState } from "react";
import { useM, useQ } from "@/client/api";
import { useSession } from "@/client/session";
import type { Company, PayCalendar, PayrollSettings } from "@/domain/types";
import { Panel, PanelHeader, LoadingRows, Callout } from "@/components/ui/panel";
import { Button, IconButton } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Switch } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { NumberInput } from "@/components/app/form-helpers";
import { DAILY_METHOD_LABELS, FREQUENCY_LABELS, rateEquivalents } from "@/domain/payroll/rates";
import { periodContaining, nextPeriod } from "@/domain/payroll/calendar";
import { ROUNDING_LABELS, formatMoney } from "@/lib/money";
import { formatDate, formatRange } from "@/lib/dates";
import { fieldErrors } from "@/components/app/form-helpers";

export function CompanyProfileForm() {
  const toast = useToast();
  const { can, refresh } = useSession();
  const q = useQ("company.get", {});
  const [f, setF] = useState<Company | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load server values into the editable form
    if (q.data) setF(q.data);
  }, [q.data]);
  const save = useM("company.update", { onSuccess: async () => { toast.success("Company profile saved"); await refresh(); }, onError: (e) => toast.error("Not saved", e.message) });
  const errs = fieldErrors(save.error);
  if (!f) return <LoadingRows />;
  const editable = can("company.manage");
  const set = <K extends keyof Company>(k: K, v: Company[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  return (
    <Panel>
      <PanelHeader title="Company profile" description="Appears on payslips, reports and statutory schedules." actions={editable && <Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate({ legalName: f.legalName, tradingName: f.tradingName, registrationNumber: f.registrationNumber, address: { ...f.address, line2: f.address.line2 ?? "", region: f.address.region ?? "", postalCode: f.address.postalCode ?? "" }, contactEmail: f.contactEmail, contactPhone: f.contactPhone, currency: f.currency, timezone: f.timezone, fiscalYearStartMonth: f.fiscalYearStartMonth, employerIds: f.employerIds, branding: f.branding })}>Save</Button>} />
      <div className="space-y-5 p-4">
        <FormGrid cols={3}>
          <Field label="Legal name" required error={errs.legalName}><Input value={f.legalName} disabled={!editable} onChange={(e) => set("legalName", e.target.value)} /></Field>
          <Field label="Trading name"><Input value={f.tradingName} disabled={!editable} onChange={(e) => set("tradingName", e.target.value)} /></Field>
          <Field label="Registration number"><Input value={f.registrationNumber} disabled={!editable} onChange={(e) => set("registrationNumber", e.target.value)} /></Field>
          <Field label="Address" className="lg:col-span-2"><Input value={f.address.line1} disabled={!editable} onChange={(e) => set("address", { ...f.address, line1: e.target.value })} /></Field>
          <Field label="City / town"><Input value={f.address.city} disabled={!editable} onChange={(e) => set("address", { ...f.address, city: e.target.value })} /></Field>
          <Field label="Country"><Input value={f.address.country} disabled={!editable} onChange={(e) => set("address", { ...f.address, country: e.target.value })} /></Field>
          <Field label="Contact email" error={errs.contactEmail}><Input type="email" value={f.contactEmail} disabled={!editable} onChange={(e) => set("contactEmail", e.target.value)} /></Field>
          <Field label="Contact phone"><Input value={f.contactPhone} disabled={!editable} onChange={(e) => set("contactPhone", e.target.value)} /></Field>
        </FormGrid>
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">Employer registrations</p>
          <FormGrid cols={3}>
            <Field label="Social Security employer no."><Input value={f.employerIds.socialSecurity} disabled={!editable} onChange={(e) => set("employerIds", { ...f.employerIds, socialSecurity: e.target.value })} /></Field>
            <Field label="NHI employer no."><Input value={f.employerIds.nhi} disabled={!editable} onChange={(e) => set("employerIds", { ...f.employerIds, nhi: e.target.value })} /></Field>
            <Field label="Payroll Tax no."><Input value={f.employerIds.payrollTax} disabled={!editable} onChange={(e) => set("employerIds", { ...f.employerIds, payrollTax: e.target.value })} /></Field>
          </FormGrid>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">Locale & branding</p>
          <FormGrid cols={4}>
            <Field label="Currency" hint="ISO code"><Input value={f.currency} maxLength={3} disabled={!editable} onChange={(e) => set("currency", e.target.value.toUpperCase())} /></Field>
            <Field label="Time zone"><Input value={f.timezone} disabled={!editable} onChange={(e) => set("timezone", e.target.value)} /></Field>
            <Field label="Financial year starts">
              <Select value={String(f.fiscalYearStartMonth)} disabled={!editable} onChange={(e) => set("fiscalYearStartMonth", Number(e.target.value))}>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <div className="flex gap-3">
              <Field label="Short name" className="w-24"><Input value={f.branding.shortName} maxLength={4} disabled={!editable} onChange={(e) => set("branding", { ...f.branding, shortName: e.target.value.toUpperCase() })} /></Field>
              <Field label="Colour"><Input type="color" value={f.branding.accentColor} disabled={!editable} onChange={(e) => set("branding", { ...f.branding, accentColor: e.target.value })} className="h-8 w-16 p-1" /></Field>
            </div>
          </FormGrid>
        </div>
      </div>
    </Panel>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function PayrollSettingsForm() {
  const toast = useToast();
  const { can, ctx } = useSession();
  const q = useQ("company.get", {});
  const [s, setS] = useState<PayrollSettings | null>(null);
  const [calendars, setCalendars] = useState<PayCalendar[]>([]);
  const [holidays, setHolidays] = useState<{ date: string; name: string }[]>([]);
  useEffect(() => {
    if (q.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load server values into the editable form
      setS(q.data.payrollSettings);
      setCalendars(q.data.payCalendars);
      setHolidays(q.data.holidays);
    }
  }, [q.data]);
  const save = useM("company.updatePayrollSettings", { onSuccess: () => toast.success("Payroll settings saved", "They apply to future calculations; finalized payroll keeps its original results."), onError: (e) => toast.error("Not saved", e.message) });
  if (!s) return <LoadingRows />;
  const editable = can("company.manage");
  const set = <K extends keyof PayrollSettings>(k: K, v: PayrollSettings[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const eq = rateEquivalents(2000, "monthly", { daysPerWeek: 5, hoursPerDay: 8 }, s);
  const usedFreqs = new Set(calendars.map((c) => c.frequency));

  return (
    <div className="space-y-4">
      <Callout tone="neutral" title="These choices change how pay is calculated">These are business decisions. Confirm them with your accountant and record the reasoning; every change is audited and applies to calculations from now on.</Callout>
      <Panel>
        <PanelHeader title="Rate & proration methodology" actions={editable && <Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate({ payrollSettings: s, payCalendars: calendars, holidays })}>Save payroll settings</Button>} />
        <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <FormGrid cols={2}>
            <Field label="Daily rate method" hint="Used for unpaid leave deductions and daily equivalents">
              <Select value={s.dailyRateMethod} disabled={!editable} onChange={(e) => set("dailyRateMethod", e.target.value as PayrollSettings["dailyRateMethod"])}>
                {Object.entries(DAILY_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            {s.dailyRateMethod === "fixed_days_per_month" && <Field label="Days per month"><NumberInput value={s.fixedDaysPerMonth} disabled={!editable} onChange={(v) => set("fixedDaysPerMonth", v ?? 21.67)} step={0.01} /></Field>}
            <Field label="Weeks per year"><NumberInput value={s.weeksPerYear} disabled={!editable} onChange={(v) => set("weeksPerYear", v ?? 52)} step={0.0001} /></Field>
            <Field label="Proration for partial periods" hint="Mid-period starters, leavers and rate changes">
              <Select value={s.prorationMethod} disabled={!editable} onChange={(e) => set("prorationMethod", e.target.value as PayrollSettings["prorationMethod"])}>
                <option value="working_days">By scheduled working days</option>
                <option value="calendar_days">By calendar days</option>
              </Select>
            </Field>
            <Field label="Overtime multiplier"><NumberInput value={s.overtimeMultiplier} disabled={!editable} onChange={(v) => set("overtimeMultiplier", v ?? 1.5)} step={0.05} suffix="×" /></Field>
            <Field label="Rounding">
              <Select value={s.roundingMode} disabled={!editable} onChange={(e) => set("roundingMode", e.target.value as PayrollSettings["roundingMode"])}>
                {Object.entries(ROUNDING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Statutory rule date" hint="Which date selects the rule version in force">
              <Select value={s.statutoryDateBasis} disabled={!editable} onChange={(e) => set("statutoryDateBasis", e.target.value as PayrollSettings["statutoryDateBasis"])}>
                <option value="period_end">Pay period end date</option>
                <option value="pay_date">Pay date</option>
              </Select>
            </Field>
            <Field label="Variance warning" hint="Warn when net pay changes more than this vs the previous period"><NumberInput value={Math.round(s.varianceWarningThreshold * 100)} disabled={!editable} onChange={(v) => set("varianceWarningThreshold", (v ?? 20) / 100)} suffix="%" /></Field>
            <Field label="Deduction warning" hint="Warn when voluntary deductions exceed this share of gross"><NumberInput value={Math.round(s.maxDeductionRatio * 100)} disabled={!editable} onChange={(v) => set("maxDeductionRatio", (v ?? 50) / 100)} suffix="%" /></Field>
            <div className="sm:col-span-2">
              <Switch label="Pay hourly employees their scheduled hours when no timesheet is approved" description="Off by default: hourly employees without approved hours are flagged in pre-flight instead." checked={s.hourlyFallbackToSchedule} disabled={!editable} onChange={(v) => set("hourlyFallbackToSchedule", v)} />
            </div>
          </FormGrid>
          <aside className="rounded-lg border border-line bg-surface-2 p-3 text-[12.5px]">
            <p className="font-semibold">Example: {formatMoney(2000, ctx.company.currency)} monthly, Mon–Fri 8 h</p>
            <dl className="mt-2 space-y-1">
              {(["annual", "weekly", "daily", "hourly"] as const).map((k) => (
                <div key={k} className="flex justify-between gap-3"><dt className="capitalize text-ink-2">{k}</dt><dd className="font-medium num">{formatMoney(Number(eq[k]), ctx.company.currency)}</dd></div>
              ))}
            </dl>
            <p className="mt-2 text-[11.5px] text-ink-3">Daily: {eq.formulas.daily}</p>
            <p className="text-[11.5px] text-ink-3">1 unpaid day deducts {formatMoney(Number(eq.daily), ctx.company.currency)}; 4 h overtime pays {formatMoney(Number(eq.hourly) * 4 * s.overtimeMultiplier, ctx.company.currency)}.</p>
          </aside>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Pay calendars" description="One calendar per pay frequency. Regular payroll periods must match a calendar." actions={editable && usedFreqs.size < 4 && <Button size="sm" icon="add" onClick={() => setCalendars((c) => [...c, { frequency: (["monthly", "semi_monthly", "biweekly", "weekly"] as const).find((f) => !usedFreqs.has(f))!, anchorDate: `${ctx.today.slice(0, 4)}-01-05`, payDateOffsetDays: 3, active: true }])}>Add calendar</Button>} />
        <div className="divide-y divide-line">
          {calendars.map((c, i) => {
            const p = periodContaining(c, ctx.today);
            const n = nextPeriod(c, p);
            return (
              <div key={c.frequency} className="grid items-start gap-3 px-4 py-3 md:grid-cols-[150px_170px_150px_1fr_auto]">
                <Field label="Frequency"><Input value={FREQUENCY_LABELS[c.frequency]} disabled /></Field>
                {(c.frequency === "weekly" || c.frequency === "biweekly") ? (
                  <Field label="First period starts" hint={DOW[new Date(`${c.anchorDate}T00:00:00Z`).getUTCDay()]}><Input type="date" value={c.anchorDate} disabled={!editable} onChange={(e) => setCalendars((cs) => cs.map((x, j) => (j === i ? { ...x, anchorDate: e.target.value } : x)))} /></Field>
                ) : <Field label="Periods"><Input value={c.frequency === "monthly" ? "Calendar months" : "1st–15th, 16th–end"} disabled /></Field>}
                <Field label="Pay date offset" hint="Days after period end; negative = before"><NumberInput value={c.payDateOffsetDays} disabled={!editable} onChange={(v) => setCalendars((cs) => cs.map((x, j) => (j === i ? { ...x, payDateOffsetDays: v ?? 0 } : x)))} /></Field>
                <div className="text-[12px] text-ink-2 md:pt-6"><p><span className="text-ink-3">Current</span> {formatRange(p.start, p.end)} · paid {formatDate(p.payDate)}</p><p><span className="text-ink-3">Next</span> {formatRange(n.start, n.end)} · paid {formatDate(n.payDate)}</p></div>
                <div className="flex items-center gap-2 md:pt-7">
                  <Switch label="Active" checked={c.active} disabled={!editable} onChange={(v) => setCalendars((cs) => cs.map((x, j) => (j === i ? { ...x, active: v } : x)))} />
                  {editable && calendars.length > 1 && <IconButton icon="delete" label="Remove calendar" size="sm" onClick={() => setCalendars((cs) => cs.filter((_, j) => j !== i))} />}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Public holidays" description="Excluded from leave day counts and schedule fills; salaried pay is unaffected." actions={editable && <Button size="sm" icon="add" onClick={() => setHolidays((h) => [...h, { date: ctx.today, name: "" }])}>Add holiday</Button>} />
        <ul className="divide-y divide-line">
          {holidays.map((h, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Input type="date" value={h.date} disabled={!editable} onChange={(e) => setHolidays((hs) => hs.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className="w-40" aria-label="Holiday date" />
              <Input value={h.name} disabled={!editable} onChange={(e) => setHolidays((hs) => hs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="min-w-[200px] flex-1" placeholder="Holiday name" aria-label="Holiday name" />
              <span className="w-10 text-[12px] text-ink-3">{DOW[new Date(`${h.date}T00:00:00Z`).getUTCDay()]}</span>
              {editable && <IconButton icon="delete" label="Remove holiday" size="sm" onClick={() => setHolidays((hs) => hs.filter((_, j) => j !== i))} />}
            </li>
          ))}
        </ul>
        {editable && <div className="border-t border-line bg-surface-2 px-4 py-2.5 text-right"><Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate({ payrollSettings: s, payCalendars: calendars, holidays: holidays.filter((h) => h.name.trim()) })}>Save payroll settings</Button></div>}
      </Panel>
    </div>
  );
}
