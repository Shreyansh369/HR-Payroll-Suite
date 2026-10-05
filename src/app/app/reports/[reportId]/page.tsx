"use client";

import { Suspense, use, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQ } from "@/client/api";
import { useSession } from "@/client/session";
import { REPORTS, type ReportColumn } from "@/domain/reports/types";
import { PageHeader, Panel, EmptyState, LoadingRows, ErrorState, Callout } from "@/components/ui/panel";
import { Field, Input, Select } from "@/components/ui/form";
import { DataTable, TotalsRow, type Column } from "@/components/ui/table";
import { ExportMenu } from "@/components/reports/export-menu";
import { displayValue } from "@/lib/export/table-export";
import { addMonths, endOfMonth, startOfMonth, yearOf } from "@/lib/dates";
import { cn } from "@/lib/cn";

function ReportView({ reportId }: { reportId: string }) {
  const { ctx } = useSession();
  const params = useSearchParams();
  const def = REPORTS.find((r) => r.id === reportId);
  const [runId, setRunId] = useState(params.get("runId") ?? "");
  const [year, setYear] = useState(yearOf(ctx.today));
  const [from, setFrom] = useState(`${ctx.today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(ctx.today);
  const [asOf, setAsOf] = useState(ctx.today);
  const needs = def?.params ?? [];
  const runs = useQ("payroll.runs.list", {}, { enabled: needs.includes("run") });
  const calculated = runs.data?.filter((r) => r.totals) ?? [];
  const effectiveRun = runId || calculated[0]?.id || "";
  const ready = !needs.includes("run") || !!effectiveRun;
  const q = useQ(
    "reports.run",
    { reportId, runId: needs.includes("run") ? effectiveRun : undefined, year: needs.includes("year") ? year : undefined, from: needs.includes("range") ? from : undefined, to: needs.includes("range") ? to : undefined, asOf: needs.includes("asOf") ? asOf : undefined },
    { enabled: !!def && ready },
  );
  const r = q.data;

  const columns = useMemo<Column<Record<string, string | number | null>>[]>(
    () =>
      (r?.columns ?? []).map((c: ReportColumn) => ({
        key: c.key,
        header: c.label,
        align: c.type === "money" || c.type === "number" ? "right" : "left",
        hideBelow: c.priority === 3 ? "lg" : c.priority === 2 ? "md" : undefined,
        sortValue: (row) => (row[c.key] === "" ? null : row[c.key]),
        cell: (row) => {
          const v = row[c.key];
          const s = displayValue(c, v, r!.currency);
          return <span className={cn(c.type === "money" && Number(v) < 0 && "text-danger", c.type === "money" && Number(v) === 0 && "text-ink-4", c.type === "text" && "block max-w-[320px] truncate")} title={c.type === "text" ? s : undefined}>{s || <span className="text-ink-4">—</span>}</span>;
        },
      })),
    [r],
  );

  if (!def) return <ErrorState message="This report does not exist." />;
  const presets = [
    { label: "Year to date", from: `${ctx.today.slice(0, 4)}-01-01`, to: ctx.today },
    { label: "Last month", from: addMonths(startOfMonth(ctx.today), -1), to: endOfMonth(addMonths(startOfMonth(ctx.today), -1)) },
    { label: "Last quarter", from: addMonths(startOfMonth(ctx.today), -3), to: ctx.today },
    { label: "Last year", from: `${yearOf(ctx.today) - 1}-01-01`, to: `${yearOf(ctx.today) - 1}-12-31` },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Reports", href: "/app/reports" }, { label: def.title }]}
        title={def.title}
        description={r ? `${r.companyName} · ${r.subtitle}` : def.description}
        actions={<ExportMenu report={r} disabled={!r || r.rows.length === 0} />}
      />
      {needs.length > 0 && (
        <Panel className="mb-4">
          <div className="flex flex-wrap items-end gap-3 p-3">
            {needs.includes("run") && (
              <Field label="Payroll run" className="min-w-[280px]">
                <Select value={effectiveRun} onChange={(e) => setRunId(e.target.value)}>
                  {calculated.length === 0 && <option value="">No calculated payroll</option>}
                  {calculated.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.status})</option>)}
                </Select>
              </Field>
            )}
            {needs.includes("year") && (
              <Field label="Year">
                <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
                  {[0, 1, 2, 3].map((i) => <option key={i}>{yearOf(ctx.today) - i}</option>)}
                </Select>
              </Field>
            )}
            {needs.includes("range") && (
              <>
                <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                <div className="flex flex-wrap gap-1.5 pb-1.5">
                  {presets.map((p) => (
                    <button key={p.label} type="button" onClick={() => { setFrom(p.from); setTo(p.to); }} className={cn("rounded-md border px-2 py-1 text-[12px]", from === p.from && to === p.to ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:border-line-strong")}>{p.label}</button>
                  ))}
                </div>
              </>
            )}
            {needs.includes("asOf") && <Field label="As of"><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>}
          </div>
        </Panel>
      )}
      {r?.notes.map((n) => <Callout key={n} tone="neutral" className="mb-3">{n}</Callout>)}
      <Panel>
        {!ready ? <EmptyState icon="wallet" title="No calculated payroll yet" /> : q.isLoading ? <LoadingRows rows={10} /> : q.error ? <ErrorState message={q.error.message} onRetry={() => q.refetch()} /> : (
          <DataTable
            dense
            columns={columns}
            rows={r!.rows}
            rowKey={(row) => JSON.stringify(row).slice(0, 200) + r!.rows.indexOf(row)}
            empty={<EmptyState compact icon="chart" title="No data for these settings" />}
            footer={r!.totals ? <TotalsRow cells={r!.columns.map((c, i) => ({ content: c.type === "text" ? String(r!.totals![c.key] ?? "") : displayValue(c, r!.totals![c.key], r!.currency), align: c.type === "money" || c.type === "number" ? "right" : "left", hideBelow: c.priority === 3 ? "lg" : c.priority === 2 ? "md" : undefined }))} /> : undefined}
          />
        )}
      </Panel>
      {r && <p className="mt-2 text-right text-[11.5px] text-ink-3">{r.rows.length} rows · generated {r.generatedAt.slice(11, 16)} UTC</p>}
    </>
  );
}

export default function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = use(params);
  return (
    <Suspense>
      <ReportView reportId={reportId} />
    </Suspense>
  );
}
