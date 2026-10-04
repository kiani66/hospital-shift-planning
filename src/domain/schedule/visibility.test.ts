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

describe("nurseScheduleView (D11 as amended)", () => {
  it.each<[ScheduleStatus, boolean, NurseScheduleView]>([
    // Before the first approval: the working copy, planning included.
    ["DRAFT", false, { source: "WORKING_COPY" }],
    ["PLANNING", false, { source: "WORKING_COPY" }],
    ["FINALIZED", false, { source: "WORKING_COPY" }],
    ["SUBMITTED", false, { source: "WORKING_COPY" }],
    ["RETURNED", false, { source: "WORKING_COPY" }],
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

  it("never shows the working copy once a version is approved", () => {
    for (const status of ["REVISING", "SUBMITTED", "RETURNED"] as const)
      expect(
        nurseScheduleView({ status, hasApprovedVersion: true, revisionDates })
          .source,
      ).toBe("APPROVED_VERSION");
  });
});
