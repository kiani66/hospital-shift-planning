import { and, asc, count, eq, ilike, inArray, or, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor, Transaction } from "../db/database";
import {
  departmentMemberships,
  supervisorAssignments,
  users,
} from "../db/schema";

/** Account lifecycle, authority writes and first-admin bootstrap share this lock. */
export async function lockHospitalAdministration(
  tx: Transaction,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(7310423)`);
}

export async function countHospitalAdmins(
  db: DbExecutor,
  activeOnly = true,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .where(
      activeOnly
        ? and(eq(users.isHospitalAdmin, true), eq(users.isActive, true))
        : eq(users.isHospitalAdmin, true),
    );
  return row!.count;
}

// Reuse bootstrap's credential eligibility without selecting a password hash.
const credentialsProvisioned = sql<boolean>`${users.passwordHash} is not null`;

/** Replacement admins must be able to sign in, not merely carry active/admin flags. */
export async function countUsableHospitalAdmins(
  db: DbExecutor,
): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .where(
      and(
        eq(users.isHospitalAdmin, true),
        eq(users.isActive, true),
        credentialsProvisioned,
      ),
    );
  return row!.count;
}

export async function hasAccountCredentials(
  db: DbExecutor,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ configured: credentialsProvisioned })
    .from(users)
    .where(eq(users.id, userId));
  return row?.configured ?? false;
}

export async function listUserAccessHistory(db: DbExecutor, userId: string) {
  const [memberships, supervisors] = await Promise.all([
    db
      .select({
        id: departmentMemberships.id,
        departmentId: departmentMemberships.departmentId,
        role: departmentMemberships.role,
        startedOn: departmentMemberships.startedOn,
        endedOn: departmentMemberships.endedOn,
      })
      .from(departmentMemberships)
      .where(eq(departmentMemberships.userId, userId))
      .orderBy(
        asc(departmentMemberships.startedOn),
        asc(departmentMemberships.id),
      ),
    db
      .select({
        id: supervisorAssignments.id,
        departmentId: supervisorAssignments.departmentId,
        startedOn: supervisorAssignments.startedOn,
        endedOn: supervisorAssignments.endedOn,
      })
      .from(supervisorAssignments)
      .where(eq(supervisorAssignments.userId, userId))
      .orderBy(
        asc(supervisorAssignments.startedOn),
        asc(supervisorAssignments.id),
      ),
  ]);
  return { memberships, supervisors };
}

export async function updateAccount(
  tx: Transaction,
  id: string,
  values: {
    isActive?: boolean;
    isHospitalAdmin?: boolean;
    email?: string | null;
    mobile?: string | null;
    displayName?: string;
  },
  now: Date,
): Promise<void> {
  await tx
    .update(users)
    .set({ ...values, updatedAt: now })
    .where(eq(users.id, id));
}

export interface MembershipRecord {
  readonly id: string;
  readonly userId: string;
  readonly departmentId: string;
  readonly role: MembershipRole;
  readonly startedOn: IsoDate;
  readonly endedOn: IsoDate | null;
}

export type SupervisorRecord = Omit<MembershipRecord, "role">;

export async function findMembership(
  db: DbExecutor,
  id: string,
): Promise<MembershipRecord | null> {
  const [row] = await db
    .select({
      id: departmentMemberships.id,
      userId: departmentMemberships.userId,
      departmentId: departmentMemberships.departmentId,
      role: departmentMemberships.role,
      startedOn: departmentMemberships.startedOn,
      endedOn: departmentMemberships.endedOn,
    })
    .from(departmentMemberships)
    .where(eq(departmentMemberships.id, id));
  return row
    ? {
        ...row,
        startedOn: row.startedOn as IsoDate,
        endedOn: row.endedOn as IsoDate | null,
      }
    : null;
}

export async function insertMembership(
  tx: Transaction,
  input: Omit<MembershipRecord, "id">,
): Promise<string> {
  const [row] = await tx
    .insert(departmentMemberships)
    .values(input)
    .returning({ id: departmentMemberships.id });
  return row!.id;
}

export async function updateMembershipEnd(
  tx: Transaction,
  id: string,
  endedOn: IsoDate,
): Promise<void> {
  await tx
    .update(departmentMemberships)
    .set({ endedOn })
    .where(eq(departmentMemberships.id, id));
}

export async function findSupervisorRelation(
  db: DbExecutor,
  id: string,
): Promise<SupervisorRecord | null> {
  const [row] = await db
    .select({
      id: supervisorAssignments.id,
      userId: supervisorAssignments.userId,
      departmentId: supervisorAssignments.departmentId,
      startedOn: supervisorAssignments.startedOn,
      endedOn: supervisorAssignments.endedOn,
    })
    .from(supervisorAssignments)
    .where(eq(supervisorAssignments.id, id));
  return row
    ? {
        ...row,
        startedOn: row.startedOn as IsoDate,
        endedOn: row.endedOn as IsoDate | null,
      }
    : null;
}

export async function insertSupervisorRelation(
  tx: Transaction,
  input: SupervisorRecord,
): Promise<void> {
  await tx.insert(supervisorAssignments).values(input);
}

export async function updateSupervisorEnd(
  tx: Transaction,
  id: string,
  endedOn: IsoDate,
): Promise<void> {
  await tx
    .update(supervisorAssignments)
    .set({ endedOn })
    .where(eq(supervisorAssignments.id, id));
}

/** Safe, bounded identity projection; no credential fields ever leave this repository. */
export async function searchHospitalUsers(
  db: DbExecutor,
  search: string,
  limit: number,
) {
  const escaped = search.replace(/[\\%_]/g, "\\$&");
  return db
    .select({
      id: users.id,
      email: users.email,
      personnelNumber: users.personnelNumber,
      mobile: users.mobile,
      displayName: users.displayName,
      isActive: users.isActive,
      isHospitalAdmin: users.isHospitalAdmin,
    })
    .from(users)
    .where(
      or(
        ilike(users.email, `%${escaped}%`),
        ilike(users.displayName, `%${escaped}%`),
        ilike(users.personnelNumber, `%${escaped}%`),
      ),
    )
    .orderBy(asc(users.displayName), asc(users.id))
    .limit(limit);
}

/** Local membership history only; global identity/admin details are not operational personnel data. */
export async function listDepartmentPersonnel(
  db: DbExecutor,
  departmentId: string,
) {
  return db
    .select({
      id: departmentMemberships.id,
      userId: users.id,
      displayName: users.displayName,
      isActive: users.isActive,
      role: departmentMemberships.role,
      startedOn: departmentMemberships.startedOn,
      endedOn: departmentMemberships.endedOn,
    })
    .from(departmentMemberships)
    .innerJoin(users, eq(users.id, departmentMemberships.userId))
    .where(eq(departmentMemberships.departmentId, departmentId))
    .orderBy(
      asc(users.displayName),
      asc(departmentMemberships.startedOn),
      asc(departmentMemberships.id),
    );
}

/** Share locks serialize new scheduling eligibility with account deactivation. */
export async function lockActiveSchedulingUsers(
  tx: DbExecutor,
  ids: readonly string[],
): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  const rows = await tx
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(inArray(users.id, unique))
    .orderBy(asc(users.id))
    .for("share");
  return rows.length === unique.length && rows.every((r) => r.isActive);
}
