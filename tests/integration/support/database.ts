import { afterAll, beforeEach, inject } from "vitest";

import { createDatabase } from "../../../src/infrastructure/db/database";
import {
  resetData,
  seedDemoData,
} from "../../../src/infrastructure/db/seed/seed";

/**
 * A pool on the migrated test database. Each test starts from the demo seed
 * (or from empty with `{ seed: false }`).
 */
export function setupTestDatabase(options: { seed?: boolean } = {}) {
  const { db, pool } = createDatabase(inject("databaseUrl"), { max: 6 });

  beforeEach(async () => {
    if (options.seed === false) await resetData(db);
    else await seedDemoData(db);
  });
  afterAll(async () => {
    await pool.end();
  });

  return { db, pool, url: inject("databaseUrl") };
}
