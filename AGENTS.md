<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project rules: hospital-shift-planning

Read `docs/decisions.md` for the approved product and technical decisions.

## Architecture (enforced by ESLint `no-restricted-imports`)

- `src/domain/`: pure TypeScript business rules (state machine, night-rest rule, date scopes,
  authorization policies). No imports from Next.js, React, Drizzle, `pg`, Auth.js or other layers.
- `src/application/`: use cases (commands and queries). Each command authorizes, loads, applies
  domain logic, persists, audits and notifies inside **one** transaction. No UI or Next.js imports.
- `src/infrastructure/`: database (Drizzle), auth, config. Never imports application or UI.
- `src/app/`, `src/features/`, `src/components/`: UI. Server Actions are thin adapters
  (Zod parse, then `getActor()`, then the use case). UI never touches the database directly.
- Authorization is enforced in use cases on the server, never only in the UI or `proxy.ts`.

## Dates and calendar

- Store and pass dates as ISO `YYYY-MM-DD` strings (`date` columns). Never use JS `Date` for
  calendar days.
- Schedules are `period_start` / `period_end`; never store Jalali year/month as data.
- Solar Hijri (Jalali) conversion and formatting happen only in the presentation/calendar adapter.
  The week starts on Saturday.

## UI

- Persian (`fa`), `dir="rtl"`. Use logical Tailwind utilities only (`ms-`/`me-`, `ps-`/`pe-`,
  `start-`/`end-`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s*`/`rounded-e*`).
  `hsp/no-physical-direction-classes` rejects physical ones; use an explicit `rtl:`/`ltr:` variant
  when a direction-specific override is truly intended.
- Shift colors come from the `shift-*` tokens in `globals.css` and are always paired with the code
  text (`M`, `E`, `N`, `ME`).

## Before committing

`pnpm check` (lint, typecheck, format check, unit tests). E2E: `pnpm build && pnpm test:e2e`.
