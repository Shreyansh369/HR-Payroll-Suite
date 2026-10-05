# HR & Payroll Suite

HR and payroll software for small and multi-company businesses: employee records with
effective-dated history, leave, attendance, documents, onboarding, payroll with a full
approval lifecycle and correction runs, configurable statutory rules, payslips, 18
reports, spreadsheet import and QuickBooks-ready journals.

It runs in two modes from the same code:

| | Demo mode | Production mode |
|---|---|---|
| Data | Fictional companies, seeded in the browser (IndexedDB) | PostgreSQL |
| Server | None — procedures run in the browser | Next.js route handlers (`/api/*`) |
| Accounts | Six demo accounts, one shared password | Real users, scrypt passwords, optional 2FA |
| Billing | Pricing shown, checkout disabled | Stripe, when `BILLING_ENABLED=true` |

Both modes execute the **same service procedures** (validation, permissions, data scope,
audit) against the **same repository contract**. See [ARCHITECTURE.md](ARCHITECTURE.md).

> **Statutory rates are not included as fact.** New companies get clearly labelled draft
> placeholders. Enter official values with their source and have them approved by a
> qualified professional; production payroll cannot be finalized otherwise.

## Quick start (demo)

Requirements: Node.js 20+ and pnpm 10.

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

Open `/login` and pick an account. All demo accounts use the password
**`demo-payroll-2026`**:

| Role | Email | Sees |
|---|---|---|
| Owner | demo.admin@example.com | Everything, all three companies |
| HR Manager | demo.hr@example.com | People, leave, documents — no salaries |
| Payroll Officer | demo.payroll@example.com | Payroll preparation and approval |
| Supervisor | demo.supervisor@example.com | Their team's leave and timesheets — no salaries |
| Accountant / Auditor | demo.accountant@example.com | Read-only payroll, reports, journals, audit log |
| Employee | demo.employee@example.com | Only their own payslips, leave and details |

The seed is generated relative to today: three fictional companies (Harbourview
Hospitality, Tortola Marine Services, Cedar Point Advisory), 44 employees, several
months of payroll produced by the real payroll procedures, a correction run, a payroll
in review with warnings, leave, timesheets, documents and an imported history. Use
**Account menu → Reset demo data** to start over. Nothing leaves the browser.

## Production

```bash
cp .env.example .env.local           # set DEMO_MODE=false and the production values
node scripts/generate-secrets.mjs    # DATA_ENCRYPTION_KEY and SETUP_TOKEN
pnpm db:migrate                      # needs DATABASE_URL
pnpm build && pnpm start
```

Then open `/setup`, enter the `SETUP_TOKEN`, and create the organisation, first company
and owner. Work through **Settings → Go-live** before running live payroll.

Full instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Billing:
[docs/STRIPE.md](docs/STRIPE.md).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm typecheck` | TypeScript, strict |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit and integration tests (Vitest), including PostgreSQL via PGlite |
| `pnpm test:e2e` | Playwright end-to-end tests (builds and starts the demo on port 3300) |
| `pnpm db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm check` | typecheck + lint + test + build |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — layers, transports, authorization, payroll engine
- [DATA_MODEL.md](DATA_MODEL.md) — entities, tables, constraints
- [DECISIONS.md](DECISIONS.md) — design decisions; items marked **[BUSINESS]** need confirmation
- [TEST_PLAN.md](TEST_PLAN.md) — what is tested and how to run it
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosting, migrations, backups, key management
- [docs/STRIPE.md](docs/STRIPE.md) — products, prices, webhooks, test mode

## Project layout

```
src/
  app/                 Next.js routes: marketing (/), legal, /login, /setup, /app/*, /api/*
  components/          UI kit (ui/), app shell, feature components
  client/              Transports (demo in-browser, HTTP) and React hooks
  services/            Procedures: validation, permissions, scope, audit (shared by both modes)
  domain/              Pure logic: payroll engine, rates, statutory, leave, preflight, reports
  repositories/        Contract + memory, browser (IndexedDB) and PostgreSQL implementations
  server/              Production only: auth, sessions, crypto, billing, setup, runtime
  db/schema.ts         Drizzle schema (migrations in /drizzle)
  config/              Pricing, defaults, public env
tests/unit|integration|e2e
```

## Known limitations

- Statutory rules must be entered and approved by the customer; no rates are bundled as fact.
- No government e-filing or bank payment files; reports and journals are exported for those systems.
- Document storage drivers: PostgreSQL or local volume (no S3 driver yet).
- Stripe does not support merchants based in the British Virgin Islands; the merchant entity must be confirmed (see DECISIONS.md D-016).
- Legal pages are templates that must be completed and reviewed by counsel.
