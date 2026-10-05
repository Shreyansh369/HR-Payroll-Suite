/**
 * Repository contracts. Business logic depends only on these interfaces; the
 * in-memory, browser (demo) and PostgreSQL (production) implementations all
 * satisfy the same contract and are verified by the same contract tests.
 */
import type {
  AttendanceCorrection,
  AuditEvent,
  Company,
  CompanyScoped,
  Department,
  Employee,
  EmployeeDocument,
  EmploymentEvent,
  ID,
  ImportBatch,
  LeaveLedgerEntry,
  LeavePolicy,
  LeaveRequest,
  LeaveType,
  License,
  Loan,
  Organization,
  PayItem,
  PayRate,
  PayrollEmployeeResult,
  PayrollRun,
  Role,
  StatutoryRule,
  TimesheetEntry,
  User,
  WorkSchedule,
  Workflow,
} from "@/domain/types";

export type Scalar = string | number | boolean | null;

type ScalarKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Scalar ? K : never;
}[keyof T] &
  string;

export type WhereClause<T> = { [K in ScalarKeys<T>]?: T[K] | NonNullable<T[K]>[] | null };

export interface ListQuery<T> {
  /** Equality (or IN for arrays) on promoted fields. `null` matches missing values. */
  where?: WhereClause<T>;
  /** Inclusive range on a promoted date/number field. */
  range?: { field: ScalarKeys<T>; gte?: string | number; lte?: string | number };
  /** Records whose [startField, endField] interval overlaps [start, end]. */
  overlaps?: { startField: ScalarKeys<T>; endField: ScalarKeys<T>; start: string; end: string };
  /** Case-insensitive substring search over the collection's search fields. */
  search?: string;
  orderBy?: { field: ScalarKeys<T>; dir?: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface TenantCollection<T extends CompanyScoped> {
  list(companyId: ID, query?: ListQuery<T>): Promise<T[]>;
  page(companyId: ID, query: ListQuery<T>): Promise<Page<T>>;
  count(companyId: ID, query?: ListQuery<T>): Promise<number>;
  get(companyId: ID, id: ID): Promise<T | null>;
  insert(entity: T): Promise<T>;
  insertMany(entities: T[]): Promise<void>;
  update(companyId: ID, id: ID, patch: Partial<T>): Promise<T>;
  remove(companyId: ID, id: ID): Promise<void>;
}

export interface OrganizationRepository {
  get(id: ID): Promise<Organization | null>;
  list(): Promise<Organization[]>;
  insert(org: Organization): Promise<Organization>;
  update(id: ID, patch: Partial<Organization>): Promise<Organization>;
}

export interface CompanyRepository {
  get(id: ID): Promise<Company | null>;
  listByOrganization(organizationId: ID): Promise<Company[]>;
  insert(company: Company): Promise<Company>;
  update(id: ID, patch: Partial<Company>): Promise<Company>;
}

export interface UserRepository {
  get(id: ID): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  listByOrganization(organizationId: ID): Promise<User[]>;
  insert(user: User): Promise<User>;
  update(id: ID, patch: Partial<User>): Promise<User>;
}

export interface RoleRepository {
  get(id: ID): Promise<Role | null>;
  listByOrganization(organizationId: ID): Promise<Role[]>;
  insert(role: Role): Promise<Role>;
  update(id: ID, patch: Partial<Role>): Promise<Role>;
}

export interface LicenseRepository {
  getByOrganization(organizationId: ID): Promise<License | null>;
  getByStripeCustomer(customerId: string): Promise<License | null>;
  upsert(license: License): Promise<License>;
}

export interface AuditQuery {
  companyId?: ID | null;
  entityType?: string;
  entityId?: ID;
  action?: string;
  actorId?: ID;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditRepository {
  /** Append-only. There is intentionally no update or delete. */
  append(event: AuditEvent): Promise<void>;
  list(organizationId: ID, query?: AuditQuery): Promise<Page<AuditEvent>>;
}

export interface Repository {
  organizations: OrganizationRepository;
  companies: CompanyRepository;
  users: UserRepository;
  roles: RoleRepository;
  licenses: LicenseRepository;
  audit: AuditRepository;
  departments: TenantCollection<Department>;
  employees: TenantCollection<Employee>;
  employmentEvents: TenantCollection<EmploymentEvent>;
  payRates: TenantCollection<PayRate>;
  schedules: TenantCollection<WorkSchedule>;
  payItems: TenantCollection<PayItem>;
  loans: TenantCollection<Loan>;
  leaveTypes: TenantCollection<LeaveType>;
  leavePolicies: TenantCollection<LeavePolicy>;
  leaveLedger: TenantCollection<LeaveLedgerEntry>;
  leaveRequests: TenantCollection<LeaveRequest>;
  timesheets: TenantCollection<TimesheetEntry>;
  attendanceCorrections: TenantCollection<AttendanceCorrection>;
  documents: TenantCollection<EmployeeDocument>;
  workflows: TenantCollection<Workflow>;
  statutoryRules: TenantCollection<StatutoryRule>;
  payrollRuns: TenantCollection<PayrollRun>;
  payrollResults: TenantCollection<PayrollEmployeeResult>;
  importBatches: TenantCollection<ImportBatch>;
  /** Run `fn` atomically. Implementations roll back every write if `fn` throws. */
  transaction<R>(fn: (repo: Repository) => Promise<R>): Promise<R>;
}

export type TenantCollectionName = {
  [K in keyof Repository]: Repository[K] extends TenantCollection<infer _> ? K : never;
}[keyof Repository];

/** Byte storage for uploaded documents. */
export interface DocumentStorage {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}
