"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/client/session";
import { PageHeader, Callout } from "@/components/ui/panel";
import { Tabs, TabPanel } from "@/components/ui/menu";
import { CompanyProfileForm, PayrollSettingsForm } from "@/components/settings/company-settings";
import { UsersSettings } from "@/components/settings/users-settings";
import { LeaveSettings } from "@/components/settings/leave-settings";
import { CompaniesSettings, DemoPanel, SetupChecklist } from "@/components/settings/admin-settings";
import { IS_DEMO } from "@/config/env";

function SettingsInner() {
  const { ctx, can, canAny } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabs = [
    canAny(["company.view", "company.manage"]) && { value: "company", label: "Company" },
    canAny(["company.view", "company.manage"]) && { value: "payroll", label: "Payroll & calendars" },
    canAny(["leave.configure", "leave.view"]) && { value: "leave", label: "Leave policies" },
    canAny(["users.manage", "roles.manage"]) && { value: "users", label: "Users & roles" },
    can("company.manage") && { value: "setup", label: "Go-live" },
    IS_DEMO && { value: "demo", label: "Demo data" },
  ].filter((t): t is { value: string; label: string } => !!t);
  const requested = params.get("tab");
  const tab = tabs.some((t) => t.value === requested) ? requested! : (tabs[0]?.value ?? "company");
  const setTab = (v: string) => router.replace(`${pathname}?tab=${v}`, { scroll: false });
  if (tabs.length === 0) return <Callout tone="neutral">Your role has no settings to manage.</Callout>;
  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${ctx.company.tradingName}. Every change is recorded in the audit log.`} />
      <Tabs value={tab} onValueChange={setTab} items={tabs}>
        <TabPanel value="company" className="space-y-4 pt-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <CompanyProfileForm />
            <CompaniesSettings />
          </div>
        </TabPanel>
        <TabPanel value="payroll" className="pt-4"><PayrollSettingsForm /></TabPanel>
        <TabPanel value="leave" className="pt-4"><LeaveSettings /></TabPanel>
        <TabPanel value="users" className="pt-4"><UsersSettings /></TabPanel>
        <TabPanel value="setup" className="pt-4"><div className="max-w-3xl"><SetupChecklist /></div></TabPanel>
        {IS_DEMO && <TabPanel value="demo" className="pt-4"><div className="max-w-3xl"><DemoPanel /></div></TabPanel>}
      </Tabs>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsInner />
    </Suspense>
  );
}
