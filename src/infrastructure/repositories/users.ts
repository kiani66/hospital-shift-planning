import { eq, sql } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { users } from "../db/schema";

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

const columns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  isActive: users.isActive,
};

export async function createUser(
  db: DbExecutor,
  input: {
    id?: string;
    email: string;
    displayName: string;
    passwordHash?: string | null;
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
