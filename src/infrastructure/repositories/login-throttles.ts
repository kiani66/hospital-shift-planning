import { eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { loginThrottles } from "../db/schema";

/** Login throttling policy (documented in docs/security.md). */
export const LOGIN_THROTTLE = {
  /** Failed attempts allowed per e-mail address within one window. */
  maxFailures: 5,
  windowMs: 15 * 60_000,
  /** How long sign-in is refused after the last allowed failure. */
  lockoutMs: 15 * 60_000,
} as const;

/** Returns when sign-in for `keyHash` is locked until, or null if it is not locked at `now`. */
export async function findActiveLockout(
  db: DbExecutor,
  keyHash: string,
  now: Date,
): Promise<Date | null> {
  const [row] = await db
    .select({ lockedUntil: loginThrottles.lockedUntil })
    .from(loginThrottles)
    .where(eq(loginThrottles.keyHash, keyHash));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/**
 * Counts one failed attempt atomically (safe under concurrent requests). A
 * window older than `windowMs` starts over; reaching `maxFailures` sets the
 * lockout.
 */
export async function recordFailedLogin(
  db: DbExecutor,
  keyHash: string,
  now: Date,
  policy = LOGIN_THROTTLE,
): Promise<void> {
  const t = loginThrottles;
  const windowStart = new Date(now.getTime() - policy.windowMs);
  const lockedUntil = new Date(now.getTime() + policy.lockoutMs);
  const expired = sql`${t.windowStartedAt} <= ${windowStart}`;
  const nextCount = sql`case when ${expired} then 1 else ${t.failedCount} + 1 end`;
  await db
    .insert(t)
    .values({
      keyHash,
      failedCount: 1,
      windowStartedAt: now,
      lockedUntil: policy.maxFailures <= 1 ? lockedUntil : null,
    })
    .onConflictDoUpdate({
      target: t.keyHash,
      set: {
        failedCount: nextCount,
        windowStartedAt: sql`case when ${expired} then ${now} else ${t.windowStartedAt} end`,
        lockedUntil: sql`case when ${nextCount} >= ${policy.maxFailures} then ${lockedUntil}::timestamptz else null end`,
      },
    });
}

/** Forgets the failures for `keyHash` (after a successful sign-in). */
export async function clearFailedLogins(
  db: DbExecutor,
  keyHash: string,
): Promise<void> {
  await db.delete(loginThrottles).where(eq(loginThrottles.keyHash, keyHash));
}
