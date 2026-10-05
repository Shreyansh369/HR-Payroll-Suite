"use client";

import type { ReactNode } from "react";
import { DropdownMenu, Tabs as RTabs, Tooltip as RTooltip, Popover as RPopover } from "radix-ui";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";

export function Menu({ trigger, children, align = "end", width = "w-56" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" | "center"; width?: string }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={cn("z-50 rounded-lg border border-line bg-surface p-1 shadow-md animate-scale-in", width)}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect, icon, tone, disabled, hint }: { children: ReactNode; onSelect?: () => void; icon?: IconName; tone?: "danger"; disabled?: boolean; hint?: ReactNode }) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-surface-3",
        tone === "danger" && "text-danger",
      )}
    >
      {icon && <Icon name={icon} size="sm" className={tone === "danger" ? "text-danger" : "text-ink-3"} />}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-[11.5px] text-ink-3">{hint}</span>}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-3">{children}</DropdownMenu.Label>;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-line" />;
}

export function Tabs({ value, onValueChange, items, children, className }: { value: string; onValueChange: (v: string) => void; items: { value: string; label: ReactNode; count?: number }[]; children?: ReactNode; className?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} className={className}>
      <RTabs.List className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-line px-1 scrollbar-thin" aria-label="Sections">
        {items.map((it) => (
          <RTabs.Trigger
            key={it.value}
            value={it.value}
            className="relative -mb-px flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-2.5 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
          >
            {it.label}
            {it.count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-ink-2 num">{it.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export const TabPanel = RTabs.Content;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Provider delayDuration={250}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-ink px-2 py-1 text-[12px] leading-snug text-white shadow-md animate-fade-in">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

export function Popover({ trigger, children, align = "start", className }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} sideOffset={6} className={cn("z-50 rounded-lg border border-line bg-surface p-3 shadow-md animate-scale-in", className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
