/**
 * Collection specification shared by every repository implementation.
 *
 * `promoted` lists the entity fields that may be used in `where`, `range`,
 * `overlaps` and `orderBy`. The PostgreSQL implementation stores these as real,
 * indexed, constrained columns; the in-memory implementation reads them from the
 * entity. Using a non-promoted field is a programming error in every implementation.
 */
import type { TenantCollectionName } from "@/repositories/interfaces";

export type ColumnType = "text" | "date" | "number" | "boolean" | "timestamp";

export interface CollectionSpec {
  table: string;
  promoted: Record<string, ColumnType>;
  search: string[];
  defaultOrder: { field: string; dir: "asc" | "desc" }[];
}

const common = { id: "text", companyId: "text", createdAt: "timestamp", updatedAt: "timestamp" } as const;

export const COLLECTIONS: Record<TenantCollectionName, CollectionSpec> = {
  departments: {
    table: "departments",
    promoted: { ...common, name: "text", code: "text", parentId: "text" },
    search: ["name", "code"],
    defaultOrder: [{ field: "name", dir: "asc" }],
  },
  employees: {
    table: "employees",
    promoted: {
      ...common,
      employeeCode: "text",
      firstName: "text",
      lastName: "text",
      preferredName: "text",
      email: "text",
      position: "text",
      status: "text",
      employmentType: "text",
      departmentId: "text",
      managerId: "text",
      workLocation: "text",
      hireDate: "date",
      terminationDate: "date",
      dateOfBirth: "date",
      leavePolicyId: "text",
      userId: "text",
    },
    search: ["firstName", "lastName", "preferredName", "employeeCode", "email", "position"],
    defaultOrder: [
      { field: "lastName", dir: "asc" },
      { field: "firstName", dir: "asc" },
    ],
  },
  employmentEvents: {
    table: "employment_events",
    promoted: { ...common, employeeId: "text", effectiveDate: "date", type: "text" },
    search: ["note"],
    defaultOrder: [{ field: "effectiveDate", dir: "asc" }],
  },
  payRates: {
    table: "pay_rates",
    promoted: { ...common, employeeId: "text", effectiveFrom: "date", payType: "text", payFrequency: "text" },
    search: ["reason"],
    defaultOrder: [{ field: "effectiveFrom", dir: "asc" }],
  },
  schedules: {
    table: "work_schedules",
    promoted: { ...common, employeeId: "text", effectiveFrom: "date" },
    search: ["reason"],
    defaultOrder: [{ field: "effectiveFrom", dir: "asc" }],
  },
  payItems: {
    table: "pay_items",
    promoted: { ...common, employeeId: "text", kind: "text", category: "text", active: "boolean", startDate: "date", endDate: "date" },
    search: ["label"],
    defaultOrder: [{ field: "startDate", dir: "asc" }],
  },
  loans: {
    table: "loans",
    promoted: { ...common, employeeId: "text", type: "text", status: "text", startDate: "date", reference: "text" },
    search: ["reference", "note"],
    defaultOrder: [{ field: "startDate", dir: "desc" }],
  },
  leaveTypes: {
    table: "leave_types",
    promoted: { ...common, code: "text", name: "text", category: "text", active: "boolean" },
    search: ["name", "code"],
    defaultOrder: [{ field: "name", dir: "asc" }],
  },
  leavePolicies: {
    table: "leave_policies",
    promoted: { ...common, name: "text", isDefault: "boolean" },
    search: ["name"],
    defaultOrder: [{ field: "name", dir: "asc" }],
  },
  leaveLedger: {
    table: "leave_ledger",
    promoted: { ...common, employeeId: "text", leaveTypeId: "text", date: "date", kind: "text", requestId: "text" },
    search: ["reason"],
    defaultOrder: [{ field: "date", dir: "asc" }],
  },
  leaveRequests: {
    table: "leave_requests",
    promoted: { ...common, employeeId: "text", leaveTypeId: "text", startDate: "date", endDate: "date", status: "text" },
    search: ["reason"],
    defaultOrder: [{ field: "startDate", dir: "desc" }],
  },
  timesheets: {
    table: "timesheets",
    promoted: { ...common, employeeId: "text", date: "date", status: "text", absent: "boolean" },
    search: ["note"],
    defaultOrder: [{ field: "date", dir: "asc" }],
  },
  attendanceCorrections: {
    table: "attendance_corrections",
    promoted: { ...common, employeeId: "text", date: "date", status: "text", entryId: "text" },
    search: ["reason"],
    defaultOrder: [{ field: "date", dir: "desc" }],
  },
  documents: {
    table: "documents",
    promoted: { ...common, employeeId: "text", category: "text", expiryDate: "date", visibility: "text", title: "text" },
    search: ["title", "fileName", "notes"],
    defaultOrder: [{ field: "createdAt", dir: "desc" }],
  },
  workflows: {
    table: "workflows",
    promoted: { ...common, employeeId: "text", type: "text", status: "text", startDate: "date" },
    search: [],
    defaultOrder: [{ field: "startDate", dir: "desc" }],
  },
  statutoryRules: {
    table: "statutory_rules",
    promoted: { ...common, code: "text", type: "text", status: "text", effectiveFrom: "date", effectiveTo: "date", jurisdiction: "text" },
    search: ["name", "code"],
    defaultOrder: [
      { field: "code", dir: "asc" },
      { field: "effectiveFrom", dir: "asc" },
    ],
  },
  payrollRuns: {
    table: "payroll_runs",
    promoted: {
      ...common,
      type: "text",
      payFrequency: "text",
      periodStart: "date",
      periodEnd: "date",
      payDate: "date",
      status: "text",
      correctsRunId: "text",
    },
    search: ["name"],
    defaultOrder: [{ field: "periodStart", dir: "desc" }],
  },
  payrollResults: {
    table: "payroll_results",
    promoted: { ...common, runId: "text", employeeId: "text", payDate: "date", periodStart: "date", periodEnd: "date", runType: "text" },
    search: [],
    defaultOrder: [{ field: "payDate", dir: "asc" }],
  },
  importBatches: {
    table: "import_batches",
    promoted: { ...common, entity: "text", status: "text", fileName: "text" },
    search: ["fileName"],
    defaultOrder: [{ field: "createdAt", dir: "desc" }],
  },
};

export function assertPromoted(collection: TenantCollectionName, field: string) {
  if (!(field in COLLECTIONS[collection].promoted)) {
    throw new Error(`Field "${field}" is not queryable on ${collection}. Add it to COLLECTIONS.promoted.`);
  }
}
