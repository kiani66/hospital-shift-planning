import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import type { ScheduleStatus } from "./status";
import { nurseScheduleView, type NurseScheduleView } from "./visibility";

const revisionDates = [
  isoDate("2026-04-09"),
  isoDate("2026-04-08"),
  isoDate("2026-04-08"),
];
const pending = [isoDate("2026-04-08"), isoDate("2026-04-09")];

describe("nurseScheduleView", () => {
  it.each<[ScheduleStatus, boolean, NurseScheduleView]>([
    // Before the first approval
    ["DRAFT", false, { source: "NONE" }],
    ["PLANNING", false, { source: "NONE" }],
    ["FINALIZED", false, { source: "WORKING_COPY", pendingApproval: true }],
    ["SUBMITTED", false, { source: "WORKING_COPY", pendingApproval: true }],
    ["RETURNED", false, { source: "WORKING_COPY", pendingApproval: true }],
    // After approval: always the approved snapshot
    ["APPROVED", true, { source: "APPROVED_VERSION", pendingChangeDates: [] }],
    [
      "REVISING",
      true,
      {
        source: "APPROVED_VERSION",
        pendingChangeDates: pending,
      },
    ],
    [
      "SUBMITTED",
      true,
      {
        source: "APPROVED_VERSION",
        pendingChangeDates: pending,
      },
    ],
    [
      "RETURNED",
      true,
      {
        source: "APPROVED_VERSION",
        pendingChangeDates: pending,
      },
    ],
  ])("%s (approved before: %s)", (status, hasApprovedVersion, expected) => {
    expect(
      nurseScheduleView({ status, hasApprovedVersion, revisionDates }),
    ).toEqual(expected);
  });

  it("APPROVED never flags pending changes even if stale revision dates are passed", () => {
    expect(
      nurseScheduleView({
        status: "APPROVED",
        hasApprovedVersion: true,
        revisionDates,
      }),
    ).toEqual({
      source: "APPROVED_VERSION",
      pendingChangeDates: [],
    });
  });

  it("handles a revision with no dates supplied", () => {
    expect(
      nurseScheduleView({ status: "REVISING", hasApprovedVersion: true }),
    ).toEqual({
      source: "APPROVED_VERSION",
      pendingChangeDates: [],
    });
  });
});
