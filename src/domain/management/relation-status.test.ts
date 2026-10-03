import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import { relationStatus } from "./relation-status";

describe("relationStatus", () => {
  it.each([
    ["2026-10-04", null, "FUTURE"],
    ["2026-10-04", "2026-10-04", "FUTURE"],
    ["2026-01-01", "2026-10-02", "ENDED"],
    ["2026-01-01", "2026-10-03", "CURRENT"],
    ["2026-10-03", "2026-10-03", "CURRENT"],
    ["2026-01-01", "2026-12-31", "CURRENT"],
    ["2026-10-03", null, "CURRENT"],
    ["2026-01-01", null, "CURRENT"],
  ] as const)(
    "%s..%s is %s on the inclusive boundary",
    (start, end, expected) => {
      expect(
        relationStatus(
          {
            startedOn: isoDate(start),
            endedOn: end === null ? null : isoDate(end),
          },
          isoDate("2026-10-03"),
        ),
      ).toBe(expected);
    },
  );
});
