import { z } from "zod";

import { checkReason } from "../../domain/change-requests/reason";
import { isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import { listAssignmentsFor } from "../../infrastructure/repositories/assignments";
import { findChangeReason } from "../../infrastructure/repositories/change-reasons";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import { loadScheduleForAssignmentUpdate } from "./load-for-update";
import {
  writeScheduleChange,
  type ScheduleChangeResult,
} from "./schedule-changes";

export const directSwapInput = z.object({
  scheduleId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  date: z
    .string()
    .refine(isIsoDate)
    .transform((date) => date as IsoDate),
  firstNurseId: z.uuid(),
  secondNurseId: z.uuid(),
  reasonCode: z.string().min(1).max(64),
  note: z.string().max(2000).nullish(),
});

/** Atomic, audited exchange of two explicit decisions, including OFF. */
export const directSwap = defineCommand({
  name: "schedule.directSwap",
  input: directSwapInput,
  async handler(uow, input): Promise<ScheduleChangeResult> {
    const schedule = await loadScheduleForAssignmentUpdate(
      uow,
      input.scheduleId,
    );
    uow.authorize("schedule.adjust", { departmentId: schedule.departmentId });
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();
    if (input.firstNurseId === input.secondNurseId)
      throw new ValidationError("Choose two different nurses", "secondNurseId");
    const stored = await listAssignmentsFor(uow.tx, {
      scheduleId: schedule.id,
      nurseIds: [input.firstNurseId, input.secondNurseId],
      dates: [input.date],
    });
    const first = stored.find((a) => a.nurseId === input.firstNurseId)?.shift;
    const second = stored.find((a) => a.nurseId === input.secondNurseId)?.shift;
    if (first === undefined || second === undefined || first === second)
      throw new ValidationError(
        "A swap needs two different explicit decisions",
        "changes",
      );
    const reason = unwrap(
      checkReason({
        reason: await findChangeReason(uow.tx, input.reasonCode),
        usage: "ADJUSTMENT",
        note: input.note,
      }),
    );
    const result = await writeScheduleChange(uow, schedule, {
      edits: [
        { nurseId: input.firstNurseId, date: input.date, shift: second },
        { nurseId: input.secondNurseId, date: input.date, shift: first },
      ],
      kind: "ADJUSTMENT",
      requestId: null,
      directSwap: true,
      reasonCode: reason.reasonCode,
      note: reason.note,
    });
    await uow.audit({
      action: "schedule.directSwapped",
      entityType: "schedule_change",
      entityId: result.changeId,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      reason: reason.reasonCode,
      data: {
        changeId: result.changeId,
        date: input.date,
        cells: result.changes,
        mode: result.mode,
        revisionId: result.revisionId,
        note: reason.note,
      },
    });
    return result;
  },
});
