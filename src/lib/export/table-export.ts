/**
 * Report exporters. Pure functions over a ReportResult; they run in the browser
 * in both demo and production modes (data was already authorized server-side).
 */
import type { ReportColumn, ReportResult, ReportRow } from "@/domain/reports/types";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export function reportToCsv(r: ReportResult): string {
  const rows = r.rows.map((row) => r.columns.map((c) => row[c.key]));
  if (r.totals) rows.push(r.columns.map((c) => r.totals![c.key] ?? ""));
  return rowsToCsv(r.columns.map((c) => c.label), rows);
}

export function displayValue(c: ReportColumn, v: string | number | null | undefined, currency: string): string {
  if (v === null || v === undefined || v === "") return "";
  switch (c.type) {
    case "money":
      return formatMoney(Number(v), currency);
    case "number":
      return formatNumber(Number(v));
    case "percent":
      return `${formatNumber(Number(v) * 100)}%`;
    case "date":
      return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : String(v);
    default:
      return String(v).replace(/_/g, " ");
  }
}

export async function reportToXlsx(r: ReportResult): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "HR & Payroll Suite";
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`${r.companyName} · ${r.subtitle}`]).font = { color: { argb: "FF55585E" } };
  ws.addRow([`Generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC`]).font = { color: { argb: "FF80848B" }, size: 9 };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F0EC" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFD3D0C9" } } };
  });
  const fmt = `"${r.currency === "USD" ? "$" : r.currency + " "}"#,##0.00;[Red]-"${r.currency === "USD" ? "$" : r.currency + " "}"#,##0.00`;
  const add = (row: ReportRow, bold = false) => {
    const x = ws.addRow(r.columns.map((c) => (c.type === "money" || c.type === "number") && row[c.key] !== null && row[c.key] !== "" ? Number(row[c.key]) : (row[c.key] ?? "")));
    r.columns.forEach((c, i) => {
      if (c.type === "money") x.getCell(i + 1).numFmt = fmt;
      if (c.type === "number") x.getCell(i + 1).numFmt = "#,##0.##";
    });
    if (bold) {
      x.font = { bold: true };
      x.eachCell((cell) => (cell.border = { top: { style: "thin", color: { argb: "FF16181B" } } }));
    }
  };
  for (const row of r.rows) add(row);
  if (r.totals) add(r.totals, true);
  r.columns.forEach((c, i) => {
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 200).map((row) => String(row[c.key] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + (c.type === "money" ? 4 : 2)));
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];
  for (const n of r.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF80848B" } };
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export async function reportToPdf(r: ReportResult, opts: { demo: boolean }): Promise<Uint8Array> {
  const { newDoc, text, hline, INK, INK2, INK3, FILL } = await import("@/lib/pdf/common");
  const { degrees, rgb } = await import("pdf-lib");
  const { doc, fonts } = await newDoc(r.title);
  const landscape = r.columns.length > 6;
  const W = landscape ? 841.89 : 595.28;
  const H = landscape ? 595.28 : 841.89;
  const M = 36;
  const size = r.columns.length > 12 ? 6.5 : r.columns.length > 9 ? 7.3 : 8.2;
  const usable = W - 2 * M;
  const measure = (c: ReportColumn) => {
    const sample = [c.label, ...r.rows.slice(0, 80).map((row) => displayValue(c, row[c.key], r.currency)), r.totals ? displayValue(c, r.totals[c.key], r.currency) : ""];
    return Math.min(c.type === "text" ? 170 : 90, Math.max(...sample.map((s) => fonts.regular.widthOfTextAtSize(s, size))) + 10);
  };
  let widths = r.columns.map(measure);
  const total = widths.reduce((a, b) => a + b, 0);
  widths = widths.map((w) => (w / total) * usable);

  let page = doc.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;
  const drawHeader = (first: boolean) => {
    if (first) {
      text(page, r.title, M, y, fonts.bold, 13);
      y -= 15;
      text(page, `${r.companyName} · ${r.subtitle}`, M, y, fonts.regular, 8.5, INK2, { maxWidth: usable });
      y -= 18;
    }
    page.drawRectangle({ x: M, y: y - 4, width: usable, height: 15, color: FILL });
    let x = M;
    r.columns.forEach((c, i) => {
      const right = c.type === "money" || c.type === "number";
      text(page, c.label, right ? x + widths[i] - 4 : x + 4, y, fonts.bold, size, INK2, { align: right ? "right" : "left", maxWidth: widths[i] - 6 });
      x += widths[i];
    });
    y -= 16;
  };
  const footer = () => {
    text(page, `Generated ${r.generatedAt.slice(0, 10)} · page ${pageNo}`, W - M, 20, fonts.regular, 7, INK3, { align: "right" });
    if (opts.demo) page.drawText("DEMO - FICTIONAL DATA", { x: W / 2 - 160, y: H / 2 - 60, size: 36, font: fonts.bold, color: rgb(0.75, 0.25, 0.2), opacity: 0.08, rotate: degrees(25) });
  };
  drawHeader(true);
  const drawRow = (row: ReportRow, bold = false) => {
    if (y < M + 20) {
      footer();
      page = doc.addPage([W, H]);
      pageNo += 1;
      y = H - M;
      drawHeader(false);
    }
    let x = M;
    r.columns.forEach((c, i) => {
      const right = c.type === "money" || c.type === "number";
      const v = displayValue(c, row[c.key], r.currency);
      text(page, v, right ? x + widths[i] - 4 : x + 4, y, bold ? fonts.bold : fonts.regular, size, INK, { align: right ? "right" : "left", maxWidth: widths[i] - 6 });
      x += widths[i];
    });
    hline(page, M, W - M, y - 3.5, rgb(0.93, 0.92, 0.9), 0.4);
    y -= size + 5;
  };
  for (const row of r.rows) drawRow(row);
  if (r.totals) {
    hline(page, M, W - M, y + size + 1, INK, 0.8);
    drawRow(r.totals, true);
  }
  for (const n of r.notes) {
    y -= 6;
    text(page, n, M, y, fonts.regular, 7.5, INK3, { maxWidth: usable });
    y -= 10;
  }
  footer();
  return doc.save();
}
