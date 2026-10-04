import { asc, count, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { users } from "../db/schema";

export interface PersonnelInventory {
  readonly totalUsers: number;
  readonly missing: readonly {
    readonly id: string;
    readonly email: string | null;
    readonly displayName: string;
    readonly isActive: boolean;
    readonly isHospitalAdmin: boolean;
  }[];
  /** Whether the staged NOT NULL migration would succeed right now. */
  readonly readyForStrictStage: boolean;
}

/**
 * Read-only inventory of accounts without a personnel number (stage 1 of the
 * personnel-number migration). Selects no credential columns and writes
 * nothing; it never proposes or derives numbers.
 */
export async function readPersonnelInventory(
  db: DbExecutor,
): Promise<PersonnelInventory> {
  const [total] = await db.select({ count: count() }).from(users);
  const missing = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
      isHospitalAdmin: users.isHospitalAdmin,
    })
    .from(users)
    .where(isNull(users.personnelNumber))
    .orderBy(sql`${users.isHospitalAdmin} desc`, asc(users.displayName));
  return {
    totalUsers: total!.count,
    missing,
    readyForStrictStage: missing.length === 0,
  };
}
