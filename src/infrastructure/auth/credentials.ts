import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { DbExecutor } from "../db/database";
import { users } from "../db/schema";
import {
  clearFailedLogins,
  findActiveLockout,
  recordFailedLogin,
} from "../repositories/login-throttles";
import { verifyAgainstDummy, verifyPassword } from "./password";

/** Sign-in form input. The length caps bound the Argon2 work per request. */
export const loginInputSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * Deliberately coarse: an unknown e-mail, a wrong password, a user without a
 * password and a deactivated user are all INVALID_CREDENTIALS, so the result
 * never reveals whether an account exists.
 */
export type SignInResult =
  | { readonly ok: true; readonly userId: string }
  | {
      readonly ok: false;
      readonly reason: "INVALID_CREDENTIALS" | "THROTTLED";
    };

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

/** Throttle key: SHA-256 of the normalized address (the address itself is never stored). */
export const throttleKey = (email: string): string =>
  createHash("sha256").update(normalizeEmail(email)).digest("hex");

/**
 * Verifies an e-mail and password against the database (the only place
 * passwords are checked). Refuses throttled addresses before verifying, counts
 * every failure, and clears the count on success.
 */
export async function authenticateWithPassword(
  db: DbExecutor,
  input: LoginInput,
  now: Date = new Date(),
): Promise<SignInResult> {
  const key = throttleKey(input.email);
  if (await findActiveLockout(db, key, now))
    return { ok: false, reason: "THROTTLED" };

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(input.email)}`);

  const valid =
    user?.passwordHash && user.isActive
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyAgainstDummy(input.password);

  if (!user || !valid) {
    await recordFailedLogin(db, key, now);
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }
  await clearFailedLogins(db, key);
  return { ok: true, userId: user.id };
}
