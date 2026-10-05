/**
 * PostgreSQL schema (production mode).
 *
 * Every business record is stored as a complete JSON document (`doc`) plus a set
 * of promoted, typed columns that carry indexes, foreign keys, uniqueness and
 * check constraints. Promoted columns are derived from the document on every
 * write by the DatabaseRepository, using the same COLLECTIONS spec that the
 * in-memory implementation enforces, so queries behave identically in both modes.
 *
 * Sensitive identifiers (statutory IDs, bank accounts, TOTP secrets) are encrypted
 * inside `doc` before they reach the database (see src/server/crypto.ts).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const day = (name: string) => date(name, { mode: "string" });
const doc = () => jsonb("doc").notNull();
const timestamps = { createdAt: ts("created_at").notNull(), updatedAt: ts("updated_at").notNull() };

/* ------------------------------------------------------------------ organisation level */

export const organizations = pgTable(
  "organizations",
  { id: text("id").primaryKey(), name: text("name").notNull(), kind: text("kind").notNull(), doc: doc(), ...timestamps },
  // Demo organisations never exist in a production database.
  (t) => [check("organizations_kind_customer", sql`${t.kind} = 'customer'`)],
);

export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    legalName: text("legal_name").notNull(),
    doc: doc(),
    ...timestamps,
  },
  (t) => [index("companies_org_idx").on(t.organizationId)],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    status: text("status").notNull(),
    /** scrypt hash; never stored in `doc` and never returned to clients. */
    passwordHash: text("password_hash"),
    doc: doc(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_unique").on(sql`lower(${t.email})`),
    index("users_org_idx").on(t.organizationId),
    check("users_status_valid", sql`${t.status} in ('active', 'disabled', 'invited')`),
  ],
);

export const roles = pgTable(
  "roles",
  {
    /** Preserves creation order for listing. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    doc: doc(),
    ...timestamps,
  },
  (t) => [uniqueIndex("roles_org_key_unique").on(t.organizationId, t.key)],
);

export const licenses = pgTable(
  "licenses",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    plan: text("plan").notNull(),
    status: text("status").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    doc: doc(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("licenses_org_unique").on(t.organizationId),
    uniqueIndex("licenses_stripe_customer_unique").on(t.stripeCustomerId),
    check("licenses_plan_valid", sql`${t.plan} in ('hosted', 'owned', 'none')`),
    check("licenses_status_valid", sql`${t.status} in ('trialing', 'active', 'past_due', 'canceled', 'owned', 'inactive')`),
  ],
);

/** Append-only. UPDATE and DELETE are rejected by a trigger (see drizzle/0001_integrity.sql). */
export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    companyId: text("company_id").references(() => companies.id),
    at: ts("at").notNull(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    doc: doc(),
  },
  (t) => [
    index("audit_org_at_idx").on(t.organizationId, t.at),
    index("audit_company_at_idx").on(t.companyId, t.at),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);

/* ------------------------------------------------------------------ authentication & platform */

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only ever lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id),
    createdAt: ts("created_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const documentBlobs = pgTable("document_blobs", {
  key: text("key").primaryKey(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: ts("created_at").notNull(),
});

/** Processed Stripe events, for idempotent webhook handling. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: ts("received_at").notNull(),
});

/* ------------------------------------------------------------------ company-scoped records */

const tenantBase = () => ({
  id: text("id").primaryKey(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  doc: doc(),
  ...timestamps,
});
const employeeRef = (name = "employee_id") => text(name).references((): AnyPgColumn => employees.id);

export const departments = pgTable(
  "departments",
  { ...tenantBase(), name: text("name").notNull(), code: text("code").notNull(), parentId: text("parent_id") },
  (t) => [uniqueIndex("departments_code_unique").on(t.companyId, sql`lower(${t.code})`)],
);

export const employees = pgTable(
  "employees",
  {
    ...tenantBase(),
    employeeCode: text("employee_code").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    email: text("email"),
    position: text("position"),
    status: text("status").notNull(),
    employmentType: text("employment_type").notNull(),
    departmentId: text("department_id").references(() => departments.id),
    managerId: text("manager_id"),
    workLocation: text("work_location"),
    hireDate: day("hire_date").notNull(),
    terminationDate: day("termination_date"),
    dateOfBirth: day("date_of_birth"),
    leavePolicyId: text("leave_policy_id"),
    userId: text("user_id"),
  },
  (t) => [
    uniqueIndex("employees_code_unique").on(t.companyId, sql`lower(${t.employeeCode})`),
    index("employees_company_status_idx").on(t.companyId, t.status),
    index("employees_manager_idx").on(t.managerId),
    check("employees_status_valid", sql`${t.status} in ('onboarding', 'active', 'on_leave', 'terminated', 'archived')`),
    check("employees_type_valid", sql`${t.employmentType} in ('full_time', 'part_time', 'contract', 'temporary')`),
    check("employees_termination_after_hire", sql`${t.terminationDate} is null or ${t.terminationDate} >= ${t.hireDate}`),
  ],
);

export const employmentEvents = pgTable(
  "employment_events",
  { ...tenantBase(), employeeId: employeeRef().notNull(), effectiveDate: day("effective_date").notNull(), type: text("type").notNull() },
  (t) => [index("employment_events_emp_idx").on(t.companyId, t.employeeId, t.effectiveDate)],
);

export const payRates = pgTable(
  "pay_rates",
  {
    ...tenantBase(),
    employeeId: employeeRef().notNull(),
    effectiveFrom: day("effective_from").notNull(),
    payType: text("pay_type").notNull(),
    payFrequency: text("pay_frequency").notNull(),
  },
  (t) => [
    index("pay_rates_emp_idx").on(t.companyId, t.employeeId, t.effectiveFrom),
    check("pay_rates_type_valid", sql`${t.payType} in ('salary', 'hourly')`),
    check("pay_rates_frequency_valid", sql`${t.payFrequency} in ('weekly', 'biweekly', 'semi_monthly', 'monthly')`),
  ],
);

export const workSchedules = pgTable(
  "work_schedules",
  { ...tenantBase(), employeeId: employeeRef().notNull(), effectiveFrom: day("effective_from").notNull() },
  (t) => [index("work_schedules_emp_idx").on(t.companyId, t.employeeId, t.effectiveFrom)],
);

export const payItems = pgTable(
  "pay_items",
  {
    ...tenantBase(),
    employeeId: employeeRef().notNull(),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    active: boolean("active").notNull(),
    startDate: day("start_date").notNull(),
    endDate: day("end_date"),
  },
  (t) => [
    index("pay_items_emp_idx").on(t.companyId, t.employeeId),
    check("pay_items_kind_valid", sql`${t.kind} in ('earning', 'deduction')`),
    check("pay_items_dates", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

export const loans = pgTable(
  "loans",
  {
    ...tenantBase(),
    employeeId: employeeRef().notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    startDate: day("start_date").notNull(),
    reference: text("reference"),
  },
  (t) => [index("loans_emp_idx").on(t.companyId, t.employeeId), check("loans_status_valid", sql`${t.status} in ('active', 'paid', 'cancelled')`)],
);

export const leaveTypes = pgTable(
  "leave_types",
  { ...tenantBase(), code: text("code").notNull(), name: text("name").notNull(), category: text("category").notNull(), active: boolean("active").notNull() },
  (t) => [uniqueIndex("leave_types_code_unique").on(t.companyId, sql`lower(${t.code})`)],
);

export const leavePolicies = pgTable("leave_policies", { ...tenantBase(), name: text("name").notNull(), isDefault: boolean("is_default").notNull() });

export const leaveLedger = pgTable(
  "leave_ledger",
  {
    ...tenantBase(),
    employeeId: employeeRef().notNull(),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    date: day("date").notNull(),
    kind: text("kind").notNull(),
    requestId: text("request_id"),
  },
  (t) => [index("leave_ledger_emp_idx").on(t.companyId, t.employeeId, t.leaveTypeId, t.date)],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    ...tenantBase(),
    employeeId: employeeRef().notNull(),
    leaveTypeId: text("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    startDate: day("start_date").notNull(),
    endDate: day("end_date").notNull(),
    status: text("status").notNull(),
  },
  (t) => [
    index("leave_requests_dates_idx").on(t.companyId, t.startDate, t.endDate),
    check("leave_requests_dates", sql`${t.endDate} >= ${t.startDate}`),
    check("leave_requests_status_valid", sql`${t.status} in ('pending', 'approved', 'rejected', 'cancelled')`),
  ],
);

export const timesheets = pgTable(
  "timesheets",
  { ...tenantBase(), employeeId: employeeRef().notNull(), date: day("date").notNull(), status: text("status").notNull(), absent: boolean("absent") },
  (t) => [index("timesheets_emp_date_idx").on(t.companyId, t.employeeId, t.date), index("timesheets_date_idx").on(t.companyId, t.date)],
);

export const attendanceCorrections = pgTable(
  "attendance_corrections",
  { ...tenantBase(), employeeId: employeeRef().notNull(), date: day("date").notNull(), status: text("status").notNull(), entryId: text("entry_id") },
  (t) => [index("attendance_corrections_idx").on(t.companyId, t.status)],
);

export const documents = pgTable(
  "documents",
  {
    ...tenantBase(),
    employeeId: employeeRef(),
    category: text("category").notNull(),
    expiryDate: day("expiry_date"),
    visibility: text("visibility").notNull(),
    title: text("title").notNull(),
  },
  (t) => [index("documents_emp_idx").on(t.companyId, t.employeeId), index("documents_expiry_idx").on(t.companyId, t.expiryDate)],
);

export const workflows = pgTable(
  "workflows",
  { ...tenantBase(), employeeId: employeeRef().notNull(), type: text("type").notNull(), status: text("status").notNull(), startDate: day("start_date") },
  (t) => [index("workflows_idx").on(t.companyId, t.status)],
);

export const statutoryRules = pgTable(
  "statutory_rules",
  {
    ...tenantBase(),
    code: text("code").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    effectiveFrom: day("effective_from").notNull(),
    effectiveTo: day("effective_to"),
    jurisdiction: text("jurisdiction"),
  },
  (t) => [
    index("statutory_rules_code_idx").on(t.companyId, t.code, t.effectiveFrom),
    check("statutory_rules_dates", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
    check("statutory_rules_status_valid", sql`${t.status} in ('draft', 'approved', 'retired')`),
  ],
);

export const payrollRuns = pgTable(
  "payroll_runs",
  {
    ...tenantBase(),
    type: text("type").notNull(),
    payFrequency: text("pay_frequency").notNull(),
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    payDate: day("pay_date").notNull(),
    status: text("status").notNull(),
    correctsRunId: text("corrects_run_id"),
  },
  (t) => [
    // One regular run per company, frequency and period.
    uniqueIndex("payroll_runs_regular_period_unique").on(t.companyId, t.payFrequency, t.periodStart, t.periodEnd).where(sql`${t.type} = 'regular'`),
    index("payroll_runs_period_idx").on(t.companyId, t.periodStart),
    foreignKey({ columns: [t.correctsRunId], foreignColumns: [t.id], name: "payroll_runs_corrects_fk" }),
    check("payroll_runs_period", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("payroll_runs_type_valid", sql`${t.type} in ('regular', 'correction', 'off_cycle', 'historical')`),
    check("payroll_runs_status_valid", sql`${t.status} in ('draft', 'calculated', 'review', 'approved', 'finalized', 'locked')`),
  ],
);

export const payrollResults = pgTable(
  "payroll_results",
  {
    ...tenantBase(),
    runId: text("run_id")
      .notNull()
      .references(() => payrollRuns.id),
    employeeId: employeeRef().notNull(),
    payDate: day("pay_date").notNull(),
    periodStart: day("period_start").notNull(),
    periodEnd: day("period_end").notNull(),
    runType: text("run_type").notNull(),
  },
  (t) => [uniqueIndex("payroll_results_run_employee_unique").on(t.runId, t.employeeId), index("payroll_results_emp_idx").on(t.companyId, t.employeeId, t.payDate)],
);

export const importBatches = pgTable("import_batches", {
  ...tenantBase(),
  entity: text("entity").notNull(),
  status: text("status").notNull(),
  fileName: text("file_name").notNull(),
});
