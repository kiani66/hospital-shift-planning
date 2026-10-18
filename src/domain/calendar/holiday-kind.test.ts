import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { holidayKindOf } from "./holiday-kind";

describe("holidayKindOf", () => {
  it("marks every Friday as the weekly rest day, timezone-free", () => {
    // 1405-07-03 (2026-09-25) and 1405-08-01 (2026-10-23) are Fridays.
    expect(holidayKindOf(isoDate("2026-09-25"))).toBe("WEEKLY_REST");
    expect(holidayKindOf(isoDate("2026-10-23"))).toBe("WEEKLY_REST");
    expect(holidayKindOf(isoDate("2026-09-24"))).toBeNull();
    expect(holidayKindOf(isoDate("2026-09-26"))).toBeNull();
  });

  it("lets an official holiday share the same classification", () => {
    const official = new Set([isoDate("2026-09-24"), isoDate("2026-09-25")]);
    expect(holidayKindOf(isoDate("2026-09-24"), official)).toBe("OFFICIAL");
    expect(holidayKindOf(isoDate("2026-09-25"), official)).toBe("OFFICIAL");
    expect(holidayKindOf(isoDate("2026-09-23"), official)).toBeNull();
  });
});
