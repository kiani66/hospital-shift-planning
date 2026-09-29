import { asc, eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { departments } from "../db/schema";

export interface DepartmentRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly isActive: boolean;
}

const columns = {
  id: departments.id,
  code: departments.code,
  name: departments.name,
  timezone: departments.timezone,
  isActive: departments.isActive,
};

export async function createDepartment(
  db: DbExecutor,
  input: { id?: string; code: string; name: string; timezone?: string },
): Promise<DepartmentRecord> {
  const [row] = await db.insert(departments).values(input).returning(columns);
  return row!;
}

export async function findDepartmentById(
  db: DbExecutor,
  id: string,
): Promise<DepartmentRecord | null> {
  const [row] = await db
    .select(columns)
    .from(departments)
    .where(eq(departments.id, id));
  return row ?? null;
}

export async function listDepartments(
  db: DbExecutor,
): Promise<DepartmentRecord[]> {
  return db.select(columns).from(departments).orderBy(asc(departments.code));
}

export async function findDepartmentByCode(
  db: DbExecutor,
  code: string,
): Promise<DepartmentRecord | null> {
  const [row] = await db
    .select(columns)
    .from(departments)
    .where(eq(departments.code, code));
  return row ?? null;
}

/** The departments with the given ids, ordered by code. */
export async function listDepartmentsByIds(
  db: DbExecutor,
  ids: readonly string[],
): Promise<DepartmentRecord[]> {
  if (ids.length === 0) return [];
  return db
    .select(columns)
    .from(departments)
    .where(inArray(departments.id, [...ids]))
    .orderBy(asc(departments.code));
}
