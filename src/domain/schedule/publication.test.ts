import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { shiftPublication, type ShiftPublication } from "./publication";
import type { ScheduleStatus } from "./status";
import { nurseScheduleView } from "./visibility";

const revisionDates = [isoDate("2026-11-02")];

describe("shiftPublication", () => {
  it.each<[ScheduleStatus, boolean, ShiftPublication]>([
    // D11 as amended: the working copy is visible while planning, as temporary.
    ["DRAFT", false, "TEMPORARY"],
    ["PLANNING", false, "TEMPORARY"],
    // The finalized working copy, before any approval.
    ["FINALIZED", false, "FINALIZED"],
    ["RETURNED", false, "RETURNED"],
    ["SUBMITTED", false, "AWAITING_APPROVAL"],
    // Once approved, always the approved version, whatever the revision does.
    ["APPROVED", true, "OFFICIAL"],
    ["REVISING", true, "OFFICIAL"],
    ["SUBMITTED", true, "OFFICIAL"],
    ["RETURNED", true, "OFFICIAL"],
  ])("%s (approved before: %s) → %s", (status, approved, expected) => {
    const view = nurseScheduleView({
      status,
      hasApprovedVersion: approved,
      revisionDates,
    });
    expect(shiftPublication(status, view)).toBe(expected);
  });

  it("never calls a working copy official, even in an approved status", () => {
    for (const status of ["APPROVED", "REVISING"] as const)
      expect(shiftPublication(status, { source: "WORKING_COPY" })).toBe(
        "TEMPORARY",
      );
  });
});
