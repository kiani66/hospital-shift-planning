import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { getServerEnv } from "../config/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

// Survives hot reloads in development so we don't leak pools.
const globalForDb = globalThis as unknown as { __hspDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__hspDb) {
    const pool = new Pool({
      connectionString: getServerEnv().DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
    });
    // An idle client can error (e.g. the server closed the connection);
    // without a listener that would crash the process.
    pool.on("error", (error) => {
      console.error("[db] idle client error:", error.message);
    });
    // Lets Vercel Fluid compute close idle connections before suspending.
    attachDatabasePool(pool);
    globalForDb.__hspDb = drizzle({
      client: pool,
      schema,
      casing: "snake_case",
    });
  }
  return globalForDb.__hspDb;
}
