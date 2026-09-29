# hospital-shift-planning

Hospital nurse shift planning and approval system with mobile-first nurse workflows and desktop
scheduling for head nurses.

The UI is Persian (RTL) with a Solar Hijri calendar. The workflow runs from nurse preferences to
head nurse scheduling and finalization, then supervisor review and approval, ending in a closed
monthly schedule.

> **Status: Phase 0 (foundation).** Tooling, CI, database pipeline and the RTL shell are in place.
> Features arrive in later phases. See [docs/decisions.md](docs/decisions.md).

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
pnpm dev                     # http://localhost:3000
```

`GET /api/health` reports app and database status (HTTP 503 when the database is unreachable or
misconfigured).

## Scripts

| Script                         | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start` | Next.js                                                              |
| `pnpm check`                   | Lint, typecheck, format check and unit tests (run before committing) |
| `pnpm lint`                    | ESLint, including layer-boundary and RTL rules                       |
| `pnpm typecheck`               | `next typegen` + `tsc --noEmit`                                      |
| `pnpm format` / `format:check` | Prettier (with Tailwind class sorting)                               |
| `pnpm test` / `test:watch`     | Vitest                                                               |
| `pnpm test:e2e`                | Playwright against a production build (`pnpm build` first)           |
| `pnpm db:up` / `db:down`       | Local PostgreSQL via Docker Compose                                  |
| `pnpm db:generate`             | Generate a SQL migration from the Drizzle schema                     |
| `pnpm db:migrate`              | Apply migrations                                                     |
| `pnpm db:studio`               | Drizzle Studio                                                       |

## Project structure

```
src/
  app/              routes (RSC pages, route handlers); thin
  features/         UI by feature: components + Server Action adapters      (Phase 3+)
  components/       shared UI; components/ui holds shadcn/ui components     (Phase 3+)
  application/      use cases: authorize → domain → persist → audit → notify (Phase 2+)
  domain/           pure business rules, no framework imports               (Phase 1)
  infrastructure/   config (env), db (Drizzle client, schema, migrations), auth
  lib/              UI utilities (cn; Jalali calendar adapter in a later phase)
scripts/            db-migrate (used locally, in CI and on Vercel)
tests/              unit/, e2e/ (Playwright), support/
eslint-rules/       project ESLint rules (RTL-safe classes)
docs/               decisions, deployment
```

Layer boundaries are enforced by ESLint; see [AGENTS.md](AGENTS.md) for the conventions.

## Testing

- Unit tests: `pnpm test`.
- End-to-end: `pnpm build && pnpm test:e2e`. Needs a migrated database. Projects: `api`,
  `desktop-chromium`, `mobile-android`, `mobile-ios` (WebKit). Install browsers with
  `pnpm exec playwright install chromium webkit`.
- CI (GitHub Actions) runs both on every PR and push to `main`.

## Deployment

Vercel + Neon; see [docs/deployment.md](docs/deployment.md).

## License

MIT
