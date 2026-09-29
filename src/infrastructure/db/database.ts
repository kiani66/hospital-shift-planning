import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

/** A transaction handle, as passed to `db.transaction(async (tx) => …)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything repositories can run queries on: the database or an open transaction. */
export type DbExecutor = Database | Transaction;

/**
 * Creates a Drizzle database over a new `pg` pool. No `server-only` import so
 * scripts (seed) and integration tests can use it; app code goes through
 * `getDb()` in ./client.
 */
export function createDatabase(
  connectionString: string,
  options: PoolConfig = {},
) {
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    ...options,
  });
  // An idle client can error (e.g. the server closed the connection);
  // without a listener that would crash the process.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });
  const db: Database = drizzle({ client: pool, schema, casing: "snake_case" });
  return { db, pool };
}
