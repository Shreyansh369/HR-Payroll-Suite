"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQ } from "@/client/api";
import { useSession } from "@/client/session";
import { PageHeader, Panel, PanelHeader, EmptyState, LoadingRows, ErrorState, Avatar } from "@/components/ui/panel";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Money } from "@/components/ui/table";
import { BarList, PayrollTrendChart, ProgressBar } from "@/components/app/charts";
import { formatDate, formatRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

function AttentionItem({ href, icon, tone, title, detail }: { href: string; icon: IconName; tone: "warning" | "danger" | "info" | "neutral"; title: string; detail?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
        <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", tone === "danger" && "bg-danger-soft text-danger", tone === "warning" && "bg-warning-soft text-warning", tone === "info" && "bg-info-soft text-info", tone === "neutral" && "bg-surface-3 text-ink-2")}>
          <Icon name={icon} size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{title}</span>
          {detail && <span className="block truncate text-[12px] text-ink-3">{detail}</span>}
        </span>
        <Icon name="chevronRight" size="sm" className="mt-1 text-ink-4" />
      </Link>
    </li>
  );
}

export default function DashboardPage() {
  const { ctx, can } = useSession();
  const router = useRouter();
  const selfOnly = ctx.permissions.every((p) => p === "self.view" || p === "leave.request");
  useEffect(() => {
    if (selfOnly) router.replace("/app/me");
  }, [selfOnly, router]);
  const q = useQ("dashboard.summary", {}, { enabled: !selfOnly });
  if (selfOnly) return null;
  if (q.isLoading) return <LoadingRows rows={10} />;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const cur = d.currency;
  const p = d.payroll;

  const attention: { href: string; icon: IconName; tone: "warning" | "danger" | "info" | "neutral"; title: string; detail?: string }[] = [];
  for (const r of p?.open ?? []) {
    if (r.status === "review") attention.push({ href: `/app/payroll/${r.id}`, icon: "wallet", tone: r.preflight.errors ? "danger" : "warning", title: `${r.name} needs review`, detail: `${r.preflight.errors} errors · ${r.preflight.unacknowledged} warnings to acknowledge` });
    else if (r.status === "approved") attention.push({ href: `/app/payroll/${r.id}`, icon: "wallet", tone: "info", title: `${r.name} is approved`, detail: "Ready to finalize" });
    else attention.push({ href: `/app/payroll/${r.id}`, icon: "wallet", tone: "neutral", title: `${r.name} is ${r.status}`, detail: r.stale ? "Inputs changed — recalculate" : `Pay date ${formatDate(r.payDate)}` });
  }
  if (d.approvals.leave) attention.push({ href: "/app/leave", icon: "calendar", tone: "warning", title: `${d.approvals.leave} leave request${d.approvals.leave === 1 ? "" : "s"} awaiting approval`, detail: d.approvals.leaveItems.map((l) => l.employeeName).slice(0, 3).join(", ") });
  if (d.approvals.timesheets) attention.push({ href: "/app/attendance?status=submitted", icon: "clock", tone: "warning", title: `${d.approvals.timesheets} timesheet day${d.approvals.timesheets === 1 ? "" : "s"} to approve` });
  if (d.approvals.corrections) attention.push({ href: "/app/attendance?tab=corrections", icon: "edit", tone: "info", title: `${d.approvals.corrections} attendance correction${d.approvals.corrections === 1 ? "" : "s"} pending` });
  const expired = d.expiringDocuments.filter((x) => x.expired);
  const expiring = d.expiringDocuments.filter((x) => !x.expired);
  if (expired.length) attention.push({ href: "/app/documents?expiring=0", icon: "alert", tone: "danger", title: `${expired.length} document${expired.length === 1 ? " has" : "s have"} expired`, detail: expired.map((x) => `${x.title} — ${x.employeeName}`).join("; ") });
  if (expiring.length) attention.push({ href: "/app/documents?expiring=30", icon: "file", tone: "warning", title: `${expiring.length} document${expiring.length === 1 ? " expires" : "s expire"} within 30 days`, detail: expiring.map((x) => `${x.title} — ${x.employeeName}`).slice(0, 2).join("; ") });

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${ctx.user.name.split(" ")[0]}`}
        description={`${ctx.company.legalName} · ${formatDate(d.today)}`}
        actions={
          <>
            {can("employee.create") && <ButtonLink href="/app/employees/new" icon="userAdd">Add employee</ButtonLink>}
            {can("payroll.create") && <ButtonLink href="/app/payroll?new=1" variant="primary" icon="wallet">Run payroll</ButtonLink>}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {p ? (
          <Panel>
            <PanelHeader title="Payroll" description={p.due ? `Next ${p.due.frequency.replace("_", "-")} period ${formatRange(p.due.start, p.due.end)}` : undefined} actions={<ButtonLink href="/app/payroll" size="sm" variant="ghost" iconRight="chevronRight">All runs</ButtonLink>} />
            <div className="grid gap-px bg-line sm:grid-cols-3">
              <div className="bg-surface p-4">
                <p className="text-[12px] text-ink-3">Next pay date</p>
                {p.due ? (
                  <>
                    <p className="mt-1 text-[22px] font-semibold tracking-tight">{formatDate(p.due.payDate)}</p>
                    <p className={cn("mt-0.5 text-[12px]", p.due.daysUntilPay < 5 ? "text-warning" : "text-ink-3")}>
                      {p.due.daysUntilPay >= 0 ? `in ${p.due.daysUntilPay} day${p.due.daysUntilPay === 1 ? "" : "s"}` : `${-p.due.daysUntilPay} days ago`} · {p.due.exists ? "run created" : "not started"}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[13px] text-ink-3">No active pay calendar</p>
                )}
              </div>
              <div className="bg-surface p-4">
                <p className="text-[12px] text-ink-3">Last payroll · net pay</p>
                <p className="mt-1 text-[22px] font-semibold tracking-tight num">{p.last?.totals ? formatMoney(p.last.totals.net, cur) : "—"}</p>
                <p className="mt-0.5 truncate text-[12px] text-ink-3">{p.last ? `${p.last.totals?.employees ?? 0} employees · gross ${formatMoney(p.last.totals?.gross ?? 0, cur)}` : "No finalized payroll yet"}</p>
              </div>
              <div className="bg-surface p-4">
                <p className="text-[12px] text-ink-3">Statutory liabilities · last payroll</p>
                <p className="mt-1 text-[22px] font-semibold tracking-tight num">{p.liabilities ? formatMoney(p.liabilities.total, cur) : "—"}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">{p.liabilities ? `${formatMoney(p.liabilities.employee, cur)} employee · ${formatMoney(p.liabilities.employer, cur)} employer` : "—"}</p>
              </div>
            </div>
            <div className="border-t border-line px-4 pb-4 pt-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12.5px] font-medium text-ink">Regular payrolls, last {p.trend.length}</p>
                <p className="text-[12px] text-ink-3 num">
                  Year to date: gross {formatMoney(p.ytd.gross, cur)} · employer cost {formatMoney(p.ytd.employerCost, cur)}
                </p>
              </div>
              {p.trend.length ? <PayrollTrendChart data={p.trend} currency={cur} /> : <EmptyState compact icon="chart" title="No finalized payrolls yet" description="Trends appear after your first payroll is finalized." />}
            </div>
          </Panel>
        ) : (
          d.headcount && (
            <Panel>
              <PanelHeader title="People" actions={<ButtonLink href="/app/employees" size="sm" variant="ghost" iconRight="chevronRight">Directory</ButtonLink>} />
              <div className="grid gap-px bg-line sm:grid-cols-3">
                <Kpi label="Headcount" value={String(d.headcount.total)} sub={`${d.headcount.onboarding} onboarding · ${d.headcount.onLeave} on leave`} />
                <Kpi label="Joined in last 90 days" value={String(d.headcount.joinedLast90)} />
                <Kpi label="Leaving in next 90 days" value={String(d.headcount.leavingNext90)} />
              </div>
              <div className="border-t border-line p-4">
                <BarList items={d.headcount.byDepartment.map((x) => ({ label: x.name, value: x.count }))} />
              </div>
            </Panel>
          )
        )}

        <Panel>
          <PanelHeader title="Needs attention" description={attention.length ? undefined : "Nothing waiting on you"} />
          {attention.length ? (
            <ul className="divide-y divide-line">{attention.map((a, i) => <AttentionItem key={i} {...a} />)}</ul>
          ) : (
            <EmptyState compact icon="success" title="All clear" description="No approvals, expiring documents or payroll actions are waiting." />
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {d.headcount && p && (
          <Panel>
            <PanelHeader title="Headcount" description={`${d.headcount.total} people · ${d.headcount.onboarding} onboarding · ${d.headcount.onLeave} on leave`} />
            <div className="p-4">
              <BarList items={d.headcount.byDepartment.map((x) => ({ label: x.name, value: x.count }))} />
              <p className="mt-3 text-[12px] text-ink-3">
                {d.headcount.joinedLast90} joined in the last 90 days · {d.headcount.leavingNext90} leaving in the next 90 days
              </p>
            </div>
          </Panel>
        )}
        {d.headcount && (
          <Panel>
            <PanelHeader title="Birthdays & anniversaries" description="Next 14 days" actions={<ButtonLink href="/app/celebrations" size="sm" variant="ghost" iconRight="chevronRight">All</ButtonLink>} />
            {d.celebrations.length ? (
              <ul className="divide-y divide-line">
                {d.celebrations.slice(0, 6).map((c) => (
                  <li key={`${c.employeeId}-${c.kind}`} className="flex items-center gap-3 px-4 py-2">
                    <Avatar name={c.name} size="sm" />
                    <Link href={`/app/employees/${c.employeeId}`} className="min-w-0 flex-1 truncate text-[13px] font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-[12px] text-ink-3">{c.kind === "birthday" ? "Birthday" : `${c.years} yr${c.years === 1 ? "" : "s"}`}</span>
                    <Badge tone={c.daysAway === 0 ? "accent" : "neutral"}>{c.daysAway === 0 ? "Today" : formatDate(c.date, { year: false })}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon="birthday" title="None in the next two weeks" />
            )}
          </Panel>
        )}
        {d.onboarding.length > 0 && (
          <Panel>
            <PanelHeader title="Onboarding & offboarding" actions={<ButtonLink href="/app/onboarding" size="sm" variant="ghost" iconRight="chevronRight">Open</ButtonLink>} />
            <ul className="divide-y divide-line">
              {d.onboarding.map((w) => (
                <li key={w.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate font-medium">{w.employeeName}</span>
                    <Badge tone={w.type === "onboarding" ? "info" : "neutral"}>{w.type === "onboarding" ? "Onboarding" : "Offboarding"}</Badge>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <ProgressBar value={w.done} total={w.total} />
                    <span className="text-[11.5px] text-ink-3 num">
                      {w.done}/{w.total}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {d.activity.length > 0 && (
          <Panel className={cn(d.onboarding.length === 0 && "lg:col-span-1")}>
            <PanelHeader title="Recent activity" actions={<ButtonLink href="/app/audit" size="sm" variant="ghost" iconRight="chevronRight">Audit log</ButtonLink>} />
            <ul className="divide-y divide-line">
              {d.activity.map((a) => (
                <li key={a.id} className="px-4 py-2">
                  <p className="truncate text-[12.5px] text-ink">{a.summary}</p>
                  <p className="text-[11.5px] text-ink-3">
                    {a.actorName} · {timeAgo(a.at)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      {p && p.open.length > 0 && (
        <Panel className="mt-4">
          <PanelHeader title="Open payroll runs" />
          <ul className="divide-y divide-line">
            {p.open.map((r) => (
              <li key={r.id}>
                <Link href={`/app/payroll/${r.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.name}</span>
                  <StatusBadge status={r.status} />
                  <span className="text-[12px] text-ink-3">Pay {formatDate(r.payDate)}</span>
                  <Money value={r.totals?.net ?? null} currency={cur} className="w-28 text-right text-[13px] font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface p-4">
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-tight num">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(iso.slice(0, 10));
}
