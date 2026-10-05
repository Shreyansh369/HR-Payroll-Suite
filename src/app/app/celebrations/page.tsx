"use client";

import { useState } from "react";
import Link from "next/link";
import { useQ } from "@/client/api";
import { PageHeader, Panel, EmptyState, LoadingRows, Avatar } from "@/components/ui/panel";
import { Segmented, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { formatDate, monthName, monthOf } from "@/lib/dates";

export default function CelebrationsPage() {
  const [days, setDays] = useState<"30" | "90" | "366">("30");
  const [kind, setKind] = useState<"all" | "birthday" | "anniversary">("all");
  const [departmentId, setDept] = useState("");
  const deps = useQ("departments.list", {});
  const q = useQ("people.celebrations", { days: Number(days), kind, departmentId: departmentId || undefined });
  const grouped = (q.data ?? []).reduce<Record<string, typeof q.data>>((acc, c) => {
    const k = c.date.slice(0, 7);
    (acc[k] ??= []).push(c);
    return acc;
  }, {});
  return (
    <>
      <PageHeader
        title="Birthdays & anniversaries"
        description="Upcoming dates for current employees. Ages are visible to HR only."
        actions={
          <>
            <Select value={departmentId} onChange={(e) => setDept(e.target.value)} className="w-44" aria-label="Department">
              <option value="">All departments</option>
              {deps.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: "all", label: "Both" }, { value: "birthday", label: "Birthdays" }, { value: "anniversary", label: "Anniversaries" }]} />
            <Segmented label="Window" value={days} onChange={setDays} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "366", label: "Year" }]} />
          </>
        }
      />
      {!q.data ? <LoadingRows /> : q.data.length === 0 ? (
        <Panel><EmptyState icon="birthday" title="Nothing coming up" description="Try a longer window." /></Panel>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([month, items]) => (
            <Panel key={month}>
              <div className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{monthName(monthOf(`${month}-01`), "long")} {month.slice(0, 4)}</div>
              <ul className="divide-y divide-line">
                {items!.map((c) => (
                  <li key={`${c.employeeId}-${c.kind}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-md ${c.kind === "birthday" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent"}`}>
                      <Icon name={c.kind === "birthday" ? "birthday" : "award"} size="sm" />
                    </span>
                    <Avatar name={c.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/employees/${c.employeeId}`} className="block truncate text-[13px] font-medium hover:underline">{c.name}</Link>
                      <span className="block truncate text-[11.5px] text-ink-3">{c.position} · {c.departmentName}</span>
                    </div>
                    <span className="text-[12.5px] text-ink-2">{c.kind === "birthday" ? (c.years ? `Turns ${c.years}` : "Birthday") : `${c.years} year${c.years === 1 ? "" : "s"} of service`}</span>
                    <Badge tone={c.daysAway === 0 ? "accent" : c.daysAway <= 7 ? "warning" : "neutral"}>{c.daysAway === 0 ? "Today" : c.daysAway === 1 ? "Tomorrow" : formatDate(c.date, { year: false })}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
