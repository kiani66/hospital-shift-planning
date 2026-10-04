import { and, eq, inArray, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import { departmentMemberships, users } from "../db/schema";

/** Accounts holding any of the given personnel numbers; no credential columns. */
export async function findAccountsByPersonnelNumbers(
  db: DbExecutor,
  personnelNumbers: readonly string[],
) {
  if (personnelNumbers.length === 0) return [];
  return db
    .select({
      id: users.id,
      personnelNumber: users.personnelNumber,
      displayName: users.displayName,
      email: users.email,
      mobile: users.mobile,
      isActive: users.isActive,
    })
    .from(users)
    .where(inArray(users.personnelNumber, [...new Set(personnelNumbers)]));
}

/** Lower-cased e-mail → owning account id, for the given addresses. */
export async function findEmailOwners(
  db: DbExecutor,
  emails: readonly string[],
): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: sql<string>`lower(${users.email})` })
    .from(users)
    .where(
      inArray(sql`lower(${users.email})`, [
        ...new Set(emails.map((e) => e.toLowerCase())),
      ]),
    );
  return new Map(rows.map((r) => [r.email, r.id]));
}

/** Every membership (past, current, future) of these users in one department. */
export async function listDepartmentMembershipsOf(
  db: DbExecutor,
  userIds: readonly string[],
  departmentId: string,
): Promise<
  {
    userId: string;
    role: MembershipRole;
    startedOn: IsoDate;
    endedOn: IsoDate | null;
  }[]
> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      userId: departmentMemberships.userId,
      role: departmentMemberships.role,
      startedOn: departmentMemberships.startedOn,
      endedOn: departmentMemberships.endedOn,
    })
    .from(departmentMemberships)
    .where(
      and(
        eq(departmentMemberships.departmentId, departmentId),
        inArray(departmentMemberships.userId, [...new Set(userIds)]),
      ),
    );
  return rows.map((r) => ({
    ...r,
    startedOn: r.startedOn as IsoDate,
    endedOn: r.endedOn as IsoDate | null,
  }));
}
