import { describe, expect, it } from "vitest";

import { isoDate, type IsoDate } from "../shared/dates";
import type { ValidationError } from "../shared/errors";
import {
  ASSIGNMENT_EDIT_REFUSALS,
  assignmentKey,
  canEditAssignment,
  planAssignmentEdits,
  revertChanges,
} from "./assignment-editing";
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

describe("planAssignmentEdits (one logical edit, all or nothing)", () => {
  const nurse = "nurse-1";
  const head = "head-1";
  const roster = new Set([nurse, head]);
  const d = (date: string) => isoDate(date);
  const plan = (
    edits: Parameters<typeof planAssignmentEdits>[0]["edits"],
    options: {
      current?: [string, IsoDate, "M" | "E" | "N" | "ME"][];
      status?: ScheduleStatus;
      revisionDates?: ReadonlySet<IsoDate> | null;
    } = {},
  ) =>
    planAssignmentEdits({
      edits,
      current: new Map(
        (options.current ?? []).map(([id, date, shift]) => [
          assignmentKey(id, date),
          shift,
        ]),
      ),
      rosterNurseIds: roster,
      schedule: {
        status: options.status ?? "PLANNING",
        period,
        revisionDates: options.revisionDates ?? null,
      },
    });

  it("assigns, changes and clears in one request, with the replaced values", () => {
    const result = plan(
      [
        { nurseId: nurse, date: d("2026-03-25"), shift: "M" },
        { nurseId: nurse, date: d("2026-03-26"), shift: "ME" },
        { nurseId: nurse, date: d("2026-03-27"), shift: null },
      ],
      {
        current: [
          [nurse, d("2026-03-26"), "N"],
          [nurse, d("2026-03-27"), "E"],
        ],
      },
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { nurseId: nurse, date: "2026-03-25", before: null, after: "M" },
        { nurseId: nurse, date: "2026-03-26", before: "N", after: "ME" },
        { nurseId: nurse, date: "2026-03-27", before: "E", after: null },
      ],
    });
  });

  it("gives the Head Nurse shifts like any rostered nurse", () => {
    expect(
      plan([{ nurseId: head, date: d("2026-03-25"), shift: "N" }]),
    ).toEqual({
      ok: true,
      value: [{ nurseId: head, date: "2026-03-25", before: null, after: "N" }],
    });
  });

  it("drops edits that repeat the stored value (idempotent), clearing nothing included", () => {
    const result = plan(
      [
        { nurseId: nurse, date: d("2026-03-25"), shift: "M" },
        { nurseId: nurse, date: d("2026-03-26"), shift: null },
      ],
      { current: [[nurse, d("2026-03-25"), "M"]] },
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("does not apply night rest: a violation is allowed while editing (D7)", () => {
    const result = plan(
      [{ nurseId: nurse, date: d("2026-03-26"), shift: "M" }],
      {
        current: [[nurse, d("2026-03-25"), "N"]],
      },
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an empty request, a repeated cell and a nurse off the roster", () => {
    const refusal = (result: ReturnType<typeof plan>) =>
      result.ok
        ? null
        : [result.error.code, (result.error as ValidationError).field];
    expect(refusal(plan([]))).toEqual(["VALIDATION", "changes"]);
    expect(
      refusal(
        plan([
          { nurseId: nurse, date: d("2026-03-25"), shift: "M" },
          { nurseId: nurse, date: d("2026-03-25"), shift: "E" },
        ]),
      ),
    ).toEqual(["VALIDATION", "changes"]);
    expect(
      refusal(
        plan([{ nurseId: "stranger", date: d("2026-03-25"), shift: "M" }]),
      ),
    ).toEqual(["VALIDATION", "nurseId"]);
    expect(
      refusal(plan([{ nurseId: nurse, date: d("2026-04-21"), shift: "M" }])),
    ).toEqual(["VALIDATION", "date"]);
  });

  it("refuses every cell of a request when one is not editable in the schedule's state", () => {
    const locked = plan(
      [{ nurseId: nurse, date: d("2026-03-25"), shift: "M" }],
      {
        status: "SUBMITTED",
      },
    );
    expect(locked.ok).toBe(false);
    expect(!locked.ok && locked.error).toMatchObject({
      code: "INVALID_STATE",
      status: "SUBMITTED",
      attempted: ASSIGNMENT_EDIT_REFUSALS.SCHEDULE_LOCKED,
    });

    const scoped = plan(
      [
        { nurseId: nurse, date: d("2026-04-08"), shift: "M" },
        { nurseId: nurse, date: d("2026-04-10"), shift: "M" },
      ],
      { status: "REVISING", revisionDates: revision },
    );
    expect(!scoped.ok && scoped.error).toMatchObject({
      code: "INVALID_STATE",
      attempted: ASSIGNMENT_EDIT_REFUSALS.DATE_OUTSIDE_REVISION_SCOPE,
    });
  });

  it("reverts changes to the values they replaced (undo)", () => {
    expect(
      revertChanges([
        { nurseId: nurse, date: d("2026-03-25"), before: null, after: "M" },
        { nurseId: nurse, date: d("2026-03-26"), before: "N", after: null },
      ]),
    ).toEqual([
      { nurseId: nurse, date: "2026-03-25", shift: null },
      { nurseId: nurse, date: "2026-03-26", shift: "N" },
    ]);
  });
});
