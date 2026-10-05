# Deployment

## Demo deployment

Any Node.js host or static-friendly platform that runs Next.js. No database, no secrets.

```bash
DEMO_MODE=true pnpm build
pnpm start
```

The server API answers 404 in demo mode; all data lives in each visitor's browser.

## Production deployment

### Requirements

- Node.js 20 or newer, pnpm 10
- PostgreSQL 14 or newer (tested with 16)
- HTTPS in front of the app (reverse proxy or platform TLS)
- A secret store for `DATA_ENCRYPTION_KEY` and `SETUP_TOKEN`

### 1. Configure

Copy `.env.example` and set at least:

| Variable | Value |
|---|---|
| `DEMO_MODE` | `false` |
| `APP_URL` | public HTTPS URL, e.g. `https://payroll.example.com` |
| `DATABASE_URL` | `postgres://user:password@host:5432/db` (use `?sslmode=require` for managed databases) |
| `DATA_ENCRYPTION_KEY` | output of `node scripts/generate-secrets.mjs` |
| `SETUP_TOKEN` | output of `node scripts/generate-secrets.mjs` |

`DEMO_MODE` and `BILLING_ENABLED` are read at **build time** for the browser bundle, so
set them before `pnpm build`.

### 2. Migrate

```bash
DATABASE_URL=… pnpm db:migrate
```

Run this on every release before starting the new version. Migrations are additive and
tracked in the `drizzle` schema.

### 3. Build and run

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start --port 3000
```

Health check: `GET /api/health` returns `{"status":"ok","database":"ok"}` or HTTP 503.

### 4. First-run setup

Open `https://your-host/setup`, enter the `SETUP_TOKEN`, organisation, first company and
owner account. Setup is refused once an organisation exists. Then:

1. **Settings → Company**: legal details and employer registration numbers.
2. **Settings → Payroll & calendars**: daily-rate method, proration, overtime, rounding,
   pay calendars and public holidays — confirm with your accountant.
3. **Statutory rules**: replace the draft placeholders with official rates, record the
   source, and approve. Payroll cannot be finalized until this is done.
4. **Import data**: employees, pay rates, opening leave balances, prior payroll history.
5. **Accounting export**: map payroll lines to your chart of accounts.
6. **Settings → Users & roles**: invite colleagues with the least access they need.
7. Run one parallel payroll and reconcile before going live.

### Reverse proxy

- Forward `Host` (or `X-Forwarded-Host`) and `X-Forwarded-For`. Set `TRUST_PROXY=false`
  if the app is exposed directly, so client-supplied headers are ignored.
- Allow request bodies up to 15 MB (document uploads are capped at 8 MB before base64).

### Documents

`STORAGE_DRIVER=database` (default) keeps document bytes in PostgreSQL, so one backup
covers everything. `STORAGE_DRIVER=local` writes to `STORAGE_DIR`, which must be a
persistent volume included in backups.

## Backups and recovery

- Take automated daily PostgreSQL backups with point-in-time recovery where available.
- Back up `DATA_ENCRYPTION_KEY` separately from database backups. **Without the key,
  encrypted identifiers and bank accounts cannot be recovered.**
- Test a restore into a separate database at least quarterly.

## Key rotation

The encryption format is versioned (`enc:v1:`). To rotate, deploy a build that reads
the old key and writes with the new one, then re-save employees (an admin script is not
included yet). Until then, treat the key as long-lived and tightly held.

## Sessions and security settings

- `SESSION_TTL_HOURS` (default 12) is the idle timeout; sessions also expire 7 days after
  sign-in.
- Sessions, rate limits and Stripe events are stored in PostgreSQL, so the app can run on
  several instances behind a load balancer without sticky sessions.
- Security headers (CSP, HSTS, frame denial) are configured in `next.config.ts`.

## Upgrading

1. Back up the database.
2. Deploy the new code, run `pnpm db:migrate`, then restart.
3. Check `/api/health` and sign in.

## Self-hosted ownership installs

Leave `BILLING_ENABLED=false`. All features are enabled and no licence record is needed.
