import { describe, expect, it } from "vitest";

import { isoDate, type IsoDate } from "../shared/dates";
import { InvalidStateError, ValidationError } from "../shared/errors";
import type { Assignment } from "../shifts/assignment";
import type { ShiftCode } from "../shifts/shift-type";
import { planAssignmentEdits } from "./assignment-editing";
import {
  applyAssignmentEdits,
  planChangeTarget,
  planRevisionDiscard,
  SCHEDULE_CHANGE_REFUSALS,
} from "./schedule-change";
import { transition } from "./state-machine";
import type { ScheduleStatus } from "./status";

const d = isoDate;
const today = d("2026-10-24");
const period = { start: d("2026-10-23"), end: d("2026-11-21") };

const target = (
  status: ScheduleStatus,
  options: {
    hasApprovedVersion?: boolean;
    openRevisionDates?: IsoDate[] | null;
    dates?: IsoDate[];
  } = {},
) =>
  planChangeTarget({
    status,
    hasApprovedVersion: options.hasApprovedVersion ?? false,
    openRevisionDates: options.openRevisionDates
      ? new Set(options.openRevisionDates)
      : null,
    dates: options.dates ?? [d("2026-10-26"), d("2026-10-25")],
    today,
  });

const value = (result: ReturnType<typeof target>) => {
  if (!result.ok) throw result.error;
  return result.value;
};

describe("planChangeTarget", () => {
  it("writes a never-approved finalized schedule's working copy", () => {
    expect(value(target("FINALIZED"))).toEqual({
      mode: "WORKING_COPY",
      status: "FINALIZED",
      revisionDates: null,
      addedRevisionDates: [],
    });
    expect(value(target("RETURNED")).mode).toBe("WORKING_COPY");
  });

  it("never edits an APPROVED schedule in place: it opens a revision scoped to the days", () => {
    const result = value(target("APPROVED", { hasApprovedVersion: true }));
    expect(result.mode).toBe("START_REVISION");
    expect(result.status).toBe("REVISING");
    expect([...result.revisionDates!]).toEqual(["2026-10-25", "2026-10-26"]);
    expect(result.addedRevisionDates).toEqual(["2026-10-25", "2026-10-26"]);
    // The lifecycle agrees: APPROVED → REVISING is START_REVISION.
    expect(transition("APPROVED", { type: "START_REVISION" })).toEqual({
      ok: true,
      value: result.status,
    });
  });

  it("extends an open revision by the days not yet in its scope", () => {
    const result = value(
      target("REVISING", {
        hasApprovedVersion: true,
        openRevisionDates: [d("2026-10-25"), d("2026-11-01")],
      }),
    );
    expect(result.mode).toBe("EXTEND_REVISION");
    expect(result.addedRevisionDates).toEqual(["2026-10-26"]);
    expect([...result.revisionDates!].sort()).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-11-01",
    ]);
  });

  it("extends a returned revision, even if its scope could not be read", () => {
    const result = value(target("RETURNED", { hasApprovedVersion: true }));
    expect(result.mode).toBe("EXTEND_REVISION");
    expect(result.status).toBe("RETURNED");
    expect(result.addedRevisionDates).toEqual(["2026-10-25", "2026-10-26"]);
  });

  it.each<[ScheduleStatus, string]>([
    ["DRAFT", SCHEDULE_CHANGE_REFUSALS.NOT_FINALIZED],
    ["PLANNING", SCHEDULE_CHANGE_REFUSALS.NOT_FINALIZED],
    ["SUBMITTED", SCHEDULE_CHANGE_REFUSALS.SUBMITTED],
  ])("refuses a change while %s", (status, attempted) => {
    const result = target(status, { hasApprovedVersion: true });
    expect(!result.ok && result.error).toBeInstanceOf(InvalidStateError);
    expect(!result.ok && (result.error as InvalidStateError).attempted).toBe(
      attempted,
    );
  });

  it("refuses past days (no historical correction) but allows today", () => {
    const past = target("FINALIZED", { dates: [d("2026-10-23")] });
    expect(!past.ok && past.error).toBeInstanceOf(ValidationError);
    expect(target("FINALIZED", { dates: [today] }).ok).toBe(true);
  });

  it("lets the existing editing rules accept exactly the planned days (D14)", () => {
    const planned = value(target("APPROVED", { hasApprovedVersion: true }));
    const plan = (date: string) =>
      planAssignmentEdits({
        edits: [{ nurseId: "sara", date: d(date), shift: "E" }],
        current: new Map(),
        rosterNurseIds: new Set(["sara"]),
        schedule: {
          status: planned.status,
          period,
          revisionDates: planned.revisionDates,
        },
      });
    expect(plan("2026-10-25").ok).toBe(true);
    expect(plan("2026-10-27").ok).toBe(false);
  });
});

const a = (nurseId: string, date: string, shift: ShiftCode): Assignment => ({
  nurseId,
  date: d(date),
  shift,
});

describe("applyAssignmentEdits", () => {
  it("sets, changes and clears cells without touching the others", () => {
    const before = [a("sara", "2026-10-25", "M"), a("ali", "2026-10-25", "E")];
    const after = applyAssignmentEdits(before, [
      { nurseId: "sara", date: d("2026-10-25"), shift: null },
      { nurseId: "ali", date: d("2026-10-25"), shift: "N" },
      { nurseId: "reza", date: d("2026-10-26"), shift: "M" },
    ]);
    expect(after).toEqual([
      a("ali", "2026-10-25", "N"),
      a("reza", "2026-10-26", "M"),
    ]);
    expect(before).toHaveLength(2);
  });
});

describe("planRevisionDiscard", () => {
  it("restores every cell that differs from the approved version", () => {
    const approved = [
      a("sara", "2026-10-25", "M"),
      a("ali", "2026-10-25", "E"),
      a("reza", "2026-10-27", "N"),
    ];
    const working = [
      a("sara", "2026-10-25", "E"),
      a("reza", "2026-10-27", "N"),
      a("reza", "2026-10-26", "M"),
    ];
    expect(planRevisionDiscard({ working, approved })).toEqual([
      { nurseId: "ali", date: "2026-10-25", before: null, after: "E" },
      { nurseId: "sara", date: "2026-10-25", before: "E", after: "M" },
      { nurseId: "reza", date: "2026-10-26", before: "M", after: null },
    ]);
  });

  it("changes nothing when the working copy equals the approved version", () => {
    const approved = [a("sara", "2026-10-25", "M")];
    expect(planRevisionDiscard({ working: approved, approved })).toEqual([]);
  });
});
