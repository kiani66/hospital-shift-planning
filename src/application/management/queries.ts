import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import { unwrap } from "../../domain/shared/result";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  listDepartmentPersonnel,
  listUserAccessHistory,
  searchHospitalUsers,
} from "../../infrastructure/repositories/management";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { findUserById } from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";

async function authorizeIdentityRead(ctx: AppContext) {
  unwrap(authorize(ctx.actor, "user.list", {}));
  const actor = await loadActor(
    ctx.db,
    ctx.actor.userId,
    todayIn(APP_TIMEZONE, ctx.clock?.()),
  );
  if (!actor) throw new NotFoundError("User");
  unwrap(authorize(actor, "user.list", {}));
}

export async function listHospitalUsers(
  ctx: AppContext,
  rawInput: unknown = {},
) {
  await authorizeIdentityRead(ctx);
  const input = z
    .object({
      search: z.string().trim().max(200).default(""),
      limit: z.number().int().min(1).max(100).default(50),
    })
    .parse(rawInput);
  return searchHospitalUsers(ctx.db, input.search, input.limit);
}

export async function getDepartmentPersonnel(
  ctx: AppContext,
  departmentId: string,
) {
  z.uuid().parse(departmentId);
  const actor = await loadActor(
    ctx.db,
    ctx.actor.userId,
    todayIn(APP_TIMEZONE, ctx.clock?.()),
  );
  const department = await findDepartmentById(ctx.db, departmentId);
  if (
    !actor ||
    !department?.isActive ||
    !authorize(actor, "personnel.view", { departmentId }).ok
  )
    throw new NotFoundError("Department");
  return listDepartmentPersonnel(ctx.db, departmentId);
}

export async function getUserAccessHistory(ctx: AppContext, userId: string) {
  // Reuses the same global identity-read policy; no scoped actor may enumerate a user.
  await authorizeIdentityRead(ctx);
  z.uuid().parse(userId);
  if (!(await findUserById(ctx.db, userId))) throw new NotFoundError("User");
  return listUserAccessHistory(ctx.db, userId);
}
