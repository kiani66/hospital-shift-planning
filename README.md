# hospital-shift-planning

Hospital nurse shift planning and approval system with mobile-first nurse workflows and desktop
scheduling for head nurses.

The UI is Persian (RTL) with a Solar Hijri calendar. The workflow runs from nurse preferences to
head nurse scheduling and finalization, then supervisor review and approval, ending in a closed
monthly schedule.

> **Status: Phase 10 (user and department membership management).** Hospital Admin personnel
> workflows and scoped Head Nurse/Supervisor personnel reads join the scheduling, approval and
> schedule-change workflows. See [docs/decisions.md](docs/decisions.md),
> [docs/database.md](docs/database.md) and the explicit first-admin initialization instructions
> in [docs/deployment.md](docs/deployment.md#phase-10-production-upgrade-and-first-hospital-admin).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui · PostgreSQL (Neon) ·
Drizzle ORM · Auth.js · Zod · Vitest · Playwright · Vercel

## Getting started

Prerequisites: Node 22, pnpm 10 (`corepack enable`), and Docker (or any PostgreSQL 16+).

```bash
pnpm install
cp .env.example .env.local   # local connection strings
pnpm db:up                   # PostgreSQL 17 in Docker
pnpm db:migrate
pnpm db:seed                 # demo data and demo accounts
pnpm dev                     # http://localhost:3000
```

Set `AUTH_SECRET` in `.env.local` (`openssl rand -base64 32`). Sign in with a demo account, e.g.
`nurse1.icu@demo.invalid`, `head.icu@demo.invalid` or `supervisor@demo.invalid`, password
`demo-only-password` (development and preview databases only; see
[docs/security.md](docs/security.md)).

`GET /api/health` reports app, database and auth-configuration status (HTTP 503 when the
database is unreachable or misconfigured, or `AUTH_SECRET` is missing).

## Scripts

| Script                         | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start` | Next.js                                                              |
| `pnpm check`                   | Lint, typecheck, format check and unit tests (run before committing) |
| `pnpm lint`                    | ESLint, including layer-boundary and RTL rules                       |
| `pnpm typecheck`               | `next typegen` + `tsc --noEmit`                                      |
| `pnpm format` / `format:check` | Prettier (with Tailwind class sorting)                               |
| `pnpm test` / `test:watch`     | Vitest unit tests (no database)                                      |
| `pnpm test:coverage`           | Unit tests with coverage; `src/domain` must stay at 100%             |
| `pnpm test:integration`        | Integration tests against real PostgreSQL (`TEST_DATABASE_URL`)      |
| `pnpm test:e2e`                | Playwright against a production build (`pnpm build` first)           |
| `pnpm db:up` / `db:down`       | Local PostgreSQL via Docker Compose                                  |
| `pnpm db:generate`             | Generate a SQL migration from the Drizzle schema                     |
| `pnpm db:migrate`              | Apply migrations                                                     |
| `pnpm db:seed`                 | Reset the database to deterministic demo data (never in production)  |
| `pnpm db:provision-user`       | Explicit operator provisioning of a real account and membership      |
| `pnpm db:bootstrap-admin`      | Establish the first Hospital Admin on a deliberately named account   |
| `pnpm db:studio`               | Drizzle Studio                                                       |

## Project structure

```
src/
  app/              routes (RSC pages, route handlers); thin
  features/         UI by feature: components + thin Server Action adapters
  components/       shared UI; components/ui holds shadcn/ui-style primitives
  application/      use cases: authorize → domain → persist → audit → notify
  domain/           pure business rules, no framework imports
  infrastructure/   auth (Auth.js, Argon2id, getActor), config (env), db, repositories
  lib/              shared UI utilities (calendar adapter lives in features/calendar)
scripts/            db-migrate (used locally, in CI and on Vercel)
tests/              unit/, integration/ (real PostgreSQL), e2e/ (Playwright), support/
eslint-rules/       project ESLint rules (RTL-safe classes)
docs/               decisions, database, deployment, security
```

Layer boundaries are enforced by ESLint; see [AGENTS.md](AGENTS.md) for the conventions.

## Testing

- Unit tests: `pnpm test` (`pnpm test:coverage` enforces 100% for `src/domain`).
- Integration tests: `pnpm test:integration` against real PostgreSQL. Set `TEST_DATABASE_URL`
  (see `.env.example`); the database is wiped and migrated on every run, and its name must contain
  `test`.
- End-to-end: `pnpm build && pnpm test:e2e`. Needs a migrated and seeded database
  (`pnpm db:seed`) and `AUTH_SECRET` / `AUTH_TRUST_HOST=true`. Projects: `api`,
  `desktop-chromium`, `mobile-android`, `mobile-ios` (WebKit). Install browsers with
  `pnpm exec playwright install chromium webkit`.
  Also set a designated `TEST_DATABASE_URL` whose name contains `test`; the isolated last-admin
  fixture requires its role to create/drop its own disposable test database. It never changes
  shared demo admins. See [docs/database.md](docs/database.md#local-data).
- CI (GitHub Actions) runs all three on every PR and push to `main`.

## Deployment

Vercel + Neon; see [docs/deployment.md](docs/deployment.md).

## License

MIT
