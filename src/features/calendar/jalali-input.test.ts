import { describe, expect, it } from "vitest";

import { isoDate } from "@/domain/shared/dates";

import { formatJalaliInput, parseJalaliInput } from "./jalali-input";

describe("typed Jalali dates", () => {
  it.each(["1405/07/11", "۱۴۰۵/۰۷/۱۱", "١٤٠٥/٠٧/١١", " 1405-7-11 "])(
    "converts %s using the calendar adapter",
    (text) => {
      expect(parseJalaliInput(text)).toBe("2026-10-03");
    },
  );
  it.each([
    null,
    1405,
    "",
    "2026-10-03",
    "1405/13/01",
    "1405/00/01",
    "1405/07/00",
    "1405/07/31",
    "1405/01/32",
    "1299/01/01",
    "1501/01/01",
    "1405/7",
    "date",
  ])("rejects invalid or unsupported input %s", (text) => {
    expect(parseJalaliInput(text)).toBeNull();
  });
  it("respects leap-year Esfand boundaries", () => {
    expect(parseJalaliInput("1399/12/30")).toBe("2021-03-20");
    expect(parseJalaliInput("1400/12/30")).toBeNull();
  });
  it.each(["1921-03-21", "2026-10-03", "2027-03-20", "2121-03-21"])(
    "round-trips ISO day %s with Persian digits",
    (text) => {
      const date = isoDate(text);
      const display = formatJalaliInput(date);
      expect(display).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
      expect(parseJalaliInput(display)).toBe(date);
    },
  );
});
