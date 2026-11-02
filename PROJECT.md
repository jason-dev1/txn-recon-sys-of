# Project guidance

For setup and common commands, see [README.md](README.md). This file records the current implementation, business rules, and assumptions for work in this repository.

## Architecture and development

- The npm workspace contains `apps/api` (Express, Prisma, SQLite) and `apps/web` (React, MUI, Vite). The API separates route controllers and middleware, feature services, models, DTOs, and
  repositories. The web app separates pages and components from endpoint clients and API types in `apps/web/src/api`.
- `apps/api/src/services/reconciliation` separates the CSV parser, matcher, and settlement calculator from `reconciliation.service.ts`, which coordinates the import and its outcomes. The settlement
  repository in `apps/api/src/models/settlement/repo` owns persistence and the transaction boundary. Issue detection is in `apps/api/src/services/transaction`, transaction reads are in
  `apps/api/src/models/transaction/repo`, and dashboard reads use a consistent database snapshot. HTTP response DTOs and statuses are handled by the reconciliation controller.
- The API's `apps/api/src/utils/formatter.ts` contains date and money helpers. CSV date validation uses `date-fns` with a strict date-only format and a minimum year of 0001. Preserve the distinction
  between UTC transaction date components and the server-local as-of day when changing date code.
- The API and Prisma use the same `SQLITE_PATH`; relative paths resolve from `apps/api`. The default is `./data/reconciliation.db`. `PORT` defaults to 3000. Local environment files and database files
  are Git-ignored.
- Prisma uses the `better-sqlite3` adapter; generated client files in `apps/api/src/generated/prisma` are ignored. API build, test, and typecheck generate the client. SQL migrations are separate: on
  startup the API records ordered `.sql` files in `schema_migrations` and applies each unrecorded file in its own transaction. `db:init` is repeatable. `db:seed` inserts the 14 sample transactions
  idempotently and does not import settlements. `db:reset -- --confirm` deletes the configured database and WAL sidecars and creates an empty schema; it is never automatic.
- SQLite's adapter can infer an integer type for a mixed integer/real result column and truncate later fractional amounts. Decimal-bearing transaction and settlement-history records are read
  individually within the relevant transaction to preserve cents. Keep this behavior in mind when changing database reads; it adds queries for larger datasets.
- During development Vite proxies `/api` to `http://127.0.0.1:3000`; `VITE_API_TARGET` changes the target. In deployments, route `/api` to the API with the prefix removed, or set `VITE_API_BASE_URL`
  at build time and configure cross-origin access when needed. `apps/web/src/api/client.ts` supplies the base URL and GET error handling; endpoint modules handle dashboard, transactions, and CSV
  reconciliation. Transaction requests accept an abort signal, and upload errors retain invalid-header details. The UI uses decimal strings rather than converting amounts to floating-point numbers.
- `npm test` runs API Vitest and web Cypress. API integration tests use isolated temporary SQLite databases with migrations and seed data, not the configured database. Cypress starts a temporary Vite
  server and mocks API calls. Normal dependency installation downloads Cypress. For interactive Cypress, start `npm run dev:web`, then run `npm --workspace @txn-recon/web run test:open`.
- Prettier configuration and ignores are in the repository root. `npm install` sets up a Husky pre-commit hook that runs Prettier on staged supported files through lint-staged. VS Code recommends
  Prettier as the default formatter; format-on-save is optional.

## Reconciliation rules and assumptions

These are working assumptions where the exercise is ambiguous. In particular, its general under-settlement warning conflicts with its $100 debit plus $20 credit example; this implementation treats
that example as a refund without a shortfall warning. Revisit the assumption if the exercise author clarifies it.

- CSV headers are required, unique, and mapped by name; column order may vary and extra uniquely named columns are ignored. Rows require settlement, account, and merchant identifiers; real
  `YYYY-MM-DD` transaction and settlement dates; a positive amount with at most two decimal places; `DEBIT` or `CREDIT`; and a three-letter currency. Errors are row-numbered. The sample has 19 rows,
  including blank lifecycle IDs.
- Match by exact `lifecycle_id` when supplied. Only when it is blank, match on account ID, merchant name, and calendar date. Trim surrounding fallback text whitespace; otherwise compare it
  case-sensitively. Do not fall back after an unknown supplied lifecycle ID or select an arbitrary ambiguous match.
- Only unique matches to `COMPLETED` transactions with matching currency are automatically applied. Unmatched, ambiguous, failed, declined, other ineligible, or currency-mismatched rows are reported
  without applying them and can be retried after the underlying issue is resolved. Multiple settlements can match one transaction.
- Compute money in integer cents. Debits increase and credits reduce net settled amount. The latest settlement date is the greatest applied settlement date. Assign status in order: no settlements →
  `PENDING`; net above transaction amount → `OVER_SETTLED`; equal → `FULLY_SETTLED`; below with any credit → `REFUNDED`; otherwise → `PARTIAL`. Negative net amounts are possible and visible.
- Flag an over-settlement as critical. A completed pending transaction is critical after more than seven server-local calendar days from its date-only transaction date; exactly seven is not overdue. A
  partial settlement is a warning. A refund is not flagged solely for a shortfall; other critical issues take precedence. For example, $100 debit and $20 credit against $100 is `REFUNDED` with no
  shortfall warning; an $80 debit alone is `PARTIAL` with a warning.
- `settlement_id` is the identity: identical repeats are skipped; changed reuse is a conflict. Valid uniquely matched rows can be applied while invalid or unmatched rows are reported. Apply accepted
  rows and summary updates in one SQLite transaction; an unexpected failure rolls the batch back.

## Dashboard calculations

- Count all transactions; count applied settlement-history records as settlements. Status and issue counts represent transactions, counted once per severity.
- The eligible population is completed transactions. Settlement rate is eligible `FULLY_SETTLED` transactions divided by all eligible transactions, multiplied by 100; it is zero when none are
  eligible. Refunded transactions are not fully settled for this calculation.
- Outstanding is the sum of `max(transaction amount − net settled amount, 0)` for eligible transactions, separately by currency. Include refunded shortfalls without raising a warning solely for them.
- Average days to settle is the mean calendar-day difference between transaction date and latest settlement date for eligible transactions currently `FULLY_SETTLED` with a latest settlement date;
  return `null` when none qualify. The latest date may differ from when the transaction first became fully settled. Sample dates are historical, so pending sample transactions can be overdue.

## HTTP contracts

- `GET /health` checks SQLite readiness.
- `POST /reconcile` accepts exactly one UTF-8 CSV file as `multipart/form-data` or raw `text/csv`, `application/csv`, `application/octet-stream`, or `application/vnd.ms-excel`, with a 10 MB body
  limit. Success returns `counts` (`totalRows`, `applied`, `skipped`, `invalid`, `unmatched`, `ambiguous`, `review`, `conflict`) and row-numbered `rows` with outcomes and details. Invalid headers
  return 422; unsupported or malformed uploads return safe 4xx responses. An unexpected failure returns 500 without committing accepted rows.
- `GET /transactions` returns `{ "transactions": [...] }` with details, settlement status, `hasIssues`, and `issueFlags` (code and severity), ordered by transaction ID. Optional `status` filters
  settlement status: `PENDING`, `PARTIAL`, `FULLY_SETTLED`, `OVER_SETTLED`, `REFUNDED`, or `NOT_APPLICABLE`. Invalid or repeated filters return 400.
- `GET /transactions/:id` returns the transaction, `settlementHistory`, and full `issues` with descriptions and recommendations; history is ordered by settlement date and ID. Missing IDs return 404.
  Amounts are decimal strings, nullable amounts remain null, and dates are ISO timestamps. The UI reloads the list on return, including after an import.
- `GET /dashboard/summary` returns `transactionCount`, `settlementCount`, `statusCounts`, `issueCounts` (`critical`, `warning`), `outstandingByCurrency` as two-decimal strings, percentage
  `settlementRate`, and `averageDaysToSettle` or `null`. Empty datasets return zero counts and rate, an empty currency map, and a null average. Transaction and dashboard endpoints are read-only.
- Controllers use `handleControllerError` with safe fallbacks. `HttpError` holds client-safe status, code, and message; unexpected errors return the fallback with status 500. The logger records only
  the fallback event code as structured JSON, not request bodies or exception details. Errors after headers are sent are passed to Express.

## Web views and reports

The dashboard shows settlement metrics and import outcomes and refreshes its summary after a successful import. The transaction list filters by settlement status, and the detail view shows history,
issues, and a timeline ordered by date and settlement ID. Timeline running net uses integer cents; an unsupported type, invalid amount, or currency mismatch makes the subsequent running net
unavailable.

The list exports all rows returned for the active filter as CSV or a multi-page PDF. CSV escapes fields and protects against spreadsheet formula injection. The PDF's built-in font supports Latin
characters; unsupported characters produce an error directing users to CSV instead of being silently corrupted. Advanced filtering remains an optional exercise enhancement.
