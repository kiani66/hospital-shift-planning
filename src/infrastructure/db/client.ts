import "server-only";

import { attachDatabasePool } from "@vercel/functions";

import { getServerEnv } from "../config/env";
import { createDatabase, type Database } from "./database";

export type { Database, DbExecutor, Transaction } from "./database";

// Survives hot reloads in development so we don't leak pools.
const globalForDb = globalThis as unknown as { __hspDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__hspDb) {
    const { db, pool } = createDatabase(getServerEnv().DATABASE_URL);
    // Lets Vercel Fluid compute close idle connections before suspending.
    attachDatabasePool(pool);
    globalForDb.__hspDb = db;
  }
  return globalForDb.__hspDb;
}
