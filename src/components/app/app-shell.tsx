"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as RDialog } from "radix-ui";
import { cn } from "@/lib/cn";
import { useSession } from "@/client/session";
import { getTransport } from "@/client/api";
import { NAV, type NavItem } from "@/components/app/nav";
import { Icon } from "@/components/ui/icon";
import { Avatar, Kbd } from "@/components/ui/panel";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { CommandPalette } from "@/components/app/command-palette";
import { APP_NAME, IS_DEMO } from "@/config/env";
import { DEMO_ACCOUNTS } from "@/repositories/demo/seed-accounts";

export function useVisibleNav() {
  const { ctx } = useSession();
  const selfOnly = ctx.permissions.every((p) => p === "self.view" || p === "leave.request");
  return useMemo(
    () =>
      NAV.map((g) => ({
        ...g,
        items: g.items.filter((it) => it.any.some((p) => ctx.permissions.includes(p)) && (!it.needsEmployee || !!ctx.employeeId) && (!it.notSelfOnly || !selfOnly)),
      })).filter((g) => g.items.length > 0),
    [ctx.permissions, ctx.employeeId, selfOnly],
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function CompanySwitcher({ onSwitched }: { onSwitched?: () => void }) {
  const { ctx, switchCompany } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const c = ctx.company;
  const trigger = (
    <button
      type="button"
      disabled={busy}
      className="flex w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2 py-1.5 text-left shadow-xs transition-colors hover:border-line-strong disabled:opacity-60"
      aria-label={`Company: ${c.legalName}. Switch company`}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white" style={{ background: c.accentColor }}>
        {c.shortName}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{c.tradingName}</span>
        <span className="block truncate text-[11.5px] text-ink-3">{ctx.role.name}</span>
      </span>
      {ctx.companies.length > 1 && <Icon name="chevronDown" size="sm" className="text-ink-3" />}
    </button>
  );
  if (ctx.companies.length <= 1) return trigger;
  return (
    <Menu trigger={trigger} align="start" width="w-[248px]">
      <MenuLabel>Switch company</MenuLabel>
      {ctx.companies.map((co) => (
        <MenuItem
          key={co.id}
          onSelect={async () => {
            if (co.id === c.id) return;
            setBusy(true);
            try {
              await switchCompany(co.id);
              toast.success(`Switched to ${co.tradingName}`);
              router.push("/app");
              onSwitched?.();
            } catch (e) {
              toast.error("Could not switch company", (e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[9px] font-semibold text-white" style={{ background: co.accentColor }}>
              {co.shortName}
            </span>
            <span className="truncate">{co.tradingName}</span>
            {co.id === c.id && <Icon name="check" size="sm" className="ml-auto text-accent" />}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const groups = useVisibleNav();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 pb-4 scrollbar-thin">
      {groups.map((g, gi) => (
        <div key={gi} className="mt-4 first:mt-2">
          {g.label && <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-4">{g.label}</p>}
          <ul className="space-y-px">
            {g.items.map((it: NavItem) => {
              const active = isActive(pathname, it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors max-lg:h-10",
                      active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                    )}
                  >
                    <Icon name={it.icon} className={active ? "text-accent" : "text-ink-3"} />
                    {it.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const { ctx, logout } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  return (
    <>
      <Menu
        align="start"
        width="w-64"
        trigger={
          <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-3" aria-label="Account menu">
            <Avatar name={ctx.user.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink">{ctx.user.name}</span>
              <span className="block truncate text-[11.5px] text-ink-3">{ctx.user.email}</span>
            </span>
            <Icon name="more" size="sm" className="text-ink-3" />
          </button>
        }
      >
        <MenuLabel>{ctx.role.name}</MenuLabel>
        {ctx.employeeId && (
          <MenuItem icon="user" onSelect={() => router.push("/app/me")}>
            My profile
          </MenuItem>
        )}
        {IS_DEMO && (
          <>
            <MenuSeparator />
            <MenuLabel>Switch demo account</MenuLabel>
            {DEMO_ACCOUNTS.map((a) => (
              <MenuItem
                key={a.email}
                icon="userSwitch"
                hint={a.email === ctx.user.email ? "current" : undefined}
                onSelect={async () => {
                  const t = await getTransport();
                  const demo = t as unknown as { switchUser: (email: string) => Promise<void> };
                  await demo.switchUser(a.email);
                  // Full reload: the session, permissions and query cache all change with the user.
                  window.location.assign(a.role === "Employee" ? "/app/me" : "/app");
                }}
              >
                {a.role}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem icon="refresh" onSelect={() => setConfirmReset(true)}>
              Reset demo data
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem icon="logout" onSelect={() => void logout()}>
          Sign out
        </MenuItem>
      </Menu>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset demo data?"
        description="Every change you made in this browser — employees, leave, payroll runs, documents — is replaced with the original fictional dataset."
        confirmLabel="Reset demo"
        tone="danger"
        loading={resetting}
        onConfirm={async () => {
          setResetting(true);
          try {
            const t = await getTransport();
            await (t as unknown as { reset: () => Promise<void> }).reset();
            toast.success("Demo data restored");
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign("/app");
          } catch (e) {
            toast.error("Reset failed", (e as Error).message);
            setResetting(false);
          }
        }}
      />
    </>
  );
}

function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[10px] font-bold tracking-tight text-white">HP</span>
        <span className="text-[13.5px] font-semibold tracking-tight text-ink">{APP_NAME}</span>
      </div>
      <div className="px-2.5">
        <CompanySwitcher onSwitched={onNavigate} />
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <div className="border-t border-line p-2">
        <UserMenu />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { ctx } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
        Skip to content
      </a>
      <aside className="hidden border-r border-line bg-canvas lg:sticky lg:top-0 lg:block lg:h-dvh">
        <SidebarContents />
      </aside>

      <RDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-ink/25 animate-fade-in lg:hidden" />
          <RDialog.Content className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-line bg-canvas shadow-lg focus:outline-none lg:hidden">
            <RDialog.Title className="sr-only">Navigation</RDialog.Title>
            <RDialog.Description className="sr-only">Main navigation</RDialog.Description>
            <SidebarContents onNavigate={() => setMobileOpen(false)} />
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-canvas/90 px-3 backdrop-blur-sm sm:px-5 no-print">
          <button type="button" onClick={() => setMobileOpen(true)} className="flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-3 lg:hidden" aria-label="Open navigation">
            <Icon name="menu" size="lg" />
          </button>
          <span className="truncate text-[13px] font-semibold text-ink lg:hidden">{ctx.company.tradingName}</span>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-3 shadow-xs transition-colors hover:border-line-strong max-sm:w-9 max-sm:justify-center max-sm:px-0 sm:w-64 lg:ml-0"
            aria-label="Search and jump"
          >
            <Icon name="search" size="sm" />
            <span className="max-sm:hidden">Search people and pages…</span>
            <span className="ml-auto flex gap-0.5 max-sm:hidden">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <div className="flex items-center gap-2 lg:ml-auto">
            {IS_DEMO && (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-warning-line bg-warning-soft px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-warning" title="All people, companies and figures are fictional">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                Demo data
              </span>
            )}
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-3 py-5 sm:px-6 sm:py-6 2xl:max-w-[1760px]">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
