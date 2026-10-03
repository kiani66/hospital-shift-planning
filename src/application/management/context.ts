import {
  authorize,
  type HospitalAdminAction,
} from "../../domain/authz/policies";
import { unwrap } from "../../domain/shared/result";
import { assertActiveAdminRemains } from "../../domain/management/lifecycle";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  countUsableHospitalAdmins,
  lockHospitalAdministration,
} from "../../infrastructure/repositories/management";
import {
  findUserById,
  type UserRecord,
} from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import type { UnitOfWork } from "../use-case";

/** Recheck database authority after the lock: a waiting stale admin request fails closed. */
export async function authorizeAdministration(
  uow: UnitOfWork,
  action: HospitalAdminAction,
): Promise<void> {
  uow.authorize(action, {});
  await lockHospitalAdministration(uow.tx);
  const current = await findUserById(uow.tx, uow.actor.userId);
  unwrap(
    authorize(
      {
        ...uow.actor,
        isActive: current?.isActive ?? false,
        isHospitalAdmin: current?.isHospitalAdmin ?? false,
      },
      action,
      {},
    ),
  );
}

export async function requireUser(uow: UnitOfWork, userId: string) {
  const user = await findUserById(uow.tx, userId);
  if (!user) throw new NotFoundError("User");
  return user;
}

/** Called after authorizeAdministration, under its shared transaction lock. */
export async function assertUsableAdminRemains(
  uow: UnitOfWork,
  before: Pick<UserRecord, "isActive" | "isHospitalAdmin">,
  after: Pick<UserRecord, "isActive" | "isHospitalAdmin">,
  hasCredentials: boolean,
) {
  const usable = (account: typeof before) =>
    account.isActive && account.isHospitalAdmin && hasCredentials;
  assertActiveAdminRemains({
    wasActiveAdmin: usable(before),
    willBeActiveAdmin: usable(after),
    activeAdminCount: await countUsableHospitalAdmins(uow.tx),
  });
}

export async function requireRelationTargets(
  uow: UnitOfWork,
  userId: string,
  departmentId: string,
) {
  await requireUser(uow, userId);
  const department = await findDepartmentById(uow.tx, departmentId);
  if (!department?.isActive) throw new NotFoundError("Department");
}
