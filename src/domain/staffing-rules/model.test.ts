import { describe, expect, it } from "vitest";

import { bounds, content } from "../../../tests/support/staffing-rules";
import { isoDate, type IsoDate } from "../shared/dates";
import { validateRuleSetContent, type RuleSetContent } from "./model";

const exception = (date: string, period: "M" | "E" | "N", min = 4) => ({
  date: isoDate(date),
  period,
  bounds: bounds(min, 6),
  note: null,
});

describe("validateRuleSetContent", () => {
  it("accepts the pilot rule and an empty maximum (the legacy baseline)", () => {
    expect(validateRuleSetContent(content()).ok).toBe(true);
    expect(
      validateRuleSetContent(
        content({ normal: { M: bounds(1), E: bounds(1), N: bounds(1) } }),
      ).ok,
    ).toBe(true);
  });

  it("sorts exceptions by date, then M, E, N", () => {
    const result = validateRuleSetContent(
      content({
        exceptions: [
          exception("2026-11-02", "M"),
          exception("2026-11-01", "N"),
          exception("2026-11-01", "M"),
        ],
      }),
    );
    expect(
      result.ok && result.value.exceptions.map((e) => `${e.date}${e.period}`),
    ).toEqual(["2026-11-01M", "2026-11-01N", "2026-11-02M"]);
  });

  it("requires every NORMAL bucket", () => {
    const missing = {
      ...content(),
      normal: { M: bounds(1), E: bounds(1) },
    } as unknown as RuleSetContent;
    expect(validateRuleSetContent(missing)).toMatchObject({
      ok: false,
      error: { field: "N" },
    });
  });

  it.each([
    ["negative minimum", { M: bounds(-1, 6) }, "normal.M"],
    ["fractional minimum", { E: bounds(1.5, 6) }, "normal.E"],
    ["minimum above 99", { N: bounds(100, null) }, "normal.N"],
    ["maximum above 99", { M: bounds(1, 100) }, "normal.M"],
    ["maximum below minimum", { M: bounds(4, 3) }, "normal.M"],
  ])("rejects a %s", (_, override, field) => {
    expect(
      validateRuleSetContent(
        content({ normal: { ...content().normal, ...override } }),
      ),
    ).toMatchObject({ ok: false, error: { field } });
  });

  it("checks HOLIDAY bounds when present", () => {
    expect(
      validateRuleSetContent(content({ holiday: { E: bounds(5, 2) } })),
    ).toMatchObject({ ok: false, error: { field: "holiday.E" } });
    expect(
      validateRuleSetContent(content({ holiday: { E: bounds(2, 4) } })).ok,
    ).toBe(true);
  });

  it("rejects an invalid exception date, a duplicate and bad exception bounds", () => {
    expect(
      validateRuleSetContent(
        content({
          exceptions: [
            { ...exception("2026-11-01", "M"), date: "2026-02-30" as IsoDate },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, error: { field: "exceptions" } });
    expect(
      validateRuleSetContent(
        content({
          exceptions: [
            exception("2026-11-01", "M"),
            exception("2026-11-01", "M", 5),
          ],
        }),
      ),
    ).toMatchObject({ ok: false, error: { field: "exceptions" } });
    expect(
      validateRuleSetContent(
        content({
          exceptions: [
            { ...exception("2026-11-01", "M"), bounds: bounds(7, 6) },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, error: { field: "exceptions" } });
  });
});
