import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import {
  checkWindowNurses,
  preferenceCollectionState,
  type PreferenceWindow,
} from "./preference-window";

const NOW = new Date("2026-10-01T08:00:00Z");

const window = (
  overrides: Partial<PreferenceWindow> = {},
): PreferenceWindow => ({
  kind: "INITIAL",
  dates: new Set([isoDate("2026-10-23")]),
  nurseIds: new Set(),
  closesAt: null,
  closedAt: null,
  ...overrides,
});

describe("preferenceCollectionState", () => {
  it("is NONE before any window was opened", () => {
    expect(preferenceCollectionState([], NOW)).toBe("NONE");
  });

  it("is OPEN while any window is active", () => {
    const closed = window({ closedAt: new Date("2026-09-30T08:00:00Z") });
    expect(preferenceCollectionState([closed, window()], NOW)).toBe("OPEN");
  });

  it("is CLOSED when every window was closed or passed its deadline", () => {
    const closed = window({ closedAt: new Date("2026-09-30T08:00:00Z") });
    const expired = window({ closesAt: new Date("2026-10-01T07:59:59Z") });
    expect(preferenceCollectionState([closed, expired], NOW)).toBe("CLOSED");
  });
});

describe("checkWindowNurses", () => {
  const roster = new Set(["a", "b", "c"]);

  it("accepts an empty scope (whole roster)", () => {
    expect(checkWindowNurses([], roster)).toEqual({ ok: true, value: [] });
  });

  it("de-duplicates and sorts roster members", () => {
    expect(checkWindowNurses(["c", "a", "c"], roster)).toEqual({
      ok: true,
      value: ["a", "c"],
    });
  });

  it("rejects nurses who are not on the roster", () => {
    const result = checkWindowNurses(["a", "x", "y"], roster);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.field).toBe("nurseIds");
    expect(!result.ok && result.error.message).toContain("2 selected");
  });
});
