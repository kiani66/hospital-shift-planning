import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export const MIGRATIONS_FOLDER = "src/infrastructure/db/migrations";

// Arbitrary constant; serializes concurrent migration runs against one database.
const MIGRATION_LOCK_ID = 7_310_422;

/**
 * Applies pending SQL migrations. Used by `scripts/db-migrate.ts` (local, CI,
 * Vercel build) and by the integration-test setup, so all run the same path.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  // max: 1 keeps the advisory lock and the migration on the same session.
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    await pool.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
  } finally {
    await pool.end();
  }
}
