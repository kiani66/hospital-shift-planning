import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import {
  assignmentInterval,
  countdownMinutes,
  currentOrNextShift,
  intervalsOverlap,
} from "./interval";
import { SHIFT_CODES } from "./shift-type";

const date = isoDate("2026-10-24");
const instantAt = (day: string, time: string) =>
  Date.parse(`${day}T${time}:00+03:30`);
const interval = (code: (typeof SHIFT_CODES)[number]) =>
  assignmentInterval(date, code, instantAt)!;

describe("working intervals", () => {
  it("uses catalog endpoints, carrying an overnight shift into the next date", () => {
    expect(interval("N")).toEqual({
      start: instantAt(date, "19:00"),
      end: instantAt("2026-10-25", "07:00"),
    });
    expect(interval("ME").end - interval("ME").start).toBe(12 * 3600_000);
    expect(assignmentInterval(date, "OFF", instantAt)).toBeNull();
    expect(assignmentInterval(date, "H", instantAt)).toBeNull();
  });

  it("matches every M/E/N/ME overlap with actual intervals, excluding touching endpoints", () => {
    const expected = {
      M: ["M", "ME"],
      E: ["E", "ME"],
      N: ["N"],
      ME: ["M", "E", "ME"],
    };
    for (const selected of SHIFT_CODES) {
      expect(
        SHIFT_CODES.filter((code) =>
          intervalsOverlap(interval(selected), interval(code)),
        ),
      ).toEqual(expected[selected]);
    }
    expect(
      intervalsOverlap(
        interval("N"),
        assignmentInterval(isoDate("2026-10-25"), "M", instantAt)!,
      ),
    ).toBe(false);
    // Code identity is irrelevant; an interval on another day never overlaps.
    expect(
      intervalsOverlap(
        interval("M"),
        assignmentInterval(isoDate("2026-10-25"), "M", instantAt)!,
      ),
    ).toBe(false);
  });

  it("chooses by start instant, not assignment date or input order", () => {
    const shifts = [interval("N"), interval("E"), interval("M")];
    const original = [...shifts];
    expect(currentOrNextShift(shifts, instantAt(date, "06:59"))).toEqual({
      shift: interval("M"),
      active: false,
    });
    expect(currentOrNextShift(shifts, instantAt(date, "14:00"))).toEqual({
      shift: interval("E"),
      active: true,
    });
    expect(shifts).toEqual(original);
  });

  it("prioritizes active work including yesterday's night, with exact start/end boundaries", () => {
    const night = interval("N");
    const morning = assignmentInterval(isoDate("2026-10-25"), "M", instantAt)!;
    expect(currentOrNextShift([morning, night], night.start)).toEqual({
      shift: night,
      active: true,
    });
    expect(
      currentOrNextShift([morning, night], instantAt("2026-10-25", "03:00")),
    ).toEqual({ shift: night, active: true });
    expect(currentOrNextShift([night], night.end)).toBeNull();
    expect(currentOrNextShift([morning, night], night.end)).toEqual({
      shift: morning,
      active: true,
    });
    expect(currentOrNextShift([], night.start)).toBeNull();
  });

  it("sorts active intervals deterministically and handles ended-only schedules", () => {
    expect(
      currentOrNextShift(
        [interval("E"), interval("ME")],
        instantAt(date, "15:00"),
      )?.shift,
    ).toEqual(interval("ME"));
    expect(
      currentOrNextShift([interval("M")], instantAt(date, "20:00")),
    ).toBeNull();
  });

  it("rounds the countdown up and clamps it to zero at or after start", () => {
    const start = interval("M").start;
    expect(countdownMinutes(start, start - 1)).toBe(1);
    expect(countdownMinutes(start, start - 60_001)).toBe(2);
    expect(countdownMinutes(start, start - 60_000)).toBe(1);
    expect(countdownMinutes(start, start)).toBe(0);
    expect(countdownMinutes(start, start + 60_000)).toBe(0);
  });
});
