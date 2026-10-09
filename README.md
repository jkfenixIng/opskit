# OpsKit

A private, generic operations template for inventory, invoicing, payments, cash sessions, people, offerings, compensation, and organization policy. It is intentionally free of company-specific rules and external backend services.

## Start

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
```

For separate processes while debugging:

```bash
npm run dev:api
# in another terminal
npm run dev:web
```

Open `http://localhost:3000`. The seed uses the `DEMO_ADMIN_EMAIL` and `DEMO_ADMIN_PASSWORD` values from `.env`; set your own values before any shared use.

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## Architecture

- `packages/core` contains framework- and database-independent domain policies, use cases, and ports.
- `packages/sqlite` implements the ports with Node 24's built-in `node:sqlite` and applies local migrations. This avoids native add-ons, is compatible with the declared Node 24 runtime, and keeps the template dependency-light.
- `packages/contracts` owns HTTP request schemas shared by API and web.
- `packages/config` parses runtime environment configuration.
- `apps/api` is a thin Fastify REST API under `/v1`. It accepts Bearer sessions and secure HTTP-only cookie sessions; cross-origin cookie mutations are rejected.
- `apps/web` is a minimal Next.js UI that talks only to the REST API proxy. It never imports SQLite.

`OrganizationSettings` is the policy boundary: currency, time zone, payment methods, enabled modules, stock behavior, invoice behavior, and role permissions are data rather than embedded company rules.

## API overview

- `POST /v1/auth/login`, `GET /v1/auth/session`, `POST /v1/auth/logout`
- `GET|PUT /v1/settings`
- `GET /v1/dashboard`
- `GET|POST /v1/products`, `POST /v1/products/:id/movements`
- `GET|POST /v1/invoices`, `POST /v1/invoices/:id/payments`
- `GET|POST /v1/tills`, `GET /v1/till-sessions`, `POST /v1/till-sessions/open`, `POST /v1/till-sessions/:id/operations`, `POST /v1/till-sessions/:id/close`
- `GET|POST /v1/people`, `GET|POST /v1/offerings`
- `GET /v1/alerts`, `GET /v1/audit-events`
- `GET|POST /v1/compensation/plans`, `GET|POST /v1/compensation/assignments`
- `GET|POST /v1/compensation/pay-periods`, `POST /v1/compensation/pay-periods/:id/calculate`, `POST /v1/compensation/pay-periods/:id/close`
- `GET /v1/compensation/items`
- `GET|POST /v1/compensation/advances`, `POST /v1/compensation/advances/:id/approve`, `POST /v1/compensation/advances/:id/reject`
- `GET|POST /v1/compensation/payouts`

## Compensation engine

Compensation contains no country, sector, or legal rules. Everything is configured as data:

- **Plans** combine components. `fixed` pays an amount per period. `percentage` pays basis points of the sales attributed to the person, on a `gross` (tax-inclusive) or `net` base. A mixed plan is simply several components. The optional `minimumGuarantee` rule tops variable earnings up to a floor; fixed pay is added on top. New component or rule types are registered in a `CompensationEngine` strategy map; the calculation flow does not change.
- **Attribution**: invoice lines may carry an optional `performerId`. With `operations.compensation.immediateCommission` enabled, commissions are fixed at sale time and used instead of recomputing them at period end.
- **Pay periods** follow a `weekly`, `biweekly`, `monthly` or `customDays` cadence with a configurable start day or anchor date. Status moves `draft → calculated → closed`. Calculating again is allowed until the period closes. Periods of the same cadence cannot overlap for a person. A closed period, its item, and its deductions are immutable; SQLite triggers enforce this as well.
- **Rounding** follows `operations.compensation.rounding` (`halfUp`, `halfEven`, `down`, `up`; to the `minor` unit or a whole `major` unit derived from `currency.minorUnits`). The arithmetic is exact integer math.
- **Advances** are requested against the open period that contains today and are approved or rejected by roles with `compensation:approve`. Optional limits apply per request, per period, and as a share of estimated earnings. The outstanding-balance policy is either `carryOver` (the unrecovered balance counts against the next period and keeps being deducted) or `block` (no new requests while a balance is carried over). Deductions never make net pay negative.
- **Payouts** pay a closed item fully or partially (as configured) with an enabled payment method from settings. Overpayment is rejected. An idempotency key makes retries safe.
- Calculations, closes, advance decisions, and payouts write audit events in the same transaction.

Permissions: `compensation:read`, `compensation:write` (plans, assignments, periods, calculation, advance requests), and `compensation:approve` (close, advance decisions, payouts). By default only owners can approve. Settings saved by an earlier version load with the compensation module disabled and safe policy defaults.

## Persistence

`packages/sqlite` uses Drizzle ORM only as the typed query layer over Node 24's existing `node:sqlite` `DatabaseSync` client. Core, API, and web do not import an ORM. The explicit SQL migrations, schema bootstrap, foreign keys, checks, indexes, and triggers remain the physical authority and guardrails; Drizzle does not generate or apply migrations.

### Migration checksums

Each migration has explicit canonical content: its id, SQL, and ordered `checksumParts`. SQLite stores `v2:<sha256>` calculated only from that content; source paths, environment, and function serialization are excluded. Databases without a checksum column or values are backfilled to v2. A stored unprefixed v1 value is promoted only after it exactly matches the historical `id + sql + apply.toString()` checksum for that migration. Any other unprefixed value fails with an instruction to restore the historical definition or manually review and replace it with the displayed v2 value; it is never silently overwritten. A mismatched `v2:` value always fails.

## Local data

SQLite data defaults to `./data/opskit.db`, which is ignored by git. No remote is configured and no external backend is required.
