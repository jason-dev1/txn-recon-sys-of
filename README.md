# Transaction Reconciliation System - Open Fabric Assessment

A transaction settlement reconciliation app built with React, Express, Prisma, and SQLite. Upload settlement reports, review transactions and issues, and export filtered transactions as CSV or PDF.

## Demo

[View the demo video](./DEMO.mp4)

## Setup

Requires Node.js 26 or newer and npm 10 or newer. From the repository root:

```sh
npm install
npm run dev

# To load sample transactions
npm run db:seed --workspace @txn-recon/api
```

Open the web app at <http://localhost:5173>.

The API generates its Prisma client before starting, runs at <http://localhost:3000>, and applies database migrations on startup. The default SQLite database is `apps/api/data/reconciliation.db`.

Optionally copy `.env.example` to `.env` to set `PORT` or `SQLITE_PATH`; relative database paths resolve from `apps/api`. Vite proxies `/api` to the local API. Set `VITE_API_TARGET` to change the
development proxy target, or `VITE_API_BASE_URL` at build time to use a different API base URL.

## Commands

| Command                                              | Purpose                                             |
| ---------------------------------------------------- | --------------------------------------------------- |
| `npm run dev`                                        | Start the API and web app together.                 |
| `npm run dev:api` / `npm run dev:web`                | Start one app.                                      |
| `npm run build`                                      | Build both apps.                                    |
| `npm run lint` / `npm run typecheck`                 | Run static checks.                                  |
| `npm test`                                           | Run API tests and Cypress browser tests.            |
| `npm run format` / `npm run format:check`            | Format or check supported files.                    |
| `npm run db:init --workspace @txn-recon/api`         | Apply database migrations without starting the API. |
| `npm run prisma:validate --workspace @txn-recon/api` | Validate the Prisma schema.                         |
| `npm run prisma:generate --workspace @txn-recon/api` | Generate the Prisma client.                         |

`npm test` uses isolated temporary databases for API tests and mocked API responses for Cypress; the Cypress binary is downloaded during a normal `npm install`. For interactive browser tests, start
`npm run dev:web` and run `npm --workspace @txn-recon/web run test:open` in another terminal.

`npm run db:reset --workspace @txn-recon/api -- --confirm` deletes the configured database and recreates an empty schema. It does not seed data.

Transaction exports include all rows matching the current settlement-status filter. CSV preserves text outside the PDF's limited Latin-1 font support; use CSV when PDF export reports unsupported
characters.

## Project structure

- `apps/web` — React/MUI dashboard, transaction views, API clients, and Cypress tests.
- `apps/api` — Express API, reconciliation services, Prisma models, and tests.
- `apps/api/sql/migrations` — versioned SQLite migrations.
- `settlement_report.csv` — supplied sample report.

See [PROJECT.md](PROJECT.md) for architecture, API contracts, reconciliation rules, assumptions, and development and testing details.
