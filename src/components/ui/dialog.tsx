"use client";

import { useState, type ReactNode } from "react";
import { Dialog as RDialog } from "radix-ui";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/30 animate-fade-in" />
        <RDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[min(88vh,900px)] w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-lg animate-scale-in focus:outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RDialog.Title className="text-[15px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-0.5 text-[12.5px] text-ink-3">{description}</RDialog.Description> : <RDialog.Description className="sr-only">Dialog</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton icon="close" label="Close" size="sm" className="-mr-1.5 -mt-0.5" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3 rounded-b-xl">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Right-hand sheet on desktop, bottom sheet on mobile. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg" | "xl";
}) {
  const w = { md: "sm:max-w-md", lg: "sm:max-w-xl", xl: "sm:max-w-3xl" }[width];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/25 animate-fade-in" />
        <RDialog.Content
          className={cn(
            "fixed z-50 flex flex-col border-line bg-surface shadow-lg focus:outline-none",
            "inset-x-0 bottom-0 max-h-[92vh] rounded-t-xl border-t animate-slide-up",
            "sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:rounded-none sm:border-l sm:border-t-0 sm:animate-slide-in-right",
            w,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RDialog.Title className="text-[15px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-0.5 text-[12.5px] text-ink-3">{description}</RDialog.Description> : <RDialog.Description className="sr-only">Details</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <IconButton icon="close" label="Close" size="sm" className="-mr-1.5 -mt-0.5" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Confirmation dialog for destructive or significant actions; optionally requires a reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  requireReason,
  reasonLabel = "Reason",
  onConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => void;
  loading?: boolean;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={loading} disabled={requireReason && !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <div className="text-[13px] text-ink-2">{description}</div>}
      {children}
      {requireReason && (
        <Field label={reasonLabel} required className="mt-4">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus placeholder="Recorded in the audit log" />
        </Field>
      )}
    </Dialog>
  );
}
