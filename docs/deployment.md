# Deployment (Vercel + Neon)

```
GitHub ──PR──▶ Vercel Preview ──▶ Neon branch (one per preview, created by the integration)
       └main─▶ Vercel Production ──▶ Neon main branch
```

The Vercel build runs `pnpm vercel-build`: it applies database migrations
(`scripts/db-migrate.ts`, using `DATABASE_URL_UNPOOLED`) and then runs `next build`.
A deployment therefore never goes live on an older schema, and a build fails fast if
the database variables are missing.

## One-time setup (manual)

1. **Neon project**: create one at <https://console.neon.tech> (free tier is fine to start).
   Pick a region close to your users and note it (for example `aws-eu-central-1`, Frankfurt).
   PostgreSQL 17.
2. **Vercel project**: at <https://vercel.com/new>, import `kiani66/hospital-shift-planning`.
   The framework (Next.js), package manager (pnpm) and Node 22 (`engines`) are detected.
   Leave the build command at its default; Vercel runs `vercel-build` automatically.
3. **Connect Neon to Vercel**: Vercel project → Storage (or Integrations) → Neon →
   connect the existing Neon project. Enable **Create a database branch for each preview
   deployment**. The integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` per
   environment.
   - Without preview branching, preview builds would run their migrations against the
     production database. Do not skip this, or give Preview its own database URLs.
4. **Function region**: Vercel project → Settings → Functions → Function Region. Pick the
   region matching the Neon region (for example `fra1` for Frankfurt).
5. **Deploy**: push to `main` (or open a PR for a preview). Then check
   `https://<deployment>/api/health`, which should return
   `{"status":"ok","checks":{"database":"ok"}}`.

## Environment variables

| Variable                | Where                            | Purpose                                                  |
| ----------------------- | -------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`          | Vercel (Neon integration), CI    | Pooled connection for the running app                    |
| `DATABASE_URL_UNPOOLED` | Vercel (Neon integration), CI    | Direct connection for migrations                         |
| `SKIP_DB_MIGRATIONS`    | Vercel (optional)                | `1` skips migrations in `vercel-build` (emergency only)  |
| `AUTH_SECRET`           | Vercel (Production, Preview), CI | Session encryption (`openssl rand -base64 32`); required |
| `AUTH_TRUST_HOST`       | Local and CI only                | `true`; not needed on Vercel (trusted automatically)     |

Never prefix secrets with `NEXT_PUBLIC_`. Local values go in `.env.local` (gitignored); see
`.env.example`.

## Auth setup (manual, once)

1. Vercel project → Settings → Environment Variables → add `AUTH_SECRET` for **Production**
   and **Preview**, each a different value from `openssl rand -base64 32`. Redeploy.
2. Check `/api/health`: `checks.auth` must be `"ok"` (it reports `"misconfigured"`, and HTTP
   503, while the secret is missing or shorter than 32 characters).
3. Production has no accounts until they are provisioned; the demo seed never runs there. To
   try a preview, seed its Neon branch by hand: `DATABASE_URL_UNPOOLED=<preview branch URL>
pnpm db:seed` (resets that branch to demo data).

## Before real hospital use

- Move Neon to a paid plan for longer point-in-time restore and no cold starts.
- Confirm data-residency and retention requirements for staff data.
