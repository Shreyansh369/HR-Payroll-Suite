# Test plan

| Layer | Tool | Location | Command |
|---|---|---|---|
| Unit (pure domain) | Vitest | `tests/unit` | `pnpm test` |
| Integration (procedures + repositories, memory **and** PostgreSQL) | Vitest + PGlite | `tests/integration` | `pnpm test` |
| End to end (browser) | Playwright | `tests/e2e` | `pnpm test:e2e` |
| Static | TypeScript strict, ESLint | — | `pnpm typecheck`, `pnpm lint` |

`pnpm check` runs typecheck, lint, unit/integration tests and a production build.

## Unit tests (57)

- **Payroll acceptance scenario** — monthly salary 2,000; two unpaid sick days; 4 h
  overtime; bonus 100; deduction 50 → gross 1,984.61, statutory 245.90, net 1,688.71,
  employer cost 2,171.37. The statutory values in `tests/unit/fixtures.ts` are **test
  values, not legal rates**; replace them with an accountant-approved fixture once rates
  are confirmed.
- Determinism (same inputs → identical output), proration for starters, leavers and
  mid-period rate changes (working-day and calendar-day methods), unpaid leave capped at
  regular pay, partial-day leave, hourly pay from approved timesheets only, overtime
  multiplier, recurring and one-time items, loans, pre-tax deductions.
- Statutory: effective-date selection (drafts and retired ignored), per-period and
  annual cumulative ceilings, exempt thresholds and minimums, age eligibility, employer
  tiers by headcount, rounding.
- Rates: equivalents for every basis, the three daily-rate methods, rounding boundaries.
- Leave quantities across weekends and holidays, ledger balances with accrual,
  carry-forward and scheduled leave; pay calendars for all frequencies; pre-flight.

## Integration tests (44)

- **Workflows on both repositories** (`workflows.test.ts`, 12 scenarios × memory and
  PostgreSQL): seed shape; supervisor salary restriction and team scope; employee self
  scope; cross-company access blocked; HR without payroll access; unpaid leave → payroll
  deduction; supervisor leave approval and balance update; full lifecycle including
  correction runs and locked-run protection; recalculation determinism; balanced
  QuickBooks journals and all 18 reports; import with row errors and duplicates;
  document upload validation (disguised executable rejected) and download scope.
- **Repository contract** (`repository-contract.test.ts`): identical filtering, IN, null,
  range, overlap, search, ordering and paging; tenant isolation; uniqueness messages;
  transaction rollback; case-insensitive user email; audit filtering. PostgreSQL-only:
  encryption at rest, password hash never in documents, audit append-only, demo
  organisations rejected, finalized payroll immutable, date checks.
- **Production server** (`server.test.ts`): setup token, single-use setup and draft
  rules; login, session expiry, audited failures; account rate limiting and reset;
  TOTP enrolment and login; password change revoking other sessions; cross-organisation
  company switch blocked; production procedures (initial password hashing, encrypted
  identifiers, draft-only rules blocking payroll); billing entitlements; Stripe webhook
  idempotency, trial end calculation, ownership activation, no downgrade of ownership,
  unpaid checkout ignored.
- **Exports** (`exports.test.ts`): payslip PDF and ZIP, YTD totals.

## End-to-end scenarios (18)

| # | Scenario | Spec |
|---|---|---|
| 1 | Admin login | `hr.spec.ts` |
| 2 | Company switch | `hr.spec.ts` |
| 3 | Employee creation | `hr.spec.ts` |
| 4 | Employee import (row errors, rejected rows download) | `hr.spec.ts` |
| 5 | Leave request (self-service) | `hr.spec.ts` |
| 6 | Leave approval (supervisor) | `hr.spec.ts` |
| 7 | Unpaid leave → payroll deduction | `payroll.spec.ts` |
| 8 | Payroll calculation with formulas | `payroll.spec.ts` |
| 9 | Payroll review and warning acknowledgement | `payroll.spec.ts` |
| 10 | Payroll approval with note | `payroll.spec.ts` |
| 11 | Finalize and lock | `payroll.spec.ts` |
| 12 | Payslips (run ZIP, employee PDF) | `payroll.spec.ts` |
| 13 | Report export CSV / XLSX / PDF | `payroll.spec.ts` |
| 14 | Supervisor salary restriction | `hr.spec.ts` |
| 15 | Employee self-service restriction | `hr.spec.ts` |
| 16 | Demo reset | `hr.spec.ts` |
| 17 | Production auth (bad password, CSRF, cookie flags) | `production.spec.ts` — needs `E2E_PRODUCTION_URL`, `E2E_PRODUCTION_EMAIL`, `E2E_PRODUCTION_PASSWORD` |
| 18 | Stripe checkout redirect, success page does not grant access | `production.spec.ts` — also needs `E2E_STRIPE=1` and Stripe test keys |

Run against an existing server with `E2E_BASE_URL=http://localhost:3000 pnpm test:e2e`.
Without it, Playwright builds and starts the demo on port 3300. In environments with a
preinstalled Chromium set `PLAYWRIGHT_CHROMIUM_PATH`.

## Manual checks before a release

- [ ] Desktop (1440), tablet (768) and phone (390) layouts of dashboard, employee
      profile, payroll run, leave, self-service and marketing pages; no horizontal scroll.
- [ ] Production smoke test: `pnpm db:migrate`, `/setup`, sign in, enable 2FA, create an
      employee, calculate a payroll (expect the draft-rule error until rules are approved).
- [ ] Stripe test mode: hosted checkout, trial end date, setup fee on first invoice,
      ownership checkout, webhook delivery and the licence change in Billing.
- [ ] Statutory rule values approved by a qualified professional and recorded with source.
- [ ] Legal templates completed and reviewed by counsel.
