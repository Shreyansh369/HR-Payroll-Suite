import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

export function Panel({ children, className, padded = false, as: As = "section" }: { children: ReactNode; className?: string; padded?: boolean; as?: "section" | "div" | "article" }) {
  return <As className={cn("rounded-lg border border-line bg-surface shadow-xs", padded && "p-4", className)}>{children}</As>;
}

export function PanelHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[12px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  meta?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1 text-[12px] text-ink-3">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <Icon name="chevronRight" size="sm" className="text-ink-4" />}
              {b.href ? (
                <Link href={b.href} className="hover:text-ink">
                  {b.label}
                </Link>
              ) : (
                <span>{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight text-ink">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-[13px] text-ink-2">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function EmptyState({ icon = "folder", title, description, action, className, compact }: { icon?: IconName; title: string; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14", className)}>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-3">
        <Icon name={icon} />
      </div>
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-3", className)} aria-hidden />;
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-7" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-danger-line bg-danger-soft text-danger">
        <Icon name="alert" />
      </div>
      <p className="text-[13.5px] font-medium text-ink">This couldn&apos;t be loaded</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-ink-3">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 text-[13px] font-medium text-accent hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

/** Small key/value list used in detail panels and drawers. */
export function DescriptionList({ items, cols = 2, className }: { items: { label: string; value: ReactNode; full?: boolean }[]; cols?: 1 | 2 | 3; className?: string }) {
  const grid = cols === 1 ? "" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", grid, className)}>
      {items.map((it, i) => (
        <div key={i} className={cn("min-w-0", it.full && "sm:col-span-full")}>
          <dt className="text-[11.5px] font-medium uppercase tracking-[0.04em] text-ink-3">{it.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-ink">{it.value === "" || it.value === null || it.value === undefined ? <span className="text-ink-4">—</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ tone = "info", title, children, icon, className, action }: { tone?: "info" | "warning" | "danger" | "success" | "neutral"; title?: ReactNode; children?: ReactNode; icon?: IconName; className?: string; action?: ReactNode }) {
  const styles = {
    info: "border-info-line bg-info-soft text-info",
    warning: "border-warning-line bg-warning-soft text-warning",
    danger: "border-danger-line bg-danger-soft text-danger",
    success: "border-success-line bg-success-soft text-success",
    neutral: "border-line bg-surface-2 text-ink-2",
  }[tone];
  const defaultIcon: IconName = tone === "danger" ? "alert" : tone === "warning" ? "warning" : tone === "success" ? "success" : "info";
  return (
    <div className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-[12.5px]", styles, className)} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={icon ?? defaultIcon} className="mt-px" />
      <div className="min-w-0 flex-1 text-ink-2">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-surface-2 px-1 font-mono text-[10.5px] text-ink-3">{children}</kbd>;
}

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const palette = ["#e7efec", "#ebf1f8", "#f6eee3", "#efeaf3", "#eef0e6", "#f4e9ea"];
  const ink = ["#1f5c4d", "#2b5383", "#8a5a1c", "#5a4a73", "#4f5b2a", "#8a3a42"];
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : size === "lg" ? "h-12 w-12 text-[15px]" : "h-8 w-8 text-[11.5px]";
  return (
    <span className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", dim, className)} style={{ background: palette[hash % palette.length], color: ink[hash % ink.length] }} aria-hidden>
      {initials}
    </span>
  );
}
