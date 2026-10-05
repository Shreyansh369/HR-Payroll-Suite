"use client";

import { useState } from "react";
import { call, errorMessage } from "@/client/api";
import type { ReportResult } from "@/domain/reports/types";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { IS_DEMO } from "@/config/env";
import { saveBlob, slug } from "@/lib/download";

export function ExportMenu({ report, disabled }: { report: ReportResult | undefined; disabled?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(format: "csv" | "xlsx" | "pdf") {
    if (!report) return;
    setBusy(true);
    try {
      const mod = await import("@/lib/export/table-export");
      const base = `${slug(report.title)}-${report.generatedAt.slice(0, 10)}`;
      if (format === "csv") saveBlob(mod.reportToCsv(report), `${base}.csv`, "text/csv;charset=utf-8");
      if (format === "xlsx") saveBlob(await mod.reportToXlsx(report), `${base}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (format === "pdf") saveBlob(await mod.reportToPdf(report, { demo: IS_DEMO }), `${base}.pdf`, "application/pdf");
      await call("audit.logExport", { kind: "report", title: `${report.title} — ${report.subtitle}`, format, rows: report.rows.length });
      toast.success(`${report.title} exported`, format.toUpperCase());
    } catch (e) {
      toast.error("Export failed", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Menu trigger={<Button icon="download" loading={busy} disabled={disabled || !report}>Export</Button>}>
      <MenuItem icon="file" onSelect={() => run("pdf")} hint="print">PDF</MenuItem>
      <MenuItem icon="file" onSelect={() => run("xlsx")} hint="Excel">XLSX</MenuItem>
      <MenuItem icon="file" onSelect={() => run("csv")}>CSV</MenuItem>
    </Menu>
  );
}
