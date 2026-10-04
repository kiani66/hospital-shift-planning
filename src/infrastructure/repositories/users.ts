import { eq, inArray, sql } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { users } from "../db/schema";

export interface UserRecord {
  readonly id: string;
  readonly email: string | null;
  readonly personnelNumber: string | null;
  readonly mobile: string | null;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly isHospitalAdmin: boolean;
}

// Never selects credential columns (hash, session version).
const columns = {
  id: users.id,
  email: users.email,
  personnelNumber: users.personnelNumber,
  mobile: users.mobile,
  displayName: users.displayName,
  isActive: users.isActive,
  isHospitalAdmin: users.isHospitalAdmin,
};

export async function createUser(
  db: DbExecutor,
  input: {
    id?: string;
    email?: string | null;
    personnelNumber?: string | null;
    mobile?: string | null;
    displayName: string;
    passwordHash?: string | null;
    mustChangePassword?: boolean;
    isActive?: boolean;
  },
): Promise<UserRecord> {
  const [row] = await db.insert(users).values(input).returning(columns);
  return row!;
}

export async function findUserById(
  db: DbExecutor,
  id: string,
): Promise<UserRecord | null> {
  const [row] = await db.select(columns).from(users).where(eq(users.id, id));
  return row ?? null;
}

/** Case-insensitive, matching the unique index on lower(email). */
export async function findUserByEmail(
  db: DbExecutor,
  email: string,
): Promise<UserRecord | null> {
  const [row] = await db
    .select(columns)
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return row ?? null;
}

/** Exact match on the normalized personnel number (text; leading zeros are significant). */
export async function findUserByPersonnelNumber(
  db: DbExecutor,
  personnelNumber: string,
): Promise<UserRecord | null> {
  const [row] = await db
    .select(columns)
    .from(users)
    .where(eq(users.personnelNumber, personnelNumber));
  return row ?? null;
}

export async function setUserActive(
  db: DbExecutor,
  id: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, id));
}

/** Display names of the given users, keyed by id (unknown ids are absent). */
export async function listDisplayNames(
  db: DbExecutor,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/** What the session boundary needs about a user; no credential material. */
export interface SessionUserState {
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly sessionVersion: number;
}

export async function findSessionUserState(
  db: DbExecutor,
  id: string,
): Promise<SessionUserState | null> {
  const [row] = await db
    .select({
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .where(eq(users.id, id));
  return row ?? null;
}

/**
 * Replaces the password hash, sets whether the user must change it at the next
 * sign-in, and bumps the session version so every session issued before this
 * moment stops working on its next request. Never touches the active flag,
 * identity or relations. False for an unknown id.
 */
export async function replacePassword(
  db: DbExecutor,
  id: string,
  input: { passwordHash: string; mustChangePassword: boolean; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      passwordChangedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return rows.length > 0;
}

/**
 * The stored hash of one user and whether it is temporary, locked for update.
 * Only for password verification inside the change-password transaction.
 */
export async function lockPasswordState(
  db: DbExecutor,
  id: string,
): Promise<{
  passwordHash: string | null;
  mustChangePassword: boolean;
} | null> {
  const [row] = await db
    .select({
      passwordHash: users.passwordHash,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, id))
    .for("update");
  return row ?? null;
}

export async function setPersonnelNumber(
  db: DbExecutor,
  id: string,
  personnelNumber: string,
  now: Date,
): Promise<void> {
  await db
    .update(users)
    .set({ personnelNumber, updatedAt: now })
    .where(eq(users.id, id));
}
