/**
 * Applies pending SQL migrations from src/infrastructure/db/migrations.
 *
 * Runs locally (`pnpm db:migrate`), in CI, and in the Vercel build (`vercel-build`)
 * before `next build`, so a deployment never goes live against an older schema.
 * Migrations must therefore stay backward compatible (expand, then contract).
 */
import { loadEnvConfig } from "@next/env";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import { runMigrations } from "../src/infrastructure/db/migrate";

async function main() {
  loadEnvConfig(process.cwd());

  if (process.env.SKIP_DB_MIGRATIONS === "1") {
    console.log("[db:migrate] skipped (SKIP_DB_MIGRATIONS=1)");
    return;
  }

  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:migrate] target ${host}${pathname}`);
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
