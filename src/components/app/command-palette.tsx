"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog as RDialog } from "radix-ui";
import { cn } from "@/lib/cn";
import { useSession } from "@/client/session";
import { useQ } from "@/client/api";
import { useVisibleNav } from "@/components/app/app-shell";
import { Icon, type IconName } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/panel";

interface Entry {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  href: string;
  group: string;
  keywords?: string;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { can } = useSession();
  const groups = useVisibleNav();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const people = useQ("employees.options", { includeInactive: true }, { enabled: open && can("employee.view") });

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = groups.flatMap((g) => g.items.map((it) => ({ id: it.href, label: it.label, icon: it.icon, href: it.href, group: "Pages", keywords: it.keywords })));
    const actions: Entry[] = [];
    if (can("employee.create")) actions.push({ id: "new-employee", label: "Add employee", icon: "userAdd", href: "/app/employees/new", group: "Actions", keywords: "create hire new" });
    if (can("payroll.create")) actions.push({ id: "new-run", label: "Start a payroll run", icon: "wallet", href: "/app/payroll?new=1", group: "Actions", keywords: "run payroll create" });
    if (can("leave.request") || can("leave.approve")) actions.push({ id: "leave", label: "Record leave", icon: "calendar", href: "/app/leave?new=1", group: "Actions", keywords: "request time off" });
    if (can("imports.run")) actions.push({ id: "import", label: "Import a spreadsheet", icon: "import", href: "/app/import", group: "Actions", keywords: "csv xlsx" });
    const peeps: Entry[] = (people.data ?? []).map((p) => ({ id: p.id, label: p.name, hint: `${p.employeeCode} · ${p.position}`, icon: "user", href: `/app/employees/${p.id}`, group: "People", keywords: `${p.employeeCode} ${p.position}` }));
    return [...actions, ...pages, ...peeps];
  }, [groups, people.data, can]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return entries.filter((e) => e.group !== "People").slice(0, 30);
    const terms = t.split(/\s+/);
    return entries.filter((e) => terms.every((term) => `${e.label} ${e.hint ?? ""} ${e.keywords ?? ""}`.toLowerCase().includes(term))).slice(0, 40);
  }, [entries, q]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset highlighted row when results change
    setIndex(0);
  }, [q, open]);

  const go = (e: Entry) => {
    onOpenChange(false);
    setQ("");
    router.push(e.href);
  };

  const grouped = filtered.reduce<Record<string, Entry[]>>((acc, e) => {
    (acc[e.group] ??= []).push(e);
    return acc;
  }, {});
  let i = -1;

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/25 animate-fade-in" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-24px)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg animate-scale-in focus:outline-none">
          <RDialog.Title className="sr-only">Search</RDialog.Title>
          <RDialog.Description className="sr-only">Jump to a page, person or action</RDialog.Description>
          <div className="flex items-center gap-2 border-b border-line px-3.5">
            <Icon name="search" className="text-ink-3" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((x) => Math.min(filtered.length - 1, x + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((x) => Math.max(0, x - 1));
                } else if (e.key === "Enter" && filtered[index]) {
                  e.preventDefault();
                  go(filtered[index]);
                }
              }}
              placeholder="Search people, pages and actions"
              className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-4"
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={filtered[index] ? `pal-${filtered[index].id}` : undefined}
            />
            <Kbd>esc</Kbd>
          </div>
          <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[56vh] overflow-y-auto p-1.5 scrollbar-thin">
            {filtered.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-ink-3">No matches for “{q}”.</li>}
            {Object.entries(grouped).map(([group, items]) => (
              <li key={group} role="presentation">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-4">{group}</p>
                <ul role="presentation">
                  {items.map((e) => {
                    i += 1;
                    const active = i === index;
                    const myIndex = i;
                    return (
                      <li
                        key={e.id}
                        id={`pal-${e.id}`}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setIndex(myIndex)}
                        onClick={() => go(e)}
                        className={cn("flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]", active ? "bg-surface-3 text-ink" : "text-ink-2")}
                      >
                        <Icon name={e.icon} size="sm" className="text-ink-3" />
                        <span className="truncate font-medium text-ink">{e.label}</span>
                        {e.hint && <span className="truncate text-[12px] text-ink-3">{e.hint}</span>}
                        {active && <Icon name="chevronRight" size="sm" className="ml-auto text-ink-4" />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
