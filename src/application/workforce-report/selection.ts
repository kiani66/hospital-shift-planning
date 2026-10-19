import { z } from "zod";

import { decide } from "../../domain/authz/policies";
import { isInPeriod, type DatePeriod } from "../../domain/shared/period";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import { listSchedulesForDepartment } from "../../infrastructure/repositories/schedules";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";

/** Navigation metadata only. getWorkforceReport remains authoritative for source eligibility. */
export async function getWorkforceReportSelection(
  ctx: AppContext,
  input: { departmentId: string; period: DatePeriod; scheduleId?: string },
) {
  if (
    !z.uuid().safeParse(input.departmentId).success ||
    !decide(ctx.actor, "department.manage", {
      departmentId: input.departmentId,
    }).allowed ||
    (input.scheduleId !== undefined &&
      !z.uuid().safeParse(input.scheduleId).success)
  )
    throw new NotFoundError("Schedule");

  return ctx.db.transaction(
    async (tx) => {
      const all = await listSchedulesForDepartment(tx, input.departmentId);
      const schedules = all
        .filter(
          (s) =>
            s.period.start <= input.period.end &&
            s.period.end >= input.period.start,
        )
        .sort(
          (a, b) =>
            a.period.start.localeCompare(b.period.start) ||
            a.id.localeCompare(b.id),
        );
      const selected = input.scheduleId
        ? schedules.find((s) => s.id === input.scheduleId)
        : schedules.length === 1
          ? schedules[0]
          : undefined;
      if (input.scheduleId && !selected) throw new NotFoundError("Schedule");
      const revision = selected?.currentVersionId
        ? await findOpenRevision(tx, selected.id)
        : null;
      return {
        schedules: schedules.map(({ id, label, period }) => ({
          id,
          label,
          period,
        })),
        selectedId: selected?.id ?? null,
        // Advisory only: approval or discard can race navigation. The report
        // query rechecks all version metadata and revision scope in its snapshot.
        revisionDraftAvailable: !!(
          selected &&
          revision &&
          revision.scheduleId === selected.id &&
          revision.status === "OPEN" &&
          revision.dates.every((date) => isInPeriod(selected.period, date))
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
