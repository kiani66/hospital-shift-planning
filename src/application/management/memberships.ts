import { z } from "zod";

import {
  predecessorEnd,
  validateRelationDates,
  validateRelationEnd,
} from "../../domain/management/lifecycle";
import { ValidationError } from "../../domain/shared/errors";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import {
  findMembership,
  insertMembership,
  updateMembershipEnd,
} from "../../infrastructure/repositories/management";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand } from "../use-case";
import { authorizeAdministration, requireRelationTargets } from "./context";
import { endRelationInput, managementDay, relationInput } from "./input";

const membershipInput = relationInput.extend({
  role: z.enum(["NURSE", "HEAD_NURSE"]),
});

export const addDepartmentMembership = defineCommand({
  name: "membership.add",
  input: membershipInput,
  async handler(uow, input) {
    await authorizeAdministration(uow, "membership.add");
    validateRelationDates(input);
    await requireRelationTargets(uow, input.userId, input.departmentId);
    const id = await insertMembership(uow.tx, input);
    await uow.audit({
      action: "membership.added",
      entityType: "membership",
      entityId: id,
      departmentId: input.departmentId,
      data: { after: input },
    });
    return { id, ...input };
  },
});

export const endDepartmentMembership = defineCommand({
  name: "membership.end",
  input: endRelationInput,
  async handler(uow, input) {
    await authorizeAdministration(uow, "membership.end");
    const before = await findMembership(uow.tx, input.relationId);
    if (!before) throw new NotFoundError("Membership");
    if (before.endedOn !== input.expectedEndedOn) throw new ConflictError();
    validateRelationEnd(before, input.endedOn, todayIn(APP_TIMEZONE, uow.now));
    if (before.endedOn === input.endedOn) return before;
    await updateMembershipEnd(uow.tx, before.id, input.endedOn);
    await uow.audit({
      action: "membership.ended",
      entityType: "membership",
      entityId: before.id,
      departmentId: before.departmentId,
      data: { before, after: { ...before, endedOn: input.endedOn } },
    });
    return { ...before, endedOn: input.endedOn };
  },
});

/** Same department means role transition; another department means transfer. */
export const transitionDepartmentMembership = defineCommand({
  name: "membership.transition",
  input: z.object({
    relationId: z.uuid(),
    expectedEndedOn: managementDay.nullable(),
    departmentId: z.uuid(),
    role: z.enum(["NURSE", "HEAD_NURSE"]),
    startedOn: managementDay,
    // Require an explicit successor term; never silently extend a fixed-term contract.
    endedOn: managementDay.nullable(),
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "membership.transition");
    const before = await findMembership(uow.tx, input.relationId);
    if (!before) throw new NotFoundError("Membership");
    if (before.endedOn !== input.expectedEndedOn) throw new ConflictError();
    if (
      before.departmentId === input.departmentId &&
      before.role === input.role
    )
      throw new ValidationError(
        "Transition must change department or role",
        "role",
      );
    validateRelationDates(input);
    const endedOn = predecessorEnd(
      before,
      input.startedOn,
      todayIn(APP_TIMEZONE, uow.now),
    );
    await requireRelationTargets(uow, before.userId, input.departmentId);
    await updateMembershipEnd(uow.tx, before.id, endedOn);
    const successor = {
      userId: before.userId,
      departmentId: input.departmentId,
      role: input.role,
      startedOn: input.startedOn,
      endedOn: input.endedOn,
    };
    const id = await insertMembership(uow.tx, successor);
    await uow.audit({
      action:
        before.departmentId === input.departmentId
          ? "membership.roleChanged"
          : "membership.transferred",
      entityType: "membership",
      entityId: before.id,
      departmentId: before.departmentId,
      data: {
        before,
        predecessor: { ...before, endedOn },
        successor: { id, ...successor },
      },
    });
    return {
      predecessor: { ...before, endedOn },
      successor: { id, ...successor },
    };
  },
});
