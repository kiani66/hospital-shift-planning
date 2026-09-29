/**
 * Applies pending SQL migrations from src/infrastructure/db/migrations.
 *
 * Runs locally (`pnpm db:migrate`), in CI, and in the Vercel build (`vercel-build`)
 * before `next build`, so a deployment never goes live against an older schema.
 * Migrations must therefore stay backward compatible (expand, then contract).
 */
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";

// Arbitrary constant; serializes concurrent migration runs against one database.
const MIGRATION_LOCK_ID = 7_310_422;

async function main() {
  loadEnvConfig(process.cwd());

  if (process.env.SKIP_DB_MIGRATIONS === "1") {
    console.log("[db:migrate] skipped (SKIP_DB_MIGRATIONS=1)");
    return;
  }

  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:migrate] target ${host}${pathname}`);

  // max: 1 keeps the advisory lock and the migration on the same session.
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: "src/infrastructure/db/migrations",
    });
    await pool.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    console.log("[db:migrate] up to date");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[db:migrate] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
