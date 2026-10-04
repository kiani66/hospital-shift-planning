import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { SCHEDULE_STATUSES } from "./status";
import {
  checkRosterEditable,
  rosterRoleForPeriod,
  type PeriodMembership,
} from "./roster-editing";

const period = { start: isoDate("2026-10-23"), end: isoDate("2026-11-21") };
const m = (
  role: PeriodMembership["role"],
  startedOn: string,
  endedOn: string | null = null,
): PeriodMembership => ({
  role,
  startedOn: isoDate(startedOn),
  endedOn: endedOn === null ? null : isoDate(endedOn),
});

describe("checkRosterEditable", () => {
  it.each(SCHEDULE_STATUSES)("%s", (status) => {
    const result = checkRosterEditable(status);
    if (status === "DRAFT" || status === "PLANNING")
      expect(result).toEqual({ ok: true, value: undefined });
    else
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_STATE", attempted: "ADD_TO_ROSTER", status },
      });
  });
});

describe("rosterRoleForPeriod", () => {
  it("is eligible when a membership covers at least one day (inclusive bounds)", () => {
    expect(rosterRoleForPeriod([m("NURSE", "2026-11-21")], period)).toBe(
      "NURSE",
    );
    expect(
      rosterRoleForPeriod([m("NURSE", "2026-01-01", "2026-10-23")], period),
    ).toBe("NURSE");
  });

  it("is not eligible outside the period or without memberships", () => {
    expect(rosterRoleForPeriod([], period)).toBeNull();
    expect(rosterRoleForPeriod([m("NURSE", "2026-11-22")], period)).toBeNull();
    expect(
      rosterRoleForPeriod([m("NURSE", "2026-01-01", "2026-10-22")], period),
    ).toBeNull();
  });

  it("uses the latest-starting membership, like the creation snapshot", () => {
    expect(
      rosterRoleForPeriod(
        [m("NURSE", "2026-01-01", "2026-10-31"), m("HEAD_NURSE", "2026-11-01")],
        period,
      ),
    ).toBe("HEAD_NURSE");
    expect(
      rosterRoleForPeriod(
        [m("HEAD_NURSE", "2026-11-01"), m("NURSE", "2026-01-01", "2026-10-31")],
        period,
      ),
    ).toBe("HEAD_NURSE");
  });
});
