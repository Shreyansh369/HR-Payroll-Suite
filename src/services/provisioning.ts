/**
 * Creates a company with its default, data-driven configuration. Shared by the
 * demo seed, the "New company" action and the production setup wizard.
 */
import type { Company, ID, LeavePolicy, LeaveType, Role, StatutoryRule } from "@/domain/types";
import type { Repository } from "@/repositories/interfaces";
import type { IdGenerator } from "@/lib/ids";
import { SYSTEM_ROLES } from "@/domain/auth/permissions";
import {
  DEFAULT_ACCOUNT_MAPPINGS,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_PAYROLL_SETTINGS,
  illustrativeStatutoryRules,
} from "@/config/defaults";

export interface CompanyProfileInput {
  legalName: string;
  tradingName?: string;
  registrationNumber?: string;
  address?: Company["address"];
  contactEmail?: string;
  contactPhone?: string;
  currency?: string;
  timezone?: string;
  fiscalYearStartMonth?: number;
  shortName?: string;
  accentColor?: string;
  employerIds?: Company["employerIds"];
  payFrequency?: Company["payCalendars"][number]["frequency"];
}

export async function provisionCompany(
  repo: Repository,
  ids: IdGenerator,
  nowIso: string,
  organizationId: ID,
  profile: CompanyProfileInput,
  opts: { statutoryStatus: "demo" | "draft"; calendarAnchor: string },
): Promise<{ company: Company; leaveTypes: LeaveType[]; policy: LeavePolicy; rules: StatutoryRule[] }> {
  const ts = { createdAt: nowIso, updatedAt: nowIso };
  const companyId = ids("co");
  const frequency = profile.payFrequency ?? "monthly";
  const company: Company = {
    id: companyId,
    organizationId,
    legalName: profile.legalName,
    tradingName: profile.tradingName || profile.legalName,
    registrationNumber: profile.registrationNumber ?? "",
    address: profile.address ?? { line1: "", city: "Road Town", region: "Tortola", country: "British Virgin Islands" },
    contactEmail: profile.contactEmail ?? "",
    contactPhone: profile.contactPhone ?? "",
    employerIds: profile.employerIds ?? { socialSecurity: "", nhi: "", payrollTax: "" },
    currency: profile.currency ?? "USD",
    timezone: profile.timezone ?? "America/Tortola",
    fiscalYearStartMonth: profile.fiscalYearStartMonth ?? 1,
    status: "active",
    branding: {
      accentColor: profile.accentColor ?? "#1f5c4d",
      shortName: profile.shortName ?? profile.legalName.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
    },
    payrollSettings: { ...DEFAULT_PAYROLL_SETTINGS },
    payCalendars: [
      { frequency, anchorDate: opts.calendarAnchor, payDateOffsetDays: frequency === "monthly" ? -1 : 3, active: true },
    ],
    holidays: [],
    accountMappings: DEFAULT_ACCOUNT_MAPPINGS.map((m) => ({ ...m })),
    setup: { completedSteps: ["company"] },
    ...ts,
  };
  await repo.companies.insert(company);

  const leaveTypes: LeaveType[] = DEFAULT_LEAVE_TYPES.map((t) => ({
    id: ids("lvt"),
    companyId,
    code: t.code,
    name: t.name,
    category: t.category,
    paid: t.paid,
    unit: t.unit,
    tracksBalance: t.tracksBalance,
    requiresApproval: true,
    color: t.color,
    active: true,
    ...ts,
  }));
  await repo.leaveTypes.insertMany(leaveTypes);

  const policy: LeavePolicy = {
    id: ids("lvp"),
    companyId,
    name: "Standard leave policy",
    isDefault: true,
    rules: DEFAULT_LEAVE_TYPES.filter((t) => t.tracksBalance).map((t) => ({
      leaveTypeId: leaveTypes.find((lt) => lt.code === t.code)!.id,
      annualEntitlement: t.entitlement,
      accrual: t.accrual,
      carryForwardMax: t.carryForwardMax,
      carryForwardExpiryMonths: t.carryForwardExpiryMonths,
    })),
    ...ts,
  };
  await repo.leavePolicies.insert(policy);

  const rules: StatutoryRule[] = illustrativeStatutoryRules().map((r) => ({
    ...r,
    id: ids("rule"),
    companyId,
    status: r.status === "draft" ? "draft" : opts.statutoryStatus,
    ...ts,
  }));
  await repo.statutoryRules.insertMany(rules);

  return { company, leaveTypes, policy, rules };
}

/** Seed the seven system roles for an organisation. */
export async function provisionRoles(repo: Repository, ids: IdGenerator, nowIso: string, organizationId: ID): Promise<Role[]> {
  const roles: Role[] = SYSTEM_ROLES.map((r) => ({
    id: ids("role"),
    organizationId,
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: [...r.permissions],
    system: true,
    defaultScope: r.defaultScope,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  for (const role of roles) await repo.roles.insert(role);
  return roles;
}
