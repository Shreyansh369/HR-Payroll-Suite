# Decisions log

Each entry records a choice, why it was made, and how to reverse it. Business-rule
assumptions are flagged **[BUSINESS]** and must be confirmed by the client or their
payroll/accounting professional before production activation.

---

## D-001 Framework and tooling

- Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS 4, pnpm.
- Vitest for unit/integration tests, Playwright for end-to-end tests.
- Turbopack (Next 16 default) for dev and build.
- The repository was empty, so a fresh `create-next-app@16.3.8` scaffold was used.

## D-002 One service layer, two transports

All business operations are **procedures**: `(ctx, input) => output`, with a Zod
input schema, an explicit permission requirement and optional entitlement
requirement. `ctx` carries the authenticated actor, a repository, a document
storage adapter and a clock.

- **Demo mode** (`NEXT_PUBLIC_DEMO_MODE=true`): procedures run in the browser
  against `BrowserRepository` (IndexedDB, falling back to memory). The demo session
  is stored locally.
- **Production mode**: the browser calls `POST /api/rpc/<procedure>`. The route
  handler resolves the session cookie into an actor, builds a
  `DatabaseRepository` (PostgreSQL via Drizzle) and runs the *same* procedure.

UI code calls `api.call(name, input)` and never knows which transport is used.
Authorization lives inside procedures/services, so a production request that bypasses
the UI still hits the same checks.

Reversal: procedures are plain functions; they can be mounted as Server Actions or a
different HTTP layer without changing business logic.

## D-003 Mode is a deployment setting, not a per-request toggle

A deployment is either a demo deployment or a production deployment. The public
sales site runs with demo mode on; each customer deployment runs with demo mode off.
This makes it structurally impossible for demo users to read production data
(the demo build never constructs a database repository).

## D-004 Persistence: document rows with promoted, constrained columns

The production schema stores each aggregate as a `data jsonb` document plus
*promoted columns* used for tenancy, filtering, uniqueness and foreign keys
(`company_id`, `employee_id`, `employee_code`, `status`, period dates, etc.).

Why: the same generic repository contract can be implemented by the in-memory,
browser and SQL repositories with identical semantics, while PostgreSQL still enforces
the important constraints:

- unique employee code per company
- one regular payroll run per company/frequency/period
- foreign keys from every tenant row to `companies`, and employee rows to `employees`
- `effective_to >= effective_from` checks on effective-dated rows
- append-only `audit_log` (UPDATE/DELETE blocked by trigger)

Reversal: any collection can be normalised into dedicated columns later without
changing the repository interface.

## D-005 Money arithmetic

All calculations use `decimal.js-light` with 28 significant digits; amounts are rounded
to 2 decimals only at defined points (each payroll line, each statutory amount). The
rounding mode is configurable per company and per statutory rule
(`half_up`, `half_even`, `down`, `up`). Default: `half_up`. **[BUSINESS]**

## D-006 Rate conversion methodology is configurable **[BUSINESS]**

There is no universal daily-rate formula. Each company chooses:

| Setting | Options | Default |
| --- | --- | --- |
| `weeksPerYear` | number | `52` |
| `dailyRateMethod` | `annual_working_days` (annual ÷ (days/week × weeks/year)), `fixed_days_per_month` (monthly ÷ N), `calendar_days` (annual ÷ 365 or 366) | `annual_working_days` |
| `fixedDaysPerMonth` | number | `21.67` |
| `prorationMethod` | `working_days`, `calendar_days` | `working_days` |
| `overtimeMultiplier` | number | `1.5` |
| `hourlyFallbackToSchedule` | pay scheduled hours when no approved timesheet exists | `false` |

The selected formula is displayed next to every calculated rate and stored in each
payroll result snapshot.

## D-007 Statutory rules are data, not code **[BUSINESS]**

Statutory rules (Social Security, NHI, Payroll Tax) are effective-dated records with
rates, base, ceilings, thresholds, exemptions, rounding, source reference and approval
metadata. The engine is generic; it does not contain BVI numbers.

The demo dataset ships with **illustrative** rule values marked `status: "demo"` and
a source note "Illustrative values for demonstration only — not verified". In
production mode a payroll run cannot be **finalized** while any applied rule is not
`approved`. Values must be supplied and approved by the client's accountant.

Rule selection date basis is configurable per company: `period_end` (default) or
`pay_date`. **[BUSINESS]**

Each payroll result stores a snapshot of the rule versions it used, so adding a new
rule never changes historical results.

## D-008 Payroll lifecycle and corrections

`DRAFT → CALCULATED → REVIEW → APPROVED → FINALIZED → LOCKED`.

- Inputs can only change in DRAFT/CALCULATED/REVIEW (changing them returns the run
  to CALCULATED-needed state).
- APPROVED requires zero ERROR pre-flight issues and acknowledgement of every WARNING.
- FINALIZED freezes results; loans repayments and YTD are counted from FINALIZED and
  LOCKED runs.
- LOCKED cannot be edited. Changes are made with a **correction run**
  (`type: "correction"`, `correctsRunId`) that carries explicit adjustment lines and a
  mandatory reason.
- Reopen (LOCKED/FINALIZED → REVIEW) requires `payroll.reopen`, a reason, and is only
  allowed when no correction run references the run and no later run for the same
  frequency is finalized. Every transition is audited.

## D-009 Unpaid leave and absences

- Approved leave of a type marked `paid: false` becomes a payroll deduction for
  salaried employees: `working days in period × daily rate` (or hours × hourly rate
  for hour-measured types). Only the portion overlapping the period is counted;
  weekends per the employee schedule and company holidays are excluded.
- Hourly employees are paid for approved hours worked, so unpaid leave produces an
  informational line, not a deduction.
- Attendance absences without approved leave raise a pre-flight WARNING; they are not
  auto-deducted. **[BUSINESS]**

## D-010 Attendance feeds payroll

Approved timesheet entries supply regular hours (hourly employees) and overtime hours
(all employees). Unapproved overtime is not paid and raises a WARNING. One-time
overtime inputs on a payroll run are only for adjustments and are labelled as such, to
avoid duplicate data entry.

## D-011 Authorization model

Decision = user + role + company + data scope + permission.

- Roles are data (`roles` collection) seeded with the seven system roles; each
  membership (`user × company`) has one role, a data scope (`all`, `team`, `self`)
  and optional extra grants.
- `team` scope = current direct and indirect reports of the user's linked employee
  plus explicitly assigned employees.
- Salary fields are stripped from employee/payroll responses unless the actor has
  `salary.view`; payroll procedures require `payroll.view`.
- Helpers: `assertPermission`, `assertCompanyAccess`, `assertEmployeeScope`.

## D-012 Exports are generated from authorized data

Reports, payslip PDFs, ZIP bundles, XLSX and CSV files are rendered from data returned
by authorized procedures (which also write an `export.generated` audit event). Rendering
is a pure function that runs in the browser in both modes, so demo and production share
one implementation. Documents (uploaded files) use procedures that move bytes through the
storage adapter, so production downloads are always authorized server-side.

## D-013 Documents

Max upload 8 MB. Allowed types: PDF, PNG, JPEG, WebP, plain text, CSV, DOCX, XLSX.
The server validates the declared MIME type *and* magic bytes. Demo stores bytes in
IndexedDB; production stores bytes in PostgreSQL (`document_blobs`, default) or on a
persistent volume (`STORAGE_DRIVER=database|local`). An S3-compatible driver is a small
addition behind the same `DocumentStorage` interface but is not included; at an 8 MB
cap and small-business volumes, database storage keeps backups to a single system.

## D-014 Sessions and passwords (production)

- Passwords: `scrypt` (N=2^15, r=8, p=1, 64-byte key, per-user salt).
- Sessions: random 32-byte token in an `HttpOnly; Secure; SameSite=Lax` cookie; only
  the SHA-256 hash is stored. 12-hour idle expiry, 7-day absolute expiry.
- CSRF: all state-changing requests are `POST` with `application/json`, and the `Origin`
  header (or `Sec-Fetch-Site`) must match `APP_URL` or the request host. Combined with
  SameSite=Lax this blocks cross-site form and fetch attacks without tokens.
- Login rate limits are stored in PostgreSQL (`rate_limits`) so they hold across
  instances: 30 attempts per 15 minutes per IP and 8 per account; the account counter
  resets on success. Failed sign-ins of existing accounts are audited.
- First-run setup (`/setup`) creates the organisation and owner only while the database
  has no organisation, and only with the deployer's `SETUP_TOKEN`.
- 2FA: TOTP (RFC 6238) enrolment and verification; secrets encrypted with
  `DATA_ENCRYPTION_KEY`.

## D-015 Sensitive identifiers

Statutory identifiers and bank account numbers are encrypted at rest in production
(AES-256-GCM with `DATA_ENCRYPTION_KEY`) and masked in list views. Demo data contains
synthetic identifiers only.

## D-016 Billing

- Feature flag `BILLING_ENABLED`. Off in demo; the pricing page renders and explains that
  checkout is disabled in the demo.
- Stripe Checkout (subscription with 7-day trial + one-time setup fee line; or one-time
  ownership payment), Customer Portal, verified webhooks. Entitlements change **only**
  from webhooks.
- Prices live in `src/config/pricing.ts`; savings are computed, never typed.
- Stripe does not currently support businesses based in the British Virgin Islands. The
  merchant entity and its Stripe account country must be confirmed before enabling
  production billing. **[BUSINESS]**

## D-017 Hosted plan billing start **[BUSINESS]**

`plan.md` mentions "no recurring subscription charge during the first two post-purchase
calendar months if that is the final commercial promise". This is a configuration value
(`hosted.subscriptionFreeMonthsAfterPurchase`, default `2`) used by the comparison
calculator and Checkout. Checkout sets `subscription_data.trial_end` to the later of
the trial end and purchase + N calendar months (`hostedTrialEnd`), and adds the setup
fee as a one-time line on the first invoice. Verify the exact charging behaviour in
Stripe test mode before going live. It must match the final contract.

## D-018 Icons and typography

- Hugeicons free Stroke Rounded set (commercial use permitted by its licence). All icons
  are imported individually through `src/components/ui/icon.tsx`. No Lucide.
- IBM Plex Sans (UI) and IBM Plex Mono (identifiers), self-hosted through Fontsource so
  builds need no network access.

## D-019 Leave balances

Balances are computed from a ledger (`allocation`, `carry_forward`, `adjustment`,
`expiry`, `taken`) plus on-the-fly accrual for policies configured as monthly accrual.
Taking leave writes a `taken` ledger entry when the request is approved; cancellation of
an approved request writes a reversing entry. History is never deleted.

## D-020 Historical payroll import

Historical payroll rows are imported as `historical` payroll runs in `LOCKED` state so
that YTD totals and reports include pre-system payroll without fabricating line detail.

## D-021 Draft-only statutory rules block production payroll

Draft rules are ignored by the engine, so a company whose only rule for a code is a
draft would otherwise calculate *no* deduction silently. Pre-flight raises
`RULE_DRAFT_ONLY_<code>` (error in production, warning in demo) whenever a draft covers
the period and no approved rule does. New production companies start with draft
placeholders, so live payroll is impossible until someone verifies and approves rates.

## D-022 Integrity enforced by the database

Beyond application checks, PostgreSQL enforces: unique employee codes per company,
one regular run per company/frequency/period, one result per run and employee, date
order checks, status enumerations, demo organisations rejected (`kind = 'customer'`),
an append-only audit log, and immutability of results of approved/finalized/locked
runs (triggers in `drizzle/0001_integrity.sql`). The memory repository mirrors the
uniqueness rules so the demo behaves the same.

## D-023 Every workflow is tested against both repositories

`tests/integration/workflows.test.ts` runs each scenario against the in-memory
repository and against PostgreSQL (PGlite with the real migrations). This caught a
procedure writing outside its own transaction, which is invisible in memory.

## D-024 No fake integrations in the marketing site

The contact form composes an email in the visitor's mail client rather than posting to
a backend that does not exist. Pricing buttons in the demo lead to contact, not to a
checkout that cannot complete. Legal pages are templates, labelled as not in force
until reviewed by counsel, with bracketed placeholders for operator details.
