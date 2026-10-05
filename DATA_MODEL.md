# Data model

Types: `src/domain/types.ts`. PostgreSQL schema: `src/db/schema.ts`, migrations in
`/drizzle`. Query contract: `src/repositories/spec.ts`.

## Storage pattern

Every business table has:

- `id text primary key`
- `company_id text not null references companies` (company-scoped tables)
- `doc jsonb not null` — the complete entity (sensitive fields encrypted)
- **promoted columns** — typed copies of the fields used for filtering, sorting,
  uniqueness and foreign keys, derived from `doc` on every write
- `created_at`, `updated_at timestamptz`

This keeps the domain model flexible (nested pay profiles, payroll lines, rule tiers)
while the database still enforces the invariants that matter.

## Organisation level

| Table | Key columns | Notes |
|---|---|---|
| `organizations` | `kind` | check `kind = 'customer'` — demo data can never be stored |
| `companies` | `organization_id`, `legal_name` | settings, calendars, holidays, account mappings, setup checklist in `doc` |
| `users` | `email` (unique, case-insensitive), `status`, `password_hash` | memberships `[{companyId, roleId, scope, employeeId, assignedEmployeeIds, extraPermissions}]` in `doc`; hash never in `doc` |
| `roles` | `(organization_id, key)` unique | explicit permission list and default scope |
| `licenses` | one per organisation; `stripe_customer_id` unique | plan, status, trial/maintenance dates; written only by verified webhooks |
| `audit_events` | `organization_id`, `company_id`, `at`, `action`, `entity_type`, `entity_id` | **append-only** (trigger); before/after/reason/meta in `doc` |

## Company-scoped records

| Table | Promoted columns | Constraints |
|---|---|---|
| `departments` | name, code, parent_id | unique `(company_id, lower(code))` |
| `employees` | employee_code, names, email, position, status, employment_type, department_id → departments, manager_id, work_location, hire_date, termination_date, date_of_birth, leave_policy_id, user_id | unique `(company_id, lower(employee_code))`; status and type enums; termination ≥ hire |
| `employment_events` | employee_id → employees, effective_date, type | hire, promotion, transfer, pay change, termination… (scheduled future events allowed) |
| `pay_rates` | employee_id, effective_from, pay_type, pay_frequency | effective-dated; amount + basis in `doc` |
| `work_schedules` | employee_id, effective_from | work days and hours per day |
| `pay_items` | employee_id, kind, category, active, start_date, end_date | recurring earnings/deductions; end ≥ start |
| `loans` | employee_id, type, status, start_date, reference | repayment plan and repayments in `doc` |
| `leave_types` | code, name, category, active | unique `(company_id, lower(code))` |
| `leave_policies` | name, is_default | per-type entitlement, accrual, carry-forward |
| `leave_ledger` | employee_id, leave_type_id → leave_types, date, kind, request_id | allocation, carry_forward, adjustment, expiry, taken, reversal — never deleted |
| `leave_requests` | employee_id, leave_type_id, start_date, end_date, status | end ≥ start; status enum |
| `timesheets` | employee_id, date, status, absent | hours, overtime, approval in `doc` |
| `attendance_corrections` | employee_id, date, status, entry_id | requested change and decision |
| `documents` | employee_id, category, expiry_date, visibility, title | bytes in `document_blobs` or on disk; checksum in `doc` |
| `workflows` | employee_id, type, status, start_date | onboarding/offboarding tasks |
| `statutory_rules` | code, type, status, effective_from, effective_to, jurisdiction | status ∈ draft/approved/retired; effective_to ≥ effective_from; rates, ceiling, threshold, eligibility, tiers, source and approval in `doc` |
| `payroll_runs` | type, pay_frequency, period_start, period_end, pay_date, status, corrects_run_id → payroll_runs | **one regular run per (company, frequency, period)**; period_end ≥ period_start; run cannot be deleted once approved (trigger) |
| `payroll_results` | run_id → payroll_runs, employee_id → employees, pay_date, period_start, period_end, run_type | unique `(run_id, employee_id)`; immutable once the run is approved (trigger); lines with formulas, statutory applications, warnings and employee snapshot in `doc` |
| `import_batches` | entity, status, file_name | totals and row errors for traceability |

## Platform tables

| Table | Purpose |
|---|---|
| `sessions` | SHA-256 of the session token, user, current company, expiry, IP, user agent |
| `rate_limits` | fixed-window counters for sign-in, setup and password changes |
| `document_blobs` | document bytes (default storage driver) |
| `stripe_events` | processed webhook ids for idempotency |

## Encryption at rest

Encrypted inside `doc` with AES-256-GCM (`DATA_ENCRYPTION_KEY`), format
`enc:v1:<iv>.<tag>.<ciphertext>`:

- `employees.statutoryIds.{socialSecurityNumber, nhiNumber, taxId}`
- `employees.payProfile.bankAccount`
- `users.twoFactor.secretEncrypted`

Payroll results store a masked bank account only.

## Money and dates

Amounts are numbers rounded to cents by decimal arithmetic in the engine; dates are ISO
`YYYY-MM-DD` strings (`date` columns), timestamps ISO-8601 UTC (`timestamptz`).

## Changing the schema

1. Edit `src/db/schema.ts` (and `src/repositories/spec.ts` if a field becomes queryable).
2. `pnpm db:generate` and review the SQL in `/drizzle`.
3. `pnpm test` — contract tests run the new migration in PGlite.
4. Bump `STATE_VERSION` in `src/repositories/memory/memory-repository.ts` if demo data changes shape.
