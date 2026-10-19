import { describe, expect, it } from "vitest";
import { mapCopyDates } from "@/domain/schedule/copy";
import { jalaliMonthPeriod, toJalali } from "./jalali";

describe("copy mapping at the Jalali calendar boundary", () => {
  it.each([
    [{ year: 1405, month: 6 }, { year: 1405, month: 7 }, 31, 30],
    [{ year: 1403, month: 12 }, { year: 1404, month: 12 }, 30, 29],
    [{ year: 1404, month: 12 }, { year: 1405, month: 1 }, 29, 31],
    [{ year: 1404, month: 12 }, { year: 1403, month: 12 }, 29, 30],
    [{ year: 1405, month: 1 }, { year: 1404, month: 12 }, 31, 29],
  ] as const)(
    "maps real calendar months %j → %j without overflow",
    (from, to, sourceDays, targetDays) => {
      const map = mapCopyDates(
        { mode: "MONTH" },
        jalaliMonthPeriod(from),
        jalaliMonthPeriod(to),
      );
      expect(map.size).toBe(sourceDays);
      expect([...map.values()].filter(Boolean)).toHaveLength(
        Math.min(sourceDays, targetDays),
      );
      for (const [source, target] of map) {
        if (target) {
          expect(toJalali(source).day).toBe(toJalali(target).day);
          expect(toJalali(target)).toMatchObject(to);
        }
      }
    },
  );
});
