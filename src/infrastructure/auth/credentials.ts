import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  parseLoginIdentifier,
  type LoginIdentifier,
} from "../../domain/identity/login-identifier";
import type { DbExecutor } from "../db/database";
import { users } from "../db/schema";
import {
  clearFailedLogins,
  findActiveLockout,
  recordFailedLogin,
} from "../repositories/login-throttles";
import { verifyAgainstDummy, verifyPassword } from "./password";

/**
 * Sign-in form input: a personnel number or an e-mail address, and a password.
 * The length caps bound the lookup and the Argon2 work per request.
 */
export const loginInputSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/**
 * Deliberately coarse: an unknown identifier, a wrong password, a user without
 * a password and a deactivated user are all INVALID_CREDENTIALS, so the result
 * never reveals whether an account exists.
 */
export type SignInResult =
  | {
      readonly ok: true;
      readonly userId: string;
      /** Embedded in the new session; a later password change invalidates it. */
      readonly sessionVersion: number;
    }
  | {
      readonly ok: false;
      readonly reason: "INVALID_CREDENTIALS" | "THROTTLED";
    };

export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Account-level throttle key. Every identifier of one account (personnel
 * number, e-mail, a corrected personnel number) counts against the same key,
 * so switching identifiers cannot reset the limit. Only a hash is stored.
 */
export const accountThrottleKey = (userId: string): string =>
  sha256(`account:${userId}`);

/**
 * Fallback key for identifiers that match no account: per kind and normalized
 * value, so unknown identifiers are throttled exactly like real ones.
 */
export const unknownIdentifierThrottleKey = (id: LoginIdentifier): string =>
  sha256(`unknown:${id.kind}:${id.value}`);

/**
 * Verifies an identifier and password against the database (the only place
 * passwords are checked). Refuses a throttled account (or unknown identifier)
 * before verifying, counts every failure, and clears the count on success.
 */
export async function authenticateWithPassword(
  db: DbExecutor,
  input: LoginInput,
  now: Date = new Date(),
): Promise<SignInResult> {
  const identifier = parseLoginIdentifier(input.identifier);
  const where =
    identifier.kind === "email"
      ? sql`lower(${users.email}) = ${identifier.value}`
      : identifier.kind === "personnelNumber"
        ? eq(users.personnelNumber, identifier.value)
        : null;

  const [user] = where
    ? await db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
          sessionVersion: users.sessionVersion,
        })
        .from(users)
        .where(where)
    : [];

  const key = user
    ? accountThrottleKey(user.id)
    : unknownIdentifierThrottleKey(identifier);
  if (await findActiveLockout(db, key, now))
    return { ok: false, reason: "THROTTLED" };

  const valid =
    user?.passwordHash && user.isActive
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyAgainstDummy(input.password);

  if (!user || !valid) {
    await recordFailedLogin(db, key, now);
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }
  await clearFailedLogins(db, key);
  return { ok: true, userId: user.id, sessionVersion: user.sessionVersion };
}
