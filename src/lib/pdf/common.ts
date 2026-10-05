import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export const INK = rgb(0.086, 0.094, 0.106);
export const INK2 = rgb(0.3, 0.32, 0.34);
export const INK3 = rgb(0.5, 0.52, 0.55);
export const LINE = rgb(0.86, 0.85, 0.83);
export const FILL = rgb(0.965, 0.96, 0.95);
export const ACCENT = rgb(0.122, 0.361, 0.302);

/** Standard PDF fonts only support WinAnsi; map the few characters we use outside it. */
export function safe(s: string): string {
  return s
    .replace(/−/g, "-")
    .replace(/[→]/g, "->")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/•/g, "*")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ–—‘’“”…€]/g, "?");
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

export async function newDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("HR & Payroll Suite");
  doc.setProducer("HR & Payroll Suite");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  return { doc, fonts };
}

export function text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size = 9, color = INK, opts: { align?: "left" | "right" | "center"; maxWidth?: number } = {}) {
  let str = safe(s);
  if (opts.maxWidth) {
    while (str.length > 1 && font.widthOfTextAtSize(str, size) > opts.maxWidth) str = str.slice(0, -2) + "…";
  }
  const w = font.widthOfTextAtSize(str, size);
  const dx = opts.align === "right" ? -w : opts.align === "center" ? -w / 2 : 0;
  page.drawText(str, { x: x + dx, y, size, font, color });
}

export function wrap(s: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(s).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function hline(page: PDFPage, x1: number, x2: number, y: number, color = LINE, thickness = 0.6) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}
