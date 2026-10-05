import { addDays } from "../../src/domain/shared/dates";
import { periodDays } from "../../src/domain/shared/period";
import { countByShift, coverageOf } from "../../src/domain/shifts/coverage";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import type { DbExecutor } from "../../src/infrastructure/db/database";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";

/** Test data only: keep supplied decisions, explicitly decide the remaining cells and staff the baseline. */
export async function completeScheduleFixture(
  db: DbExecutor,
  scheduleId: string,
  priorityIds: readonly string[] = [],
) {
  const schedule = (await findScheduleById(db, scheduleId))!;
  const roster = await listRoster(db, scheduleId);
  const priority = [...priorityIds, ...roster.map((r) => r.userId)].filter(
    (id, index, all) =>
      all.indexOf(id) === index && roster.some((r) => r.userId === id),
  );
  const current = new Map(
    (await listAssignments(db, scheduleId)).map((a) => [
      `${a.nurseId}|${a.date}`,
      a.shift,
    ]),
  );
  const key = (id: string, date: string) => `${id}|${date}`;
  for (const date of periodDays(schedule.period)) {
    const write = async (nurseId: string, shift: AssignmentCode) => {
      await setAssignment(db, {
        scheduleId,
        userId: nurseId,
        date,
        shift,
        updatedBy: schedule.createdBy,
      });
      current.set(key(nurseId, date), shift);
    };
    for (const r of roster)
      if (!current.has(key(r.userId, date))) await write(r.userId, "OFF");
    const coverage = () =>
      coverageOf(
        countByShift(roster.map((r) => current.get(key(r.userId, date))!)),
      );
    const candidate = (night: boolean) =>
      (night ? [...priority.slice(1), priority[0]!] : priority).find(
        (id) =>
          current.get(key(id, date)) === "OFF" &&
          current.get(key(id, addDays(date, -1))) !== "N" &&
          (!night ||
            !["M", "E", "N", "ME"].includes(
              current.get(key(id, addDays(date, 1))) ?? "OFF",
            )),
      );
    // A stable extra ME decision keeps legacy request fixtures staffed when a
    // nonessential working decision is removed; night staffing uses other nurses.
    const lead = priorityIds[0];
    if (
      lead &&
      current.get(key(lead, date)) === "OFF" &&
      current.get(key(lead, addDays(date, -1))) !== "N"
    )
      await write(lead, "ME");
    const covered = coverage();
    if (!covered.M || !covered.E) {
      const nurseId = candidate(false);
      if (!nurseId) throw new Error(`Fixture cannot staff M/E on ${date}`);
      await write(
        nurseId,
        !covered.M && !covered.E ? "ME" : !covered.M ? "M" : "E",
      );
    }
    if (!coverage().N) {
      const nurseId = candidate(true);
      if (!nurseId) throw new Error(`Fixture cannot staff N on ${date}`);
      await write(nurseId, "N");
    }
  }
}
