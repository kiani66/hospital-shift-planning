import { z } from "zod";

import { transition } from "../../domain/schedule/state-machine";
import {
  compareIsoDates,
  parseIsoDate,
  uniqueSortedDates,
} from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import { isInPeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { startRevision as insertRevision } from "../../infrastructure/repositories/revisions";
import { ConflictError } from "../errors";
import { defineCommand } from "../use-case";
import { loadScheduleForUpdate, saveSchedule } from "./load-for-update";
import { todayFor } from "./schedule-changes";

/** Upper bound of a revision reason (plain text). */
export const REVISION_REASON_MAX_LENGTH = 500;

export interface StartRevisionOutput {
  readonly revisionId: string;
  readonly status: "REVISING";
  /** The schedule revision after the transition; send it with the next write. */
  readonly revision: number;
}

/**
 * The Head Nurse explicitly starts a revision of an APPROVED schedule
 * (D109): APPROVED → REVISING with a required reason and an optional
 * initial date scope (D14, never the whole month implicitly; today or
 * later, inside the period). The approved version stays the executable
 * schedule until the revision is approved. This is the path to change an
 * approved schedule's rule set: once REVISING, a Supervisor or Hospital
 * Admin may preview and apply another version (which adds the days it
 * makes need repair to this scope).
 */
export const startScheduleRevision = defineCommand({
  name: "schedule.startRevision",
  input: z.object({
    scheduleId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(REVISION_REASON_MAX_LENGTH),
    dates: z.array(z.string()).max(62).default([]),
  }),
  async handler(uow, input): Promise<StartRevisionOutput> {
    const schedule = await loadScheduleForUpdate(uow, input.scheduleId);
    uow.authorize("schedule.startRevision", {
      departmentId: schedule.departmentId,
    });
    if (schedule.revision !== input.expectedRevision) throw new ConflictError();
    const status = unwrap(
      transition(schedule.status, { type: "START_REVISION" }),
    );
    const today = todayFor(uow.now);
    const dates = uniqueSortedDates(
      input.dates.map((d) => unwrap(parseIsoDate(d, "dates"))),
    );
    if (
      dates.some(
        (d) => !isInPeriod(schedule.period, d) || compareIsoDates(d, today) < 0,
      )
    )
      throw new ValidationError(
        "Revision days must be inside the period and not in the past",
        "dates",
      );

    const revisionId = await insertRevision(uow.tx, {
      scheduleId: schedule.id,
      reason: input.reason,
      startedBy: uow.actor.userId,
      dates,
    });
    const saved = await saveSchedule(uow, schedule, { status });
    await uow.audit({
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      action: "revision.started",
      entityType: "revision",
      entityId: revisionId,
      reason: input.reason,
      data: {
        from: schedule.status,
        to: status,
        revisionId,
        dates,
        explicit: true,
        staffingRuleSetVersionId: schedule.staffingRuleSetVersionId,
      },
    });
    return { revisionId, status: "REVISING", revision: saved.revision };
  },
});
