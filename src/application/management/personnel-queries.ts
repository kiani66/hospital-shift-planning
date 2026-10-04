import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import { toAsciiDigits } from "../../domain/identity/normalize";
import { unwrap } from "../../domain/shared/result";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import {
  findDepartmentByCode,
  listDepartments,
} from "../../infrastructure/repositories/departments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import {
  readAccountDetail,
  readAccessRelations,
  readCurrentDepartmentPeople,
  readPersonnelPage,
} from "../../infrastructure/repositories/management-reads";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";
import { personnelUser, type PersonnelDetail } from "./read-model";

const filtersSchema = z.object({
  // Persian/Arabic digits match stored ASCII personnel numbers.
  search: z
    .string()
    .trim()
    .max(200)
    .transform(toAsciiDigits)
    .catch("")
    .default(""),
  active: z.enum(["all", "active", "inactive"]).catch("all").default("all"),
  admin: z.enum(["all", "admin", "other"]).catch("all").default("all"),
  departmentId: z.uuid().optional().catch(undefined),
  role: z.enum(["NURSE", "HEAD_NURSE"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).catch(1).default(1),
});

/** Also used before a route's loading boundary to preserve an HTTP 404 on denial. */
export async function requirePersonnelReadAccess(ctx: AppContext) {
  unwrap(authorize(ctx.actor, "user.list", {}));
  const today = todayIn(APP_TIMEZONE, ctx.clock?.());
  const actor = await loadActor(ctx.db, ctx.actor.userId, today);
  if (!actor) throw new NotFoundError("User");
  unwrap(authorize(actor, "user.list", {}));
  return today;
}

export async function getPersonnelDirectory(
  ctx: AppContext,
  rawInput: unknown = {},
) {
  const today = await requirePersonnelReadAccess(ctx);
  const filters = filtersSchema.parse(rawInput);
  const [rows, departments] = await Promise.all([
    readPersonnelPage(ctx.db, filters, today),
    listDepartments(ctx.db),
  ]);
  const page = rows.slice(0, 25);
  const relations = await readAccessRelations(
    ctx.db,
    page.map((u) => u.id),
    today,
  );
  return {
    filters,
    today,
    hasNext: rows.length > 25,
    departments: departments.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      isActive: d.isActive,
    })),
    users: page.map((user) =>
      personnelUser(
        user,
        {
          memberships: relations.memberships.filter(
            (m) => m.userId === user.id,
          ),
          supervisors: relations.supervisors.filter(
            (s) => s.userId === user.id,
          ),
        },
        today,
      ),
    ),
  };
}

/** Safe active-department options and calendar day for admin lifecycle forms. */
export async function getMembershipFormOptions(ctx: AppContext) {
  const today = await requirePersonnelReadAccess(ctx);
  const departments = await listDepartments(ctx.db);
  return {
    today,
    departments: departments
      .filter((d) => d.isActive)
      .map((d) => ({ id: d.id, code: d.code, name: d.name })),
  };
}

export async function getPersonnelDetail(
  ctx: AppContext,
  userId: string,
): Promise<PersonnelDetail> {
  const today = await requirePersonnelReadAccess(ctx);
  if (!z.uuid().safeParse(userId).success) throw new NotFoundError("User");
  const user = await readAccountDetail(ctx.db, userId);
  if (!user) throw new NotFoundError("User");
  const relations = await readAccessRelations(ctx.db, [userId]);
  return {
    ...personnelUser(user, relations, today),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    hasCredentials: user.hasCredentials,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function getDepartmentPeople(ctx: AppContext, code: string) {
  const today = todayIn(APP_TIMEZONE, ctx.clock?.());
  const actor = await loadActor(ctx.db, ctx.actor.userId, today);
  const department = await findDepartmentByCode(ctx.db, code);
  if (
    !department?.isActive ||
    !actor ||
    !authorize(ctx.actor, "personnel.view", { departmentId: department.id })
      .ok ||
    !authorize(actor, "personnel.view", { departmentId: department.id }).ok
  )
    throw new NotFoundError("Department");
  const people = await readCurrentDepartmentPeople(
    ctx.db,
    department.id,
    today,
  );
  return {
    department: {
      id: department.id,
      code: department.code,
      name: department.name,
    },
    today,
    ...people,
  };
}
