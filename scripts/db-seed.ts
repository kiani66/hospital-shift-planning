/**
 * Resets the database to deterministic demo data (development / preview only).
 * Never runs automatically; refuses to run in production.
 */
import { loadEnvConfig } from "@next/env";

import { migrationDatabaseUrl } from "../src/infrastructure/config/env-schema";
import { createDatabase } from "../src/infrastructure/db/database";
import {
  assertSeedAllowed,
  seedDemoData,
} from "../src/infrastructure/db/seed/seed";

async function main() {
  loadEnvConfig(process.cwd());
  assertSeedAllowed(process.env);

  const url = migrationDatabaseUrl(process.env);
  const { host, pathname } = new URL(url);
  console.log(`[db:seed] resetting ${host}${pathname} to demo data`);

  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    const summary = await seedDemoData(db);
    console.log("[db:seed] done", summary);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "[db:seed] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
