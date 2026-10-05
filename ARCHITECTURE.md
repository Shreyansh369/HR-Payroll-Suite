# Architecture

```
 UI (React, Next.js App Router)
   │  useQ / useM hooks — src/client/api.ts
   ▼
 Transport ──────────────┬──────────────────────────────┐
   DemoTransport          │ HttpTransport                 │
   (in the browser)       │ POST /api/rpc/<procedure>     │
   ▼                      ▼                               │
 Procedures (src/services) — zod input · permission · entitlement · data scope · audit
   ▼
 Domain (src/domain) — pure, deterministic: payroll engine, rates, statutory, leave, preflight
   ▼
 Repository contract (src/repositories/interfaces)
   ├─ InMemoryRepository  ← BrowserRepository persists it to IndexedDB (demo)
   └─ DatabaseRepository  ← PostgreSQL via Drizzle (production)
```

## One service layer, two transports

Every operation is a named procedure in `src/services/procedures/*`, registered in
`src/services/registry.ts`:

```ts
"payroll.approve": mutation({
  input: z.object({ runId: idSchema, note: nonEmpty(500) }),
  permission: "payroll.approve",
  feature: "payroll",
  handler: async (ctx, input) => { … },
})
```

`execute(proc, ctx, raw)` parses input, checks the any-of permission and plan
entitlement, then runs the handler with a `Ctx`:

| Field | Demo | Production |
|---|---|---|
| `actor` | resolved from the demo session | resolved from the DB session on **every request** |
| `repo` | BrowserRepository | DatabaseRepository |
| `storage` | IndexedDB blobs | `document_blobs` table or local volume |
| `entitlements` | everything | from the licence, written only by Stripe webhooks |
| `meta` | — | IP and user agent for audit |

The UI never decides access. Hiding a button is cosmetic; the procedure rejects the call.

## Authorization

`Actor = user × role × company × data scope` (`src/services/authz.ts`).

- **Permissions** are explicit strings (`salary.view`, `payroll.approve`, …) grouped in
  `src/domain/auth/permissions.ts`. Seven system roles plus custom roles. A membership
  can add extra permissions (e.g. salary access for one HR manager in one company).
- **Company**: every tenant query is keyed by `actor.companyId`; repositories require a
  company id for every read and write, so cross-company access is structurally impossible.
- **Data scope**: `all`, `team` (manager's reporting tree plus assigned employees) or
  `self`. Out-of-scope records return NOT_FOUND so their existence is not revealed.
- **Redaction**: without `salary.view`, statutory IDs and bank details are masked and
  compensation is omitted server-side.

## Payroll engine

`calculateEmployeePayroll` (`src/domain/payroll/engine.ts`) is a pure function of its
inputs — employee, rate history, schedules, pay items, one-time inputs, approved
timesheets and leave, loans, statutory rules, YTD contributable bases, company settings.
Money uses decimal arithmetic (`src/lib/money.ts`). Each output line carries a
human-readable formula, and each result stores the calculation version and the exact
statutory rule ids used, so past payroll can be explained even after rules change.

Order of operations: rate segments (mid-period changes) → proration → hourly pay from
approved hours → overtime → unpaid leave (capped at regular pay) → recurring and
one-time earnings → pre-tax deductions → statutory (base, threshold, ceiling per period
or annual cumulative, age eligibility, employer tiers) → post-tax deductions and loans →
net.

`runPreflight` turns results into ERROR / WARNING / INFO issues. Errors block approval;
warnings must be acknowledged individually (audited).

Lifecycle: `draft → calculated → review → approved → finalized → locked`. Changing a
finalized run requires an audited reopen (only if nothing later is finalized) or a
correction run that references the original. In production the database itself refuses
to modify results of approved, finalized or locked runs.

## Persistence

Each record is stored as a JSON document plus **promoted columns** listed in
`src/repositories/spec.ts`. Only promoted fields can be filtered, sorted or ranged; both
implementations enforce this, and PostgreSQL indexes and constrains those columns.
`applyQuery` in the memory repository is the reference semantics; the contract tests
(`tests/integration/repository-contract.test.ts`) assert both implementations agree.

Sensitive employee fields are encrypted with AES-256-GCM before they reach PostgreSQL;
password hashes live in a column that is never part of the document.

## Production server

`src/server/*` (imports `server-only`):

- `auth.ts` — login, sessions (hashed tokens, idle + absolute expiry), DB-backed rate
  limits, password change, TOTP.
- `http.ts` — cookie helpers, same-origin check, JSON errors, `api()` wrapper that
  disables every endpoint in demo mode.
- `context.ts` — builds `Ctx` from the session.
- `billing.ts` — Stripe Checkout, Customer Portal, idempotent webhook application.
- `setup.ts` — first-run organisation and owner creation behind `SETUP_TOKEN`.
- `runtime.ts` — postgres-js pool, repository, storage driver.

Routes: `/api/auth/{login,logout,session,switch-company,password,two-factor}`,
`/api/rpc/[name]`, `/api/setup`, `/api/billing/{checkout,portal,webhook}`, `/api/health`.

## Demo mode

`DemoTransport` seeds data on first sign-in with `buildDemoSeed(today)`, which runs the
real procedures with a time-travelling clock to produce months of payroll history. State
is versioned (`STATE_VERSION`) so seed changes reseed automatically. Operations are
serialized through a queue so in-memory transactions never interleave.

## Exports

Reports (`src/domain/reports`, `src/services/procedures/reports.ts`) return typed rows
from authorized data; exporters in `src/lib/export` render CSV (BOM, formula-injection
guard), XLSX (exceljs) and PDF (pdf-lib). Payslips render to PDF and ZIP in the browser.
Every export is recorded in the audit log.

## Front end

Next.js 16 App Router, React 19, Tailwind CSS 4 design tokens in `globals.css`, Radix
primitives, Hugeicons, TanStack Query. The app shell is responsive down to phone width
(bottom-sheet drawers, collapsible sidebar) and keyboard accessible (⌘K command palette,
labelled form controls via `Field` context).
