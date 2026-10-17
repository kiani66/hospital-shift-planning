/**
 * Applies pending SQL migrations from src/infrastructure/db/migrations.
 *
 * Runs locally (`pnpm db:migrate`), in CI, and in the Vercel build (`vercel-build`)
 * before `next build`, so a deployment never goes live against an older schema.
 * Migrations must therefore stay backward compatible (expand, then contract).
 *
 * Vercel Production migrates as always. Any other Vercel build (Preview) skips
 * migrations unless the destination database was approved explicitly; see
 * `decideMigration` and docs/deployment.md ("Preview deployments").
 */
import { loadEnvConfig } from "@next/env";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import {
  decideMigration,
  PREVIEW_APPROVAL_VARIABLE,
} from "../src/infrastructure/config/migration-guard";
import { runMigrations } from "../src/infrastructure/db/migrate";

async function main() {
  loadEnvConfig(process.cwd());

  const decision = decideMigration(process.env);
  if (decision.action === "skip") {
    switch (decision.reason) {
      case "explicit-skip":
        console.log("[db:migrate] skipped (SKIP_DB_MIGRATIONS=1)");
        break;
      case "preview-unapproved":
        console.log(
          `[db:migrate] skipped: non-production Vercel build, no matching approval. No migration was run. ` +
            `Destination ${decision.target ?? "(no database configured)"}, branch ${decision.branch ?? "(unknown)"}. ` +
            `Do not approve before confirming in the Neon console that this endpoint is the Preview branch and not Production; ` +
            `then set ${PREVIEW_APPROVAL_VARIABLE} for this branch only (docs/deployment.md).`,
        );
        break;
      case "preview-stale-approval":
        console.log(
          `[db:migrate] skipped: ${PREVIEW_APPROVAL_VARIABLE} does not match this build (destination ${decision.target}, branch ${decision.branch}). No migration was run.`,
        );
        break;
    }
    return;
  }

  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:migrate] target ${host}${pathname} (${decision.reason})`);
  await runMigrations(url);
  console.log("[db:migrate] up to date");
}

main().catch((error: unknown) => {
  console.error(
    "[db:migrate] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
