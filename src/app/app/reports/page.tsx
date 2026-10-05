"use client";

import Link from "next/link";
import { useQ } from "@/client/api";
import { PageHeader, Panel, PanelHeader, LoadingRows } from "@/components/ui/panel";
import { Icon } from "@/components/ui/icon";

const GROUPS = [
  { key: "payroll", title: "Payroll", description: "Registers, summaries and history from calculated and finalized payroll." },
  { key: "statutory", title: "Statutory", description: "Contribution schedules per employee for filing and reconciliation." },
  { key: "hr", title: "People", description: "Headcount, employee records, history and leave." },
] as const;

export default function ReportsPage() {
  const q = useQ("reports.catalog", {});
  return (
    <>
      <PageHeader title="Reports" description="Every report exports to PDF, Excel and CSV. Exports are recorded in the audit log." />
      {!q.data ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {GROUPS.map((g) => {
            const items = q.data!.filter((r) => r.category === g.key);
            if (!items.length) return null;
            return (
              <Panel key={g.key}>
                <PanelHeader title={g.title} description={g.description} />
                <ul className="divide-y divide-line">
                  {items.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/reports/${r.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2">
                        <Icon name="chart" size="sm" className="mt-0.5 text-ink-3" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{r.title}</span>
                          <span className="block text-[12px] text-ink-3">{r.description}</span>
                        </span>
                        <Icon name="chevronRight" size="sm" className="mt-1 text-ink-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
