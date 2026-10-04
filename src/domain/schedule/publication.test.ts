import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { shiftPublication, type ShiftPublication } from "./publication";
import type { ScheduleStatus } from "./status";
import { nurseScheduleView } from "./visibility";

const revisionDates = [isoDate("2026-11-02")];

describe("shiftPublication", () => {
  it.each<[ScheduleStatus, boolean, ShiftPublication]>([
    // D11: nothing is shown while the Head Nurse plans.
    ["DRAFT", false, "NOT_PUBLISHED"],
    ["PLANNING", false, "NOT_PUBLISHED"],
    // The finalized working copy, before any approval.
    ["FINALIZED", false, "TEMPORARY"],
    ["RETURNED", false, "TEMPORARY"],
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
});
