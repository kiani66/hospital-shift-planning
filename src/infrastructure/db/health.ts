import "server-only";

import { sql } from "drizzle-orm";

import { EnvValidationError } from "../config/env-schema";
import { getDb } from "./client";

export type DatabaseHealth = "ok" | "unavailable" | "misconfigured";

export async function checkDatabaseHealth(
  timeoutMs = 3_000,
): Promise<DatabaseHealth> {
  return probeWithTimeout(async () => {
    await getDb().execute(sql`select 1`);
  }, timeoutMs);
}

/** Exported for tests: runs `probe` and classifies the outcome. */
export async function probeWithTimeout(
  probe: () => Promise<void>,
  timeoutMs: number,
): Promise<DatabaseHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([probe(), timeout]);
    return "ok";
  } catch (error) {
    if (error instanceof EnvValidationError) return "misconfigured";
    console.error("[health] database probe failed:", (error as Error).message);
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
