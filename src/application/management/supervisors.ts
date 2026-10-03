import { randomUUID } from "node:crypto";

import {
  validateRelationDates,
  validateRelationEnd,
} from "../../domain/management/lifecycle";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import {
  findSupervisorRelation,
  insertSupervisorRelation,
  updateSupervisorEnd,
} from "../../infrastructure/repositories/management";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand } from "../use-case";
import { authorizeAdministration, requireRelationTargets } from "./context";
import { endRelationInput, relationInput } from "./input";

export const assignDepartmentSupervisor = defineCommand({
  name: "supervisor.assign",
  input: relationInput,
  async handler(uow, input) {
    await authorizeAdministration(uow, "supervisor.assign");
    validateRelationDates(input);
    await requireRelationTargets(uow, input.userId, input.departmentId);
    const relation = { id: randomUUID(), ...input };
    await insertSupervisorRelation(uow.tx, relation);
    await uow.audit({
      action: "supervisor.assigned",
      entityType: "supervisorAssignment",
      entityId: relation.id,
      departmentId: input.departmentId,
      data: { after: relation },
    });
    return relation;
  },
});

export const endDepartmentSupervisor = defineCommand({
  name: "supervisor.end",
  input: endRelationInput,
  async handler(uow, input) {
    await authorizeAdministration(uow, "supervisor.end");
    const before = await findSupervisorRelation(uow.tx, input.relationId);
    if (!before) throw new NotFoundError("Supervisor assignment");
    if (before.endedOn !== input.expectedEndedOn) throw new ConflictError();
    validateRelationEnd(before, input.endedOn, todayIn(APP_TIMEZONE, uow.now));
    if (before.endedOn === input.endedOn) return before;
    await updateSupervisorEnd(uow.tx, before.id, input.endedOn);
    await uow.audit({
      action: "supervisor.ended",
      entityType: "supervisorAssignment",
      entityId: before.id,
      departmentId: before.departmentId,
      data: { before, after: { ...before, endedOn: input.endedOn } },
    });
    return { ...before, endedOn: input.endedOn };
  },
});
