import { describe, expect, it } from "vitest";

import { isoDate, type IsoDate } from "../shared/dates";
import { canEditAssignment } from "./assignment-editing";
import type { ScheduleStatus } from "./status";

const period = { start: isoDate("2026-03-21"), end: isoDate("2026-04-20") };
const revision = new Set<IsoDate>([
  isoDate("2026-04-08"),
  isoDate("2026-04-09"),
]);

describe("canEditAssignment (Head Nurse, by schedule state)", () => {
  it.each<[ScheduleStatus, string, ReadonlySet<IsoDate> | null, string | true]>(
    [
      ["DRAFT", "2026-03-25", null, true],
      ["PLANNING", "2026-03-25", null, true],
      ["FINALIZED", "2026-03-25", null, true], // corrections after finalizing
      ["SUBMITTED", "2026-03-25", null, "SCHEDULE_LOCKED"],
      ["APPROVED", "2026-04-08", null, "SCHEDULE_LOCKED"],
      ["RETURNED", "2026-03-25", null, true], // first-cycle return: whole period
      ["RETURNED", "2026-04-08", revision, true], // returned revision: scope only
      ["RETURNED", "2026-03-25", revision, "DATE_OUTSIDE_REVISION_SCOPE"],
      ["REVISING", "2026-04-09", revision, true],
      ["REVISING", "2026-04-10", revision, "DATE_OUTSIDE_REVISION_SCOPE"],
      ["REVISING", "2026-04-09", null, "DATE_OUTSIDE_REVISION_SCOPE"], // no scope, no edits
      ["PLANNING", "2026-03-20", null, "DATE_OUTSIDE_PERIOD"],
      ["PLANNING", "2026-04-21", null, "DATE_OUTSIDE_PERIOD"],
    ],
  )("%s on %s (revision=%j) → %s", (status, date, revisionDates, expected) => {
    const decision = canEditAssignment({
      status,
      period,
      date: isoDate(date),
      revisionDates,
    });
    expect(decision).toEqual(
      expected === true
        ? { allowed: true }
        : { allowed: false, reason: expected },
    );
  });
});
