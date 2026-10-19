import { expect, it } from "vitest";

import { isoDate } from "../../domain/shared/dates";
import { assignmentInterval } from "../../domain/shifts/interval";
import { zonedInstantAt } from "./zoned-time";

it("resolves Tehran wall time independently of server or browser timezone", () => {
  const at = zonedInstantAt("Asia/Tehran");
  expect(new Date(at(isoDate("2026-10-24"), "07:00")).toISOString()).toBe(
    "2026-10-24T03:30:00.000Z",
  );
  expect(
    new Date(
      assignmentInterval(isoDate("2026-10-24"), "N", at)!.end,
    ).toISOString(),
  ).toBe("2026-10-25T03:30:00.000Z");
});

it("resolves each endpoint across a timezone's daylight-saving transition", () => {
  const shift = assignmentInterval(
    isoDate("2026-10-31"),
    "N",
    zonedInstantAt("America/New_York"),
  )!;
  expect(shift.end - shift.start).toBe(13 * 3600_000);
});
