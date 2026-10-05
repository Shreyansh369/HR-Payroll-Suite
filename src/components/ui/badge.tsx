import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-accent-line",
  success: "bg-success-soft text-success border-success-line",
  warning: "bg-warning-soft text-warning border-warning-line",
  danger: "bg-danger-soft text-danger border-danger-line",
  info: "bg-info-soft text-info border-info-line",
};

const dots: Record<Tone, string> = {
  neutral: "bg-ink-4",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ tone = "neutral", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[11.5px] font-medium leading-none", tones[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dots[tone])} aria-hidden />}
      {children}
    </span>
  );
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  // employees
  active: { tone: "success", label: "Active" },
  onboarding: { tone: "info", label: "Onboarding" },
  on_leave: { tone: "warning", label: "On leave" },
  terminated: { tone: "neutral", label: "Terminated" },
  archived: { tone: "neutral", label: "Archived" },
  // approvals
  pending: { tone: "warning", label: "Pending" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  submitted: { tone: "warning", label: "Submitted" },
  // payroll
  draft: { tone: "neutral", label: "Draft" },
  calculated: { tone: "info", label: "Calculated" },
  review: { tone: "warning", label: "In review" },
  finalized: { tone: "accent", label: "Finalized" },
  locked: { tone: "neutral", label: "Locked" },
  // statutory
  demo: { tone: "warning", label: "Illustrative" },
  retired: { tone: "neutral", label: "Retired" },
  // workflows
  in_progress: { tone: "info", label: "In progress" },
  completed: { tone: "success", label: "Completed" },
  // loans
  paid: { tone: "success", label: "Paid off" },
  // billing
  trialing: { tone: "info", label: "Trial" },
  past_due: { tone: "danger", label: "Past due" },
  canceled: { tone: "neutral", label: "Canceled" },
  owned: { tone: "accent", label: "Owned" },
  inactive: { tone: "neutral", label: "Inactive" },
  completed_with_errors: { tone: "warning", label: "Completed with errors" },
  failed: { tone: "danger", label: "Failed" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status.replace(/_/g, " ") };
  return (
    <Badge tone={s.tone} dot className={className}>
      {s.label}
    </Badge>
  );
}
