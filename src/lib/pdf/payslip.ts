/**
 * Payslip PDF rendering. Pure function of authorized payslip data; runs in the
 * browser in both demo and production modes.
 */
import { degrees, type PDFDocument, type PDFPage } from "pdf-lib";
import type { ProcOutput } from "@/services/registry";
import { formatMoney } from "@/lib/money";
import { formatDate, formatRange } from "@/lib/dates";
import { ACCENT, FILL, INK, INK2, INK3, LINE, hline, newDoc, safe, text, type Fonts } from "@/lib/pdf/common";
import { rgb } from "pdf-lib";

export type PayslipBundle = ProcOutput<"payroll.payslips">;
type Payslip = PayslipBundle["payslips"][number];

const W = 595.28;
const H = 841.89;
const M = 44;

function drawPayslip(doc: PDFDocument, fonts: Fonts, bundle: PayslipBundle, slip: Payslip, opts: { demo: boolean }) {
  const page: PDFPage = doc.addPage([W, H]);
  const { company, run } = bundle;
  const r = slip.result;
  const cur = company.currency;
  const fm = (n: number) => formatMoney(n, cur);
  const final = run.status === "finalized" || run.status === "locked";
  let y = H - M;

  // Header
  text(page, company.legalName, M, y, fonts.bold, 13);
  text(page, "PAYSLIP", W - M, y, fonts.bold, 13, ACCENT, { align: "right" });
  y -= 15;
  const addr = [company.address.line1, company.address.city, company.address.country].filter(Boolean).join(", ");
  text(page, addr, M, y, fonts.regular, 8.5, INK2, { maxWidth: 320 });
  text(page, run.type === "correction" ? "Correction" : run.type === "off_cycle" ? "Off-cycle payment" : run.type === "historical" ? "Historical (imported)" : "Regular payroll", W - M, y, fonts.regular, 8.5, INK2, { align: "right" });
  y -= 12;
  text(page, `Employer SS ${company.employerIds.socialSecurity || "-"}  |  NHI ${company.employerIds.nhi || "-"}  |  Payroll Tax ${company.employerIds.payrollTax || "-"}`, M, y, fonts.regular, 7.5, INK3);
  y -= 16;
  hline(page, M, W - M, y, INK, 1);
  y -= 22;

  // Employee + period blocks
  const colW = (W - 2 * M - 16) / 2;
  const block = (x: number, rows: [string, string][]) => {
    let yy = y;
    for (const [k, v] of rows) {
      text(page, k, x, yy, fonts.regular, 8, INK3);
      text(page, v, x + 92, yy, fonts.bold, 9, INK, { maxWidth: colW - 96 });
      yy -= 14;
    }
    return yy;
  };
  const y1 = block(M, [
    ["Employee", r.employee.name],
    ["Employee ID", r.employee.code],
    ["Position", r.employee.position || "-"],
    ["Department", r.employee.departmentName || "-"],
  ]);
  const y2 = block(M + colW + 16, [
    ["Pay period", formatRange(r.periodStart, r.periodEnd)],
    ["Pay date", formatDate(r.payDate)],
    ["Pay method", r.employee.payMethod.replace("_", " ") + (r.employee.bankAccountMasked ? `  ${r.employee.bankAccountMasked}` : "")],
    ["Pay type", r.employee.payType === "salary" ? "Salaried" : "Hourly"],
  ]);
  y = Math.min(y1, y2) - 10;

  // Line tables
  const cols = { desc: M + 8, qty: M + 300, rate: M + 380, amt: W - M - 8 };
  const section = (title: string, lines: { label: string; quantity?: number | null; unit?: string | null; rate?: number | null; amount: number }[], totalLabel: string, total: number, sign = 1) => {
    if (lines.length === 0) return;
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: FILL });
    text(page, title, cols.desc, y, fonts.bold, 8.5, INK2);
    text(page, "Qty", cols.qty, y, fonts.bold, 8, INK3, { align: "right" });
    text(page, "Rate", cols.rate, y, fonts.bold, 8, INK3, { align: "right" });
    text(page, "Amount", cols.amt, y, fonts.bold, 8, INK3, { align: "right" });
    y -= 18;
    for (const l of lines) {
      text(page, l.label, cols.desc, y, fonts.regular, 9, INK, { maxWidth: 270 });
      if (l.quantity !== null && l.quantity !== undefined) text(page, `${l.quantity}${l.unit === "hours" ? " h" : l.unit === "days" ? " d" : ""}`, cols.qty, y, fonts.regular, 9, INK2, { align: "right" });
      if (l.rate) text(page, l.rate < 1 ? `${(l.rate * 100).toFixed(2)}%` : fm(l.rate), cols.rate, y, fonts.regular, 9, INK2, { align: "right" });
      text(page, fm(l.amount * sign), cols.amt, y, fonts.regular, 9, INK, { align: "right" });
      y -= 13;
    }
    hline(page, M, W - M, y + 6);
    y -= 6;
    text(page, totalLabel, cols.desc, y, fonts.bold, 9);
    text(page, fm(total * sign), cols.amt, y, fonts.bold, 9, INK, { align: "right" });
    y -= 22;
  };

  const earnings = r.lines.filter((l) => l.section === "earning");
  section("Earnings", earnings, "Gross earnings", r.totals.gross);
  section("Pre-tax deductions", r.lines.filter((l) => l.section === "pre_tax_deduction"), "Total pre-tax deductions", r.totals.preTaxDeductions, -1);
  if (r.totals.preTaxDeductions > 0 || earnings.some((l) => !l.taxable)) {
    text(page, "Taxable remuneration", cols.desc, y + 8, fonts.regular, 8.5, INK2);
    text(page, fm(r.totals.taxable), cols.amt, y + 8, fonts.regular, 8.5, INK2, { align: "right" });
    y -= 8;
  }
  section("Statutory deductions", r.lines.filter((l) => l.section === "statutory_employee"), "Total statutory deductions", r.totals.employeeStatutory, -1);
  section("Other deductions", r.lines.filter((l) => l.section === "deduction"), "Total other deductions", r.totals.postTaxDeductions, -1);

  // Net pay box
  page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 34, color: rgb(0.906, 0.937, 0.925), borderColor: ACCENT, borderWidth: 0.8 });
  text(page, "NET PAY", cols.desc, y, fonts.bold, 11, ACCENT);
  text(page, fm(r.totals.net), cols.amt, y - 1, fonts.bold, 15, INK, { align: "right" });
  y -= 42;

  // Paid / unpaid leave info
  const info = r.lines.filter((l) => l.section === "info");
  if (info.length) {
    text(page, "Leave in this period", M, y, fonts.bold, 8.5, INK2);
    y -= 12;
    for (const l of info) {
      text(page, `${l.label}: ${l.formula}`, M + 8, y, fonts.regular, 8, INK2, { maxWidth: W - 2 * M - 16 });
      y -= 11;
    }
    y -= 8;
  }

  // Employer contributions + YTD side by side
  const half = (W - 2 * M - 20) / 2;
  const top = y;
  text(page, "Employer contributions (not deducted)", M, y, fonts.bold, 8.5, INK2);
  y -= 13;
  for (const l of r.lines.filter((l) => l.section === "statutory_employer")) {
    text(page, l.label.replace(" (employer)", ""), M + 8, y, fonts.regular, 8.5, INK2);
    text(page, fm(l.amount), M + half, y, fonts.regular, 8.5, INK2, { align: "right" });
    y -= 12;
  }
  text(page, "Total employer cost", M + 8, y, fonts.bold, 8.5);
  text(page, fm(r.totals.employerCost), M + half, y, fonts.bold, 8.5, INK, { align: "right" });
  let yy = top;
  const x2 = M + half + 20;
  text(page, `Year to date (${r.payDate.slice(0, 4)}, finalized payrolls${final ? "" : " + this payslip"})`, x2, yy, fonts.bold, 8.5, INK2);
  yy -= 13;
  const ytd = slip.ytd;
  const ytdRows: [string, number][] = [
    ["Gross", ytd.gross],
    ...Object.values(ytd.statutory).map((s) => [`${s.name} (employee)`, s.employee] as [string, number]),
    ["Other deductions", ytd.deductions],
    ["Net", ytd.net],
  ];
  for (const [k, v] of ytdRows) {
    text(page, k, x2 + 8, yy, fonts.regular, 8.5, INK2, { maxWidth: half - 100 });
    text(page, fm(v), W - M, yy, fonts.regular, 8.5, INK2, { align: "right" });
    yy -= 12;
  }
  y = Math.min(y, yy) - 20;

  // Footer
  hline(page, M, W - M, 70);
  const rules = r.statutory.map((s) => `${s.code} eff. ${s.effectiveFrom}${s.status === "approved" ? "" : ` (${s.status === "demo" ? "illustrative" : s.status})`}`).join(", ");
  text(page, `Calculation ${r.calculationVersion}. Statutory rules: ${rules || "none"}. ${r.rates.methodology}`, M, 58, fonts.regular, 6.8, INK3, { maxWidth: W - 2 * M });
  text(page, `${run.name}  |  ${final ? "Final" : `Not final (${run.status})`}  |  Generated ${new Date().toISOString().slice(0, 10)}`, M, 47, fonts.regular, 6.8, INK3, { maxWidth: W - 2 * M });
  text(page, "Questions about this payslip? Contact your payroll administrator.", M, 36, fonts.regular, 6.8, INK3);

  const mark = opts.demo ? "DEMO - FICTIONAL DATA" : !final ? "DRAFT - NOT FINAL" : null;
  if (mark) page.drawText(safe(mark), { x: 120, y: 300, size: 40, font: fonts.bold, color: rgb(0.75, 0.25, 0.2), opacity: 0.1, rotate: degrees(32) });
  void LINE;
}

export async function renderPayslips(bundle: PayslipBundle, opts: { demo: boolean }): Promise<Uint8Array> {
  const { doc, fonts } = await newDoc(`Payslips · ${bundle.run.name}`);
  for (const slip of bundle.payslips) drawPayslip(doc, fonts, bundle, slip, opts);
  return doc.save();
}

/** One PDF per employee, bundled into a ZIP. */
export async function renderPayslipZip(bundle: PayslipBundle, opts: { demo: boolean }): Promise<Uint8Array> {
  const { zipSync } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  for (const slip of bundle.payslips) {
    const one = await renderPayslips({ ...bundle, payslips: [slip] }, opts);
    const name = `${slip.result.employee.code}-${slip.result.employee.name.replace(/[^A-Za-z0-9]+/g, "-")}-${slip.result.payDate}.pdf`;
    files[name] = one;
  }
  return zipSync(files, { level: 6 });
}

export { INK };
