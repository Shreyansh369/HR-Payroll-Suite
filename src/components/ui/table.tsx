"use client";

import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { formatMoney } from "@/lib/money";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Return a primitive to enable sorting on this column. */
  sortValue?: (row: T) => string | number | null;
  /** Hide on viewports narrower than this breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  className?: string;
  headerClassName?: string;
  width?: string;
}

const hide = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden", xl: "max-xl:hidden" };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  footer,
  initialSort,
  dense,
  stickyFirst = true,
  rowClassName,
  caption,
  maxHeight,
  selection,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  footer?: ReactNode;
  initialSort?: { key: string; dir: "asc" | "desc" };
  dense?: boolean;
  stickyFirst?: boolean;
  rowClassName?: (row: T) => string | undefined;
  caption?: string;
  maxHeight?: string;
  selection?: { selected: Set<string>; onChange: (s: Set<string>) => void; isSelectable?: (row: T) => boolean };
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const v = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true });
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, sort, columns]);

  const pad = dense ? "px-3 py-1.5" : "px-3 py-2";
  const selectable = selection ? sorted.filter((r) => selection.isSelectable?.(r) ?? true) : [];
  const allSelected = selection && selectable.length > 0 && selectable.every((r) => selection.selected.has(rowKey(r)));

  return (
    <div className={cn("relative overflow-auto scrollbar-thin", maxHeight)} style={maxHeight ? undefined : undefined}>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10">
          <tr>
            {selection && (
              <th className="w-8 border-b border-line bg-surface-2 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={!!allSelected}
                  onChange={(e) => selection.onChange(new Set(e.target.checked ? selectable.map(rowKey) : []))}
                  className="h-4 w-4 accent-accent"
                />
              </th>
            )}
            {columns.map((c, i) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "whitespace-nowrap border-b border-line bg-surface-2 text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3",
                    pad,
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.hideBelow && hide[c.hideBelow],
                    stickyFirst && i === 0 && !selection && "sticky left-0 z-20",
                    c.headerClassName,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "right" ? "desc" : "asc" })}
                      className={cn("inline-flex items-center gap-1 uppercase hover:text-ink", active && "text-ink")}
                    >
                      {c.header}
                      {active ? <Icon name={sort!.dir === "asc" ? "sortUp" : "sortDown"} size="sm" /> : null}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selection ? 1 : 0)} className="p-0">
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const k = rowKey(row);
              const isSel = selection?.selected.has(k);
              return (
                <tr
                  key={k}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn("group", onRowClick && "cursor-pointer", isSel && "bg-accent-soft/40", rowClassName?.(row))}
                >
                  {selection && (
                    <td className="border-b border-line px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {(selection.isSelectable?.(row) ?? true) && (
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          checked={!!isSel}
                          onChange={(e) => {
                            const s = new Set(selection.selected);
                            if (e.target.checked) s.add(k);
                            else s.delete(k);
                            selection.onChange(s);
                          }}
                          className="h-4 w-4 accent-accent"
                        />
                      )}
                    </td>
                  )}
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cn(
                        "border-b border-line bg-surface align-middle transition-colors group-hover:bg-surface-2",
                        pad,
                        c.align === "right" ? "text-right num" : c.align === "center" ? "text-center" : "text-left",
                        c.hideBelow && hide[c.hideBelow],
                        stickyFirst && i === 0 && !selection && "sticky left-0 z-[1]",
                        isSel && "bg-accent-soft/40",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
        {footer && <tfoot className="sticky bottom-0 bg-surface-2">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function TotalsRow({ cells }: { cells: { content: ReactNode; align?: "left" | "right"; colSpan?: number; hideBelow?: Column<unknown>["hideBelow"] }[] }) {
  return (
    <tr>
      {cells.map((c, i) => (
        <td
          key={i}
          colSpan={c.colSpan}
          className={cn("whitespace-nowrap border-t border-line-strong bg-surface-2 px-3 py-2 text-[13px] font-semibold text-ink", c.align === "right" && "text-right num", c.hideBelow && hide[c.hideBelow], i === 0 && "sticky left-0")}
        >
          {c.content}
        </td>
      ))}
    </tr>
  );
}

export function Money({ value, currency = "USD", className, signed, muted0 = true }: { value: number | null | undefined; currency?: string; className?: string; signed?: boolean; muted0?: boolean }) {
  if (value === null || value === undefined) return <span className="text-ink-4">—</span>;
  return <span className={cn("num whitespace-nowrap", value < 0 && "text-danger", muted0 && value === 0 && "text-ink-4", className)}>{formatMoney(value, currency, { signed })}</span>;
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-[12.5px] text-ink-3">
      <span className="num">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 hover:bg-surface-3 disabled:opacity-40" aria-label="Previous page">
          <Icon name="chevronLeft" size="sm" /> Prev
        </button>
        <span className="num px-1">
          {page} / {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="inline-flex h-7 items-center gap-1 rounded-md px-2 hover:bg-surface-3 disabled:opacity-40" aria-label="Next page">
          Next <Icon name="chevronRight" size="sm" />
        </button>
      </div>
    </div>
  );
}
