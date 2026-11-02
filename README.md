# Transaction Reconciliation System

Transaction Reconciliation System implemented with Node.js and TypeScript, SQLite, and React. The repository is organized as an npm workspace with an API package and a web app. The API applies a versioned SQLite schema at startup and can seed the supplied transaction examples; reconciliation features are not implemented yet.

## Development setup

### Prerequisites

- Node.js 26 or newer (`.nvmrc` selects the Node 26 line).
- npm 10 or newer.

### Install and run

From the repository root:

```sh
npm install
npm run dev
```

The React app is served at <http://localhost:5173>. The API listens at <http://localhost:3000>, and <http://localhost:3000/health> checks that the API can query SQLite. `npm run dev` starts both services and stops them together.

To start one service only, run `npm run dev:web` or `npm run dev:api`. The API creates `apps/api/data/reconciliation.db` on first start. Copy `.env.example` to `.env` at the repository root to set `PORT` or `SQLITE_PATH`; those values default to `3000` and `./data/reconciliation.db`. A relative `SQLITE_PATH` is resolved from the API package directory. The database and local environment files are ignored by Git.

### Project layout

- `apps/web` — React, TypeScript, and Vite frontend.
- `apps/api` — Express, TypeScript, Prisma, and SQLite backend.
- `apps/api/sql/migrations` — ordered SQL files applied automatically at API startup.
- `settlement_report.csv` — supplied exercise input file.

### Prisma setup

Prisma ORM is configured for SQLite through the `better-sqlite3` driver adapter and uses the same `SQLITE_PATH` as the API. Its models map the exercise's `transactions` and one-to-many `settlement_history` tables. Generated Prisma client files are written under `apps/api/src/generated/prisma` and are ignored by Git.

Run Prisma's setup checks from the repository root:

```sh
npm run prisma:validate --workspace @txn-recon/api
npm run prisma:generate --workspace @txn-recon/api
```

The API build, test, and typecheck scripts generate the Prisma client before running. SQL migrations are managed separately from Prisma Client generation: the API creates a `schema_migrations` table, applies each unrecorded `.sql` file in its own transaction, and skips files already recorded.

### Initialize, seed, and reset the database

The API applies pending SQL migrations before it starts listening. To initialize the schema without starting the API, or insert the supplied transaction examples, run:

```sh
npm run db:init --workspace @txn-recon/api
npm run db:seed --workspace @txn-recon/api
```

Initialization is safe to repeat. `db:seed` generates the Prisma client automatically, then inserts the 14 transaction rows from the exercise and leaves existing rows unchanged on later runs. It does not import the CSV, so `settlement_history` starts empty.

To delete the configured SQLite database and re-create an empty schema, use the explicit reset command:

```sh
npm run db:reset --workspace @txn-recon/api -- --confirm
```

Reset removes the SQLite file and its WAL sidecars, then applies the current migrations. It does not seed sample rows; run `db:seed` afterward if needed. Reset is never run automatically.

### Build and checks

Run these commands from the repository root:

```sh
npm run build
npm run lint
npm test
npm run typecheck
```

The API build is emitted to `apps/api/dist`; the frontend build is emitted to `apps/web/dist`.

## Requirements and business rules

The exercise describes a system that imports a settlement report, matches its rows to transactions, records settlement history, updates transaction summaries, and displays reconciliation results. One transaction can have multiple settlement records.

### Rules specified by the exercise

- Match a settlement by `lifecycle_id`. When that ID is missing, match by `account_id`, `merchant_name`, and `transaction_date`.
- A `DEBIT` increases the net settled amount; a `CREDIT` reduces it. Settlement amounts in the CSV must be positive.
- Store each matched settlement in `settlement_history` and update the transaction's net settled amount and latest settlement date.
- Support `PENDING`, `PARTIAL`, `FULLY_SETTLED`, `OVER_SETTLED`, and `REFUNDED` settlement statuses.
- Flag over-settlement and transactions with no settlement after seven days as critical; flag under-settlement as a warning, subject to the refund ambiguity below.
- Validate the CSV and currency consistency, provide the four required REST endpoints, and show summary, transaction list, and transaction detail views.

### Working assumptions

These assumptions are proposed for implementation and should be revisited if the exercise author clarifies the rules. In particular, the PDF says a net amount below the transaction amount is a warning, but its $100 debit plus $20 credit example expects no issue. The refund treatment below resolves that conflict for this implementation.

#### Matching and eligibility

- Use fallback matching only when `lifecycle_id` is blank, not when a supplied ID fails to match. Compare fallback fields after trimming surrounding whitespace; otherwise use exact, case-sensitive values.
- If a match is missing or ambiguous, report the row for review and do not create a settlement history record for it. Do not select an arbitrary match.
- Only `COMPLETED` transactions are eligible for automatic reconciliation. A settlement matching a failed or declined transaction is reported for review and is not applied; those transactions retain `NOT_APPLICABLE`.
- An unmatched or rejected row remains eligible for processing in a later import if its underlying problem is resolved.

#### Amounts, statuses, and issues

- Calculate monetary amounts in integer cents, avoiding floating-point arithmetic. A settlement's currency must match its transaction's currency.
- Calculate net settled amount as the sum of debits minus the sum of credits. Set the latest settlement date to the greatest settlement date among applied records.
- Assign statuses in this order: no applied settlements → `PENDING`; net above transaction amount → `OVER_SETTLED`; net equal to transaction amount → `FULLY_SETTLED`; net below transaction amount with at least one credit → `REFUNDED`; otherwise → `PARTIAL`. A negative net amount is possible and follows the same rules; it should be visible for review.
- Flag `OVER_SETTLED` as critical. A `PENDING` transaction is critical when more than seven calendar days have elapsed since its transaction date, using the server's current calendar date. Exactly seven days is not yet overdue.
- Flag `PARTIAL` as a warning. Do not flag a `REFUNDED` transaction solely because its net amount is below the original amount; this follows the exercise's refund example. Other applicable critical issues still take precedence.
- For example, a $100 transaction with a $100 debit and $20 credit has a $80 net amount, status `REFUNDED`, and no under-settlement warning. A $100 transaction with only an $80 debit is `PARTIAL` with a warning.

#### Import behavior

- Use `settlement_id` as the identity of a settlement. An already applied ID with identical data is skipped and reported; the same ID with different data is reported as a conflict and is not applied.
- Validate and classify all rows; valid, uniquely matched rows can be applied even when other rows are invalid or unmatched. Return row-level outcomes and counts for applied, skipped, invalid, unmatched, ambiguous, and review/conflict records.
- Apply accepted rows and their transaction summary updates in a single SQLite transaction. If an unexpected processing error occurs, roll back all accepted changes from that import. A normal row validation failure does not itself abort other valid rows.

#### Dashboard metrics

- Count all transactions in the total transaction count; use completed transactions as the eligible population for settlement rate, outstanding amount, overdue checks, and average days to settle.
- Count settlements as applied settlement history records. Status and issue counts represent transactions, not settlement rows; a transaction is counted once per severity.
- Settlement rate = number of eligible transactions currently `FULLY_SETTLED` ÷ number of eligible transactions × 100. Return zero when there are no eligible transactions. Refunded transactions are not counted as fully settled under this definition.
- Outstanding amount = sum of `max(transaction amount − net settled amount, 0)` for eligible transactions, reported separately by currency. This includes any shortfall on refunded transactions even though that shortfall alone does not raise a warning. Do not combine different currencies into one monetary total.
- Average days to settle = mean calendar-day difference between transaction date and latest settlement date for eligible transactions currently `FULLY_SETTLED`. Return no value when none qualify. Averages use the latest recorded settlement date, not necessarily the date the transaction first became fully settled.
- The supplied sample dates are historical, so pending sample transactions may appear overdue when evaluated against the current date.

## Planned API

- `POST /reconcile` — import and reconcile a CSV report.
- `GET /transactions` — list transactions with issue flags and settlement status filtering.
- `GET /transactions/{id}` — retrieve a transaction, its settlements, and issue details.
- `GET /dashboard/summary` — retrieve reconciliation counts and performance metrics.

The settlement timeline, export, and advanced filtering are optional enhancements in the exercise.
