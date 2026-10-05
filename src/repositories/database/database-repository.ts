/**
 * PostgreSQL implementation of the repository contract (production mode).
 *
 * Works with any Drizzle Postgres driver (postgres-js in production, PGlite in
 * tests). Query semantics mirror `applyQuery` in the in-memory implementation and
 * are verified by the shared contract tests.
 */
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgDatabase, PgTable } from "drizzle-orm/pg-core";
import * as s from "@/db/schema";
import type { AuditEvent, Company, CompanyScoped, Employee, License, Organization, Role, User } from "@/domain/types";
import type { AuditQuery, ListQuery, Page, Repository, TenantCollection, TenantCollectionName } from "@/repositories/interfaces";
import { COLLECTIONS, UNIQUE_MESSAGES, assertPromoted, type ColumnType } from "@/repositories/spec";
import { AppError, conflict, notFound } from "@/lib/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

export interface Cipher {
  encrypt(plain: string): string;
  decrypt(value: string): string;
}

type Table = PgTable & { id: PgColumn; companyId: PgColumn; doc: PgColumn };

const TABLES: Record<TenantCollectionName, Table> = {
  departments: s.departments as unknown as Table,
  employees: s.employees as unknown as Table,
  employmentEvents: s.employmentEvents as unknown as Table,
  payRates: s.payRates as unknown as Table,
  schedules: s.workSchedules as unknown as Table,
  payItems: s.payItems as unknown as Table,
  loans: s.loans as unknown as Table,
  leaveTypes: s.leaveTypes as unknown as Table,
  leavePolicies: s.leavePolicies as unknown as Table,
  leaveLedger: s.leaveLedger as unknown as Table,
  leaveRequests: s.leaveRequests as unknown as Table,
  timesheets: s.timesheets as unknown as Table,
  attendanceCorrections: s.attendanceCorrections as unknown as Table,
  documents: s.documents as unknown as Table,
  workflows: s.workflows as unknown as Table,
  statutoryRules: s.statutoryRules as unknown as Table,
  payrollRuns: s.payrollRuns as unknown as Table,
  payrollResults: s.payrollResults as unknown as Table,
  importBatches: s.importBatches as unknown as Table,
};

/* ------------------------------------------------------------------ errors */

interface PgErrorInfo {
  code?: string;
  constraint?: string;
  message?: string;
}

function pgError(e: unknown): PgErrorInfo | null {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const o = cur as Record<string, unknown>;
    if (typeof o.code === "string" && /^[0-9A-Z]{5}$/.test(o.code)) {
      return { code: o.code, constraint: (o.constraint_name ?? o.constraint) as string | undefined, message: o.message as string | undefined };
    }
    cur = o.cause;
  }
  return null;
}

function translate(e: unknown, collection?: TenantCollectionName): never {
  if (e instanceof AppError) throw e;
  const info = pgError(e);
  if (info?.code === "23505") {
    if (info.constraint?.endsWith("_pkey")) throw conflict("A record with this id already exists.");
    if (info.constraint === "users_email_unique") throw conflict("A user with this email already exists.");
    throw conflict((collection && UNIQUE_MESSAGES[collection]) ?? "Duplicate record.");
  }
  if (info?.code === "23503") throw new AppError("CONFLICT", "This record is referenced by, or refers to, a record that does not exist or is still in use.");
  if (info?.code === "23514" || info?.code === "23502") throw new AppError("VALIDATION", `The database rejected this change (${info.constraint ?? info.message ?? "constraint"}).`);
  throw e;
}

/* ------------------------------------------------------------------ helpers */

const NULLISH_TEXT = (col: PgColumn) => or(isNull(col), eq(col, ""));

function columnValue(type: ColumnType, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if ((type === "date" || type === "timestamp") && v === "") return null;
  if (type === "number") return typeof v === "number" ? v : Number(v);
  if (type === "boolean") return Boolean(v);
  return v;
}

function escapeLike(term: string) {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Field-level encryption of sensitive employee identifiers. */
function employeeCodec(cipher: Cipher | null) {
  const map = (e: Employee, fn: (v: string) => string): Employee =>
    cipher
      ? {
          ...e,
          statutoryIds: e.statutoryIds && {
            socialSecurityNumber: fn(e.statutoryIds.socialSecurityNumber ?? ""),
            nhiNumber: fn(e.statutoryIds.nhiNumber ?? ""),
            taxId: fn(e.statutoryIds.taxId ?? ""),
          },
          payProfile: e.payProfile && { ...e.payProfile, bankAccount: fn(e.payProfile.bankAccount ?? "") },
        }
      : e;
  return { encode: (e: Employee) => map(e, (v) => cipher!.encrypt(v)), decode: (e: Employee) => map(e, (v) => cipher!.decrypt(v)) };
}

/* ------------------------------------------------------------------ repository */

export class DatabaseRepository implements Repository {
  constructor(
    private readonly db: Db,
    private readonly opts: { cipher?: Cipher | null; inTransaction?: boolean } = {},
  ) {}

  async transaction<R>(fn: (repo: Repository) => Promise<R>): Promise<R> {
    if (this.opts.inTransaction) return fn(this);
    return this.db.transaction(async (tx) => fn(new DatabaseRepository(tx as unknown as Db, { ...this.opts, inTransaction: true })));
  }

  /** Runs `fn` atomically, joining the current transaction when there is one. */
  private atomic<R>(fn: (db: Db) => Promise<R>): Promise<R> {
    if (this.opts.inTransaction) return fn(this.db);
    return this.db.transaction(async (tx) => fn(tx as unknown as Db));
  }

  private tenant<T extends CompanyScoped>(name: TenantCollectionName): TenantCollection<T> {
    const table = TABLES[name];
    const spec = COLLECTIONS[name];
    const column = (field: string): PgColumn => (table as unknown as Record<string, PgColumn>)[field];
    const codec =
      name === "employees"
        ? (employeeCodec(this.opts.cipher ?? null) as unknown as { encode: (e: T) => T; decode: (e: T) => T })
        : { encode: (e: T) => e, decode: (e: T) => e };

    const row = (entity: T) => {
      const values: Record<string, unknown> = { doc: codec.encode(entity) };
      for (const [field, type] of Object.entries(spec.promoted)) values[field] = columnValue(type, (entity as unknown as Record<string, unknown>)[field]);
      return values;
    };

    const conditions = (companyId: string, q: ListQuery<T> = {}): SQL => {
      const parts: (SQL | undefined)[] = [eq(table.companyId, companyId)];
      for (const [field, value] of Object.entries(q.where ?? {})) {
        if (value === undefined) continue;
        assertPromoted(name, field);
        const col = column(field);
        if (Array.isArray(value)) parts.push(value.length ? inArray(col, value) : sql`false`);
        else if (value === null) parts.push(spec.promoted[field] === "text" ? NULLISH_TEXT(col) : isNull(col));
        else parts.push(eq(col, value));
      }
      if (q.range) {
        assertPromoted(name, q.range.field);
        const col = column(q.range.field);
        parts.push(isNotNull(col));
        if (q.range.gte !== undefined) parts.push(gte(col, q.range.gte));
        if (q.range.lte !== undefined) parts.push(lte(col, q.range.lte));
      }
      if (q.overlaps) {
        assertPromoted(name, q.overlaps.startField);
        assertPromoted(name, q.overlaps.endField);
        const start = column(q.overlaps.startField);
        const end = column(q.overlaps.endField);
        parts.push(lte(start, q.overlaps.end));
        parts.push(or(isNull(end), gte(end, q.overlaps.start)));
      }
      if (q.search?.trim() && spec.search.length) {
        const hay = sql`lower(concat_ws(' ', ${sql.join(
          spec.search.map((f) => sql`${table.doc}->>${f}`),
          sql`, `,
        )}))`;
        for (const term of q.search.trim().toLowerCase().split(/\s+/)) parts.push(ilike(hay, `%${escapeLike(term)}%`));
      } else if (q.search?.trim()) {
        parts.push(sql`false`);
      }
      return and(...parts)!;
    };

    const ordering = (q: ListQuery<T> = {}): SQL[] => {
      const order = q.orderBy?.length ? q.orderBy : spec.defaultOrder;
      const out: SQL[] = [];
      for (const o of order) {
        assertPromoted(name, o.field);
        const col = column(o.field);
        const type = spec.promoted[o.field];
        const expr = type === "text" ? sql`nullif(lower(${col}), '')` : sql`${col}`;
        out.push(o.dir === "desc" ? sql`${expr} desc nulls last` : sql`${expr} asc nulls last`);
      }
      out.push(asc(table.id));
      return out;
    };

    const read = (r: { doc: unknown }) => codec.decode(r.doc as T);

    return {
      list: async (companyId, q) => {
        let query = this.db.select({ doc: table.doc }).from(table).where(conditions(companyId, q)).orderBy(...ordering(q)).$dynamic();
        if (q?.limit !== undefined) query = query.limit(q.limit);
        if (q?.offset) query = query.offset(q.offset);
        return (await query).map(read);
      },
      page: async (companyId, q) => {
        const where = conditions(companyId, q);
        let query = this.db.select({ doc: table.doc }).from(table).where(where).orderBy(...ordering(q)).$dynamic();
        if (q.limit !== undefined) query = query.limit(q.limit);
        if (q.offset) query = query.offset(q.offset);
        const [items, [{ n }]] = await Promise.all([query, this.db.select({ n: count() }).from(table).where(where)]);
        return { items: items.map(read), total: Number(n) } satisfies Page<T>;
      },
      count: async (companyId, q) => {
        const [{ n }] = await this.db.select({ n: count() }).from(table).where(conditions(companyId, q));
        return Number(n);
      },
      get: async (companyId, id) => {
        const [r] = await this.db.select({ doc: table.doc }).from(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).limit(1);
        return r ? read(r) : null;
      },
      insert: async (entity) => {
        try {
          await this.db.insert(table).values(row(entity) as never);
        } catch (e) {
          translate(e, name);
        }
        return structuredClone(entity);
      },
      insertMany: async (entities) => {
        if (!entities.length) return;
        try {
          await this.atomic(async (db) => {
            for (let i = 0; i < entities.length; i += 200) await db.insert(table).values(entities.slice(i, i + 200).map(row) as never);
          });
        } catch (e) {
          translate(e, name);
        }
      },
      update: async (companyId, id, patch) => {
        try {
          return await this.atomic(async (db) => {
            const [cur] = await db.select({ doc: table.doc }).from(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).for("update");
            if (!cur) throw notFound();
            const next = { ...read(cur), ...structuredClone(patch), id, companyId } as T;
            await db.update(table).set(row(next) as never).where(eq(table.id, id));
            return next;
          });
        } catch (e) {
          translate(e, name);
        }
      },
      remove: async (companyId, id) => {
        try {
          const deleted = await this.db.delete(table).where(and(eq(table.id, id), eq(table.companyId, companyId))).returning({ id: table.id });
          if (!deleted.length) throw notFound();
        } catch (e) {
          translate(e, name);
        }
      },
    };
  }

  /* -------------------------------------------------------------- organisation level */

  organizations = {
    get: async (id: string) => {
      const [r] = await this.db.select({ doc: s.organizations.doc }).from(s.organizations).where(eq(s.organizations.id, id));
      return (r?.doc as Organization) ?? null;
    },
    list: async () => (await this.db.select({ doc: s.organizations.doc }).from(s.organizations).orderBy(asc(s.organizations.name))).map((r) => r.doc as Organization),
    insert: async (org: Organization) => {
      try {
        await this.db.insert(s.organizations).values({ id: org.id, name: org.name, kind: org.kind, doc: org, createdAt: org.createdAt, updatedAt: org.updatedAt });
      } catch (e) {
        translate(e);
      }
      return org;
    },
    update: async (id: string, patch: Partial<Organization>) =>
      this.atomic(async (db) => {
        const [cur] = await db.select({ doc: s.organizations.doc }).from(s.organizations).where(eq(s.organizations.id, id)).for("update");
        if (!cur) throw notFound("Organization");
        const next = { ...(cur.doc as Organization), ...patch, id };
        await db.update(s.organizations).set({ name: next.name, kind: next.kind, doc: next, updatedAt: next.updatedAt }).where(eq(s.organizations.id, id));
        return next;
      }),
  };

  companies = {
    get: async (id: string) => {
      const [r] = await this.db.select({ doc: s.companies.doc }).from(s.companies).where(eq(s.companies.id, id));
      return (r?.doc as Company) ?? null;
    },
    listByOrganization: async (organizationId: string) =>
      (await this.db.select({ doc: s.companies.doc }).from(s.companies).where(eq(s.companies.organizationId, organizationId)).orderBy(asc(sql`lower(${s.companies.legalName})`))).map((r) => r.doc as Company),
    insert: async (company: Company) => {
      try {
        await this.db.insert(s.companies).values({ id: company.id, organizationId: company.organizationId, legalName: company.legalName, doc: company, createdAt: company.createdAt, updatedAt: company.updatedAt });
      } catch (e) {
        if (pgError(e)?.code === "23503") throw new AppError("VALIDATION", "Unknown organization.");
        translate(e);
      }
      return company;
    },
    update: async (id: string, patch: Partial<Company>) =>
      this.atomic(async (db) => {
        const [cur] = await db.select({ doc: s.companies.doc }).from(s.companies).where(eq(s.companies.id, id)).for("update");
        if (!cur) throw notFound("Company");
        const prev = cur.doc as Company;
        const next = { ...prev, ...patch, id, organizationId: prev.organizationId };
        await db.update(s.companies).set({ legalName: next.legalName, doc: next, updatedAt: next.updatedAt }).where(eq(s.companies.id, id));
        return next;
      }),
  };

  private userFrom(r: { doc: unknown; passwordHash: string | null }): User {
    return { ...(r.doc as User), passwordHash: r.passwordHash };
  }

  private userRow(u: User) {
    const { passwordHash, ...rest } = u;
    return { id: u.id, organizationId: u.organizationId, email: u.email.toLowerCase(), status: u.status, passwordHash: passwordHash ?? null, doc: rest, createdAt: u.createdAt, updatedAt: u.updatedAt };
  }

  users = {
    get: async (id: string) => {
      const [r] = await this.db.select({ doc: s.users.doc, passwordHash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, id));
      return r ? this.userFrom(r) : null;
    },
    getByEmail: async (email: string) => {
      const [r] = await this.db
        .select({ doc: s.users.doc, passwordHash: s.users.passwordHash })
        .from(s.users)
        .where(eq(sql`lower(${s.users.email})`, email.trim().toLowerCase()));
      return r ? this.userFrom(r) : null;
    },
    listByOrganization: async (organizationId: string) =>
      (await this.db.select({ doc: s.users.doc, passwordHash: s.users.passwordHash }).from(s.users).where(eq(s.users.organizationId, organizationId)).orderBy(asc(sql`lower(${s.users.doc}->>'name')`))).map((r) => this.userFrom(r)),
    insert: async (user: User) => {
      try {
        await this.db.insert(s.users).values(this.userRow(user));
      } catch (e) {
        translate(e);
      }
      return user;
    },
    update: async (id: string, patch: Partial<User>) => {
      try {
        return await this.atomic(async (db) => {
          const [cur] = await db.select({ doc: s.users.doc, passwordHash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, id)).for("update");
          if (!cur) throw notFound("User");
          const prev = this.userFrom(cur);
          const next: User = { ...prev, ...patch, id, organizationId: prev.organizationId };
          const { id: _id, ...values } = this.userRow(next);
          void _id;
          await db.update(s.users).set(values).where(eq(s.users.id, id));
          return next;
        });
      } catch (e) {
        translate(e);
      }
    },
  };

  roles = {
    get: async (id: string) => {
      const [r] = await this.db.select({ doc: s.roles.doc }).from(s.roles).where(eq(s.roles.id, id));
      return (r?.doc as Role) ?? null;
    },
    listByOrganization: async (organizationId: string) =>
      (await this.db.select({ doc: s.roles.doc }).from(s.roles).where(eq(s.roles.organizationId, organizationId)).orderBy(asc(s.roles.seq))).map((r) => r.doc as Role),
    insert: async (role: Role) => {
      try {
        await this.db.insert(s.roles).values({ id: role.id, organizationId: role.organizationId, key: role.key, doc: role, createdAt: role.createdAt, updatedAt: role.updatedAt });
      } catch (e) {
        translate(e);
      }
      return role;
    },
    update: async (id: string, patch: Partial<Role>) =>
      this.atomic(async (db) => {
        const [cur] = await db.select({ doc: s.roles.doc }).from(s.roles).where(eq(s.roles.id, id)).for("update");
        if (!cur) throw notFound("Role");
        const prev = cur.doc as Role;
        const next = { ...prev, ...patch, id, organizationId: prev.organizationId };
        await db.update(s.roles).set({ key: next.key, doc: next, updatedAt: next.updatedAt }).where(eq(s.roles.id, id));
        return next;
      }),
  };

  licenses = {
    getByOrganization: async (organizationId: string) => {
      const [r] = await this.db.select({ doc: s.licenses.doc }).from(s.licenses).where(eq(s.licenses.organizationId, organizationId));
      return (r?.doc as License) ?? null;
    },
    getByStripeCustomer: async (customerId: string) => {
      const [r] = await this.db.select({ doc: s.licenses.doc }).from(s.licenses).where(eq(s.licenses.stripeCustomerId, customerId));
      return (r?.doc as License) ?? null;
    },
    upsert: async (license: License) => {
      const values = {
        id: license.id,
        organizationId: license.organizationId,
        plan: license.plan,
        status: license.status,
        stripeCustomerId: license.stripeCustomerId ?? null,
        stripeSubscriptionId: license.stripeSubscriptionId ?? null,
        doc: license,
        createdAt: license.createdAt,
        updatedAt: license.updatedAt,
      };
      try {
        await this.db
          .insert(s.licenses)
          .values(values)
          .onConflictDoUpdate({ target: s.licenses.id, set: { plan: values.plan, status: values.status, stripeCustomerId: values.stripeCustomerId, stripeSubscriptionId: values.stripeSubscriptionId, doc: values.doc, updatedAt: values.updatedAt } });
      } catch (e) {
        translate(e);
      }
      return license;
    },
  };

  audit = {
    append: async (event: AuditEvent) => {
      await this.db.insert(s.auditEvents).values({
        id: event.id,
        organizationId: event.organizationId,
        companyId: event.companyId,
        at: event.at,
        actorId: event.actorId,
        actorName: event.actorName,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        summary: event.summary,
        doc: event,
      });
    },
    list: async (organizationId: string, q: AuditQuery = {}) => {
      const t = s.auditEvents;
      const parts: (SQL | undefined)[] = [eq(t.organizationId, organizationId)];
      if (q.companyId !== undefined) parts.push(q.companyId === null ? isNull(t.companyId) : eq(t.companyId, q.companyId));
      if (q.entityType) parts.push(eq(t.entityType, q.entityType));
      if (q.entityId) parts.push(eq(t.entityId, q.entityId));
      if (q.action) parts.push(or(eq(t.action, q.action), ilike(t.action, `${escapeLike(q.action)}.%`)));
      if (q.actorId) parts.push(eq(t.actorId, q.actorId));
      if (q.from) parts.push(gte(t.at, q.from));
      if (q.to) parts.push(lte(t.at, q.to));
      if (q.search) parts.push(ilike(sql`concat_ws(' ', ${t.summary}, ${t.actorName}, ${t.action})`, `%${escapeLike(q.search)}%`));
      const where = and(...parts);
      const [items, [{ n }]] = await Promise.all([
        this.db
          .select({ doc: t.doc })
          .from(t)
          .where(where)
          .orderBy(desc(t.at), desc(t.id))
          .limit(q.limit ?? 50)
          .offset(q.offset ?? 0),
        this.db.select({ n: count() }).from(t).where(where),
      ]);
      return { items: items.map((r) => r.doc as AuditEvent), total: Number(n) };
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

/** Document bytes stored in PostgreSQL (default production storage driver). */
export class DatabaseDocumentStorage {
  constructor(private readonly db: Db) {}
  async put(key: string, bytes: Uint8Array, mimeType: string) {
    await this.db
      .insert(s.documentBlobs)
      .values({ key, mimeType, size: bytes.byteLength, bytes, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: s.documentBlobs.key, set: { mimeType, size: bytes.byteLength, bytes } });
  }
  async get(key: string) {
    const [r] = await this.db.select({ bytes: s.documentBlobs.bytes }).from(s.documentBlobs).where(eq(s.documentBlobs.key, key));
    return r ? new Uint8Array(r.bytes) : null;
  }
  async delete(key: string) {
    await this.db.delete(s.documentBlobs).where(eq(s.documentBlobs.key, key));
  }
}
