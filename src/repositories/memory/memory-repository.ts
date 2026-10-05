/**
 * In-memory repository used for unit/integration tests and as the engine behind
 * the browser (demo) repository. Entities are cloned on every read and write so
 * callers can never mutate stored state by reference.
 */
import type {
  AuditEvent,
  Company,
  CompanyScoped,
  License,
  Organization,
  Role,
  User,
} from "@/domain/types";
import type {
  AuditQuery,
  ListQuery,
  Page,
  Repository,
  TenantCollection,
  TenantCollectionName,
} from "@/repositories/interfaces";
import { COLLECTIONS, assertPromoted } from "@/repositories/spec";
import { AppError, conflict, notFound } from "@/lib/errors";

export const STATE_VERSION = 4;

export type TenantState = { [K in TenantCollectionName]: Record<string, CompanyScoped> };

export interface RepositoryState {
  version: number;
  organizations: Record<string, Organization>;
  companies: Record<string, Company>;
  users: Record<string, User>;
  roles: Record<string, Role>;
  licenses: Record<string, License>;
  audit: AuditEvent[];
  tenant: TenantState;
}

export function emptyState(): RepositoryState {
  const tenant = {} as TenantState;
  for (const name of Object.keys(COLLECTIONS) as TenantCollectionName[]) tenant[name] = {};
  return { version: STATE_VERSION, organizations: {}, companies: {}, users: {}, roles: {}, licenses: {}, audit: [], tenant };
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
}

/** Shared filtering semantics, used by the memory implementation and documented for SQL. */
export function applyQuery<T extends object>(
  name: TenantCollectionName,
  rows: T[],
  query: ListQuery<T> = {},
): { items: T[]; total: number } {
  const spec = COLLECTIONS[name];
  let out = rows;
  const rec = (r: T) => r as unknown as Record<string, unknown>;

  if (query.where) {
    for (const [field, value] of Object.entries(query.where)) {
      if (value === undefined) continue;
      assertPromoted(name, field);
      if (Array.isArray(value)) {
        const set = new Set(value as unknown[]);
        out = out.filter((r) => set.has(rec(r)[field]));
      } else if (value === null) {
        out = out.filter((r) => rec(r)[field] === null || rec(r)[field] === undefined || rec(r)[field] === "");
      } else {
        out = out.filter((r) => rec(r)[field] === value);
      }
    }
  }
  if (query.range) {
    const { field, gte, lte } = query.range;
    assertPromoted(name, field);
    out = out.filter((r) => {
      const v = rec(r)[field] as string | number | null | undefined;
      if (v === null || v === undefined || v === "") return false;
      if (gte !== undefined && v < gte) return false;
      if (lte !== undefined && v > lte) return false;
      return true;
    });
  }
  if (query.overlaps) {
    const { startField, endField, start, end } = query.overlaps;
    assertPromoted(name, startField);
    assertPromoted(name, endField);
    out = out.filter((r) => {
      const s = rec(r)[startField] as string;
      const e = (rec(r)[endField] as string | null) || "9999-12-31";
      return s <= end && e >= start;
    });
  }
  if (query.search && query.search.trim()) {
    const terms = query.search.trim().toLowerCase().split(/\s+/);
    out = out.filter((r) => {
      const hay = spec.search.map((f) => String(rec(r)[f] ?? "")).join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  const order = query.orderBy?.length ? query.orderBy : spec.defaultOrder;
  for (const o of order) assertPromoted(name, o.field);
  out = [...out].sort((a, b) => {
    for (const o of order) {
      const c = compare(rec(a)[o.field], rec(b)[o.field]);
      if (c !== 0) return o.dir === "desc" ? -c : c;
    }
    return compare(rec(a).id, rec(b).id);
  });
  const total = out.length;
  const offset = query.offset ?? 0;
  if (query.limit !== undefined) out = out.slice(offset, offset + query.limit);
  else if (offset) out = out.slice(offset);
  return { items: out, total };
}

type Uniques = Partial<Record<TenantCollectionName, (e: CompanyScoped) => string | null>>;

/** Uniqueness rules mirrored from the database constraints. */
const UNIQUES: Uniques = {
  employees: (e) => `${e.companyId}|${(e as unknown as { employeeCode: string }).employeeCode.toLowerCase()}`,
  departments: (e) => `${e.companyId}|${(e as unknown as { code: string }).code.toLowerCase()}`,
  leaveTypes: (e) => `${e.companyId}|${(e as unknown as { code: string }).code.toLowerCase()}`,
  payrollRuns: (e) => {
    const r = e as unknown as { type: string; payFrequency: string; periodStart: string; periodEnd: string };
    return r.type === "regular" ? `${e.companyId}|${r.payFrequency}|${r.periodStart}|${r.periodEnd}` : null;
  },
  payrollResults: (e) => `${(e as unknown as { runId: string }).runId}|${(e as unknown as { employeeId: string }).employeeId}`,
};

const UNIQUE_MESSAGES: Partial<Record<TenantCollectionName, string>> = {
  employees: "An employee with this Employee ID already exists in this company.",
  departments: "A department with this code already exists.",
  leaveTypes: "A leave type with this code already exists.",
  payrollRuns: "A regular payroll run already exists for this period.",
  payrollResults: "This employee already has a result in this payroll run.",
};

export class InMemoryRepository implements Repository {
  private state: RepositoryState;
  private readonly onChange?: (state: RepositoryState) => void;
  private txDepth = 0;

  constructor(state: RepositoryState = emptyState(), opts: { onChange?: (state: RepositoryState) => void } = {}) {
    this.state = state;
    this.onChange = opts.onChange;
  }

  /** Snapshot of the whole store (used for persistence and demo export). */
  snapshot(): RepositoryState {
    return clone(this.state);
  }

  replace(state: RepositoryState) {
    this.state = clone(state);
    this.changed();
  }

  private changed() {
    if (this.txDepth === 0) this.onChange?.(this.state);
  }

  async transaction<R>(fn: (repo: Repository) => Promise<R>): Promise<R> {
    const before = this.txDepth === 0 ? clone(this.state) : null;
    this.txDepth += 1;
    try {
      const result = await fn(this);
      this.txDepth -= 1;
      this.changed();
      return result;
    } catch (e) {
      this.txDepth -= 1;
      if (before) this.state = before;
      throw e;
    }
  }

  private tenant<T extends CompanyScoped>(name: TenantCollectionName): TenantCollection<T> {
    const table = () => this.state.tenant[name] as Record<string, T>;
    const unique = UNIQUES[name];
    const checkUnique = (entity: T, ignoreId?: string) => {
      if (!unique) return;
      const key = unique(entity);
      if (key === null) return;
      for (const other of Object.values(table())) {
        if (other.id !== ignoreId && unique(other) === key) {
          throw conflict(UNIQUE_MESSAGES[name] ?? "Duplicate record.");
        }
      }
    };
    const rows = (companyId: string) => Object.values(table()).filter((r) => r.companyId === companyId);
    return {
      list: async (companyId, query) => clone(applyQuery(name, rows(companyId), query).items),
      page: async (companyId, query) => {
        const res = applyQuery(name, rows(companyId), query);
        return { items: clone(res.items), total: res.total } satisfies Page<T>;
      },
      count: async (companyId, query) => applyQuery(name, rows(companyId), { ...query, limit: undefined, offset: undefined }).total,
      get: async (companyId, id) => {
        const r = table()[id];
        return r && r.companyId === companyId ? clone(r) : null;
      },
      insert: async (entity) => {
        if (table()[entity.id]) throw conflict(`Duplicate id ${entity.id}.`);
        this.assertCompany(entity.companyId);
        checkUnique(entity);
        table()[entity.id] = clone(entity);
        this.changed();
        return clone(entity);
      },
      insertMany: async (entities) => {
        await this.transaction(async () => {
          for (const e of entities) {
            if (table()[e.id]) throw conflict(`Duplicate id ${e.id}.`);
            this.assertCompany(e.companyId);
            checkUnique(e);
            table()[e.id] = clone(e);
          }
        });
      },
      update: async (companyId, id, patch) => {
        const cur = table()[id];
        if (!cur || cur.companyId !== companyId) throw notFound();
        const next = { ...cur, ...clone(patch), id: cur.id, companyId: cur.companyId } as T;
        checkUnique(next, id);
        table()[id] = next;
        this.changed();
        return clone(next);
      },
      remove: async (companyId, id) => {
        const cur = table()[id];
        if (!cur || cur.companyId !== companyId) throw notFound();
        delete table()[id];
        this.changed();
      },
    };
  }

  private assertCompany(companyId: string) {
    if (!this.state.companies[companyId]) {
      throw new AppError("VALIDATION", `Unknown company ${companyId}.`);
    }
  }

  organizations = {
    get: async (id: string) => clone(this.state.organizations[id] ?? null),
    list: async () => clone(Object.values(this.state.organizations)),
    insert: async (org: Organization) => {
      this.state.organizations[org.id] = clone(org);
      this.changed();
      return clone(org);
    },
    update: async (id: string, patch: Partial<Organization>) => {
      const cur = this.state.organizations[id];
      if (!cur) throw notFound("Organization");
      this.state.organizations[id] = { ...cur, ...clone(patch), id };
      this.changed();
      return clone(this.state.organizations[id]);
    },
  };

  companies = {
    get: async (id: string) => clone(this.state.companies[id] ?? null),
    listByOrganization: async (organizationId: string) =>
      clone(
        Object.values(this.state.companies)
          .filter((c) => c.organizationId === organizationId)
          .sort((a, b) => a.legalName.localeCompare(b.legalName)),
      ),
    insert: async (company: Company) => {
      if (!this.state.organizations[company.organizationId]) throw new AppError("VALIDATION", "Unknown organization.");
      this.state.companies[company.id] = clone(company);
      this.changed();
      return clone(company);
    },
    update: async (id: string, patch: Partial<Company>) => {
      const cur = this.state.companies[id];
      if (!cur) throw notFound("Company");
      this.state.companies[id] = { ...cur, ...clone(patch), id, organizationId: cur.organizationId };
      this.changed();
      return clone(this.state.companies[id]);
    },
  };

  users = {
    get: async (id: string) => clone(this.state.users[id] ?? null),
    getByEmail: async (email: string) =>
      clone(Object.values(this.state.users).find((u) => u.email.toLowerCase() === email.trim().toLowerCase()) ?? null),
    listByOrganization: async (organizationId: string) =>
      clone(
        Object.values(this.state.users)
          .filter((u) => u.organizationId === organizationId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    insert: async (user: User) => {
      if (Object.values(this.state.users).some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
        throw conflict("A user with this email already exists.");
      }
      this.state.users[user.id] = clone(user);
      this.changed();
      return clone(user);
    },
    update: async (id: string, patch: Partial<User>) => {
      const cur = this.state.users[id];
      if (!cur) throw notFound("User");
      if (patch.email && Object.values(this.state.users).some((u) => u.id !== id && u.email.toLowerCase() === patch.email!.toLowerCase())) {
        throw conflict("A user with this email already exists.");
      }
      this.state.users[id] = { ...cur, ...clone(patch), id, organizationId: cur.organizationId };
      this.changed();
      return clone(this.state.users[id]);
    },
  };

  roles = {
    get: async (id: string) => clone(this.state.roles[id] ?? null),
    listByOrganization: async (organizationId: string) =>
      clone(Object.values(this.state.roles).filter((r) => r.organizationId === organizationId)),
    insert: async (role: Role) => {
      this.state.roles[role.id] = clone(role);
      this.changed();
      return clone(role);
    },
    update: async (id: string, patch: Partial<Role>) => {
      const cur = this.state.roles[id];
      if (!cur) throw notFound("Role");
      this.state.roles[id] = { ...cur, ...clone(patch), id, organizationId: cur.organizationId };
      this.changed();
      return clone(this.state.roles[id]);
    },
  };

  licenses = {
    getByOrganization: async (organizationId: string) =>
      clone(Object.values(this.state.licenses).find((l) => l.organizationId === organizationId) ?? null),
    getByStripeCustomer: async (customerId: string) =>
      clone(Object.values(this.state.licenses).find((l) => l.stripeCustomerId === customerId) ?? null),
    upsert: async (license: License) => {
      this.state.licenses[license.id] = clone(license);
      this.changed();
      return clone(license);
    },
  };

  audit = {
    append: async (event: AuditEvent) => {
      this.state.audit.push(clone(event));
      this.changed();
    },
    list: async (organizationId: string, q: AuditQuery = {}) => {
      let rows = this.state.audit.filter((e) => e.organizationId === organizationId);
      if (q.companyId !== undefined) rows = rows.filter((e) => e.companyId === q.companyId);
      if (q.entityType) rows = rows.filter((e) => e.entityType === q.entityType);
      if (q.entityId) rows = rows.filter((e) => e.entityId === q.entityId);
      if (q.action) rows = rows.filter((e) => e.action === q.action || e.action.startsWith(`${q.action}.`));
      if (q.actorId) rows = rows.filter((e) => e.actorId === q.actorId);
      if (q.from) rows = rows.filter((e) => e.at >= q.from!);
      if (q.to) rows = rows.filter((e) => e.at <= q.to!);
      if (q.search) {
        const t = q.search.toLowerCase();
        rows = rows.filter((e) => `${e.summary} ${e.actorName} ${e.action}`.toLowerCase().includes(t));
      }
      rows = [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id.localeCompare(a.id)));
      const offset = q.offset ?? 0;
      const limit = q.limit ?? 50;
      return { items: clone(rows.slice(offset, offset + limit)), total: rows.length };
    },
  };

  departments = this.tenant<import("@/domain/types").Department>("departments");
  employees = this.tenant<import("@/domain/types").Employee>("employees");
  employmentEvents = this.tenant<import("@/domain/types").EmploymentEvent>("employmentEvents");
  payRates = this.tenant<import("@/domain/types").PayRate>("payRates");
  schedules = this.tenant<import("@/domain/types").WorkSchedule>("schedules");
  payItems = this.tenant<import("@/domain/types").PayItem>("payItems");
  loans = this.tenant<import("@/domain/types").Loan>("loans");
  leaveTypes = this.tenant<import("@/domain/types").LeaveType>("leaveTypes");
  leavePolicies = this.tenant<import("@/domain/types").LeavePolicy>("leavePolicies");
  leaveLedger = this.tenant<import("@/domain/types").LeaveLedgerEntry>("leaveLedger");
  leaveRequests = this.tenant<import("@/domain/types").LeaveRequest>("leaveRequests");
  timesheets = this.tenant<import("@/domain/types").TimesheetEntry>("timesheets");
  attendanceCorrections = this.tenant<import("@/domain/types").AttendanceCorrection>("attendanceCorrections");
  documents = this.tenant<import("@/domain/types").EmployeeDocument>("documents");
  workflows = this.tenant<import("@/domain/types").Workflow>("workflows");
  statutoryRules = this.tenant<import("@/domain/types").StatutoryRule>("statutoryRules");
  payrollRuns = this.tenant<import("@/domain/types").PayrollRun>("payrollRuns");
  payrollResults = this.tenant<import("@/domain/types").PayrollEmployeeResult>("payrollResults");
  importBatches = this.tenant<import("@/domain/types").ImportBatch>("importBatches");
}

export class MemoryDocumentStorage {
  private readonly blobs = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    this.blobs.set(key, new Uint8Array(bytes));
  }
  async get(key: string) {
    const b = this.blobs.get(key);
    return b ? new Uint8Array(b) : null;
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}
