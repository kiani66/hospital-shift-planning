import { describe, expect, it } from "vitest";

import {
  conflictsWithPreference,
  summarizePreferenceAlignment,
  type AlignmentInput,
} from "./preference-alignment";

const nurse = (
  preference: AlignmentInput["preference"],
  shift: AlignmentInput["shift"],
): AlignmentInput => ({ preference, shift });

describe("summarizePreferenceAlignment (advisory, built on preferenceFit)", () => {
  it("is all zeros for an empty roster", () => {
    expect(summarizePreferenceAlignment([])).toEqual({
      rostered: 0,
      withPreference: 0,
      matches: 0,
      differs: 0,
      pending: 0,
      noPreference: 0,
      unassigned: 0,
    });
  });

  it("counts matching and conflicting assignments", () => {
    const summary = summarizePreferenceAlignment([
      nurse("M", "M"),
      nurse("ME", "ME"),
      nurse("N", "M"),
      // ME is its own shift: wishing M while working ME is a conflict.
      nurse("M", "ME"),
    ]);
    expect(summary).toMatchObject({
      rostered: 4,
      withPreference: 4,
      matches: 2,
      differs: 2,
      pending: 0,
      noPreference: 0,
      unassigned: 0,
    });
  });

  it("tells an explicit OFF apart from no preference", () => {
    const summary = summarizePreferenceAlignment([
      // OFF wished, no assignment: recorded, awaiting a decision (not a match).
      nurse("OFF", null),
      // OFF wished, but a shift was assigned: a conflict.
      nurse("OFF", "E"),
      // Nothing recorded: no preference, assigned or not.
      nurse(null, null),
      nurse(null, "N"),
    ]);
    expect(summary).toEqual({
      rostered: 4,
      withPreference: 2,
      matches: 0,
      differs: 1,
      pending: 1,
      noPreference: 2,
      unassigned: 2,
    });
  });

  it("keeps a wished shift without an assignment apart from a conflict", () => {
    const summary = summarizePreferenceAlignment([nurse("E", null)]);
    expect(summary).toMatchObject({ pending: 1, differs: 0, unassigned: 1 });
  });

  it("partitions the roster by fit; unassigned overlaps and is never part of it", () => {
    const roster = [
      nurse("M", "M"),
      nurse("OFF", null),
      nurse("N", "E"),
      nurse("E", null),
      nurse(null, null),
      nurse(null, "ME"),
    ];
    const s = summarizePreferenceAlignment(roster);
    expect(s.matches + s.differs + s.pending + s.noPreference).toBe(s.rostered);
    expect(s.matches + s.differs + s.pending).toBe(s.withPreference);
    // Three nurses have no shift: two pending (OFF and E wished), one without preference.
    expect(s.unassigned).toBe(3);
    expect(
      s.matches + s.differs + s.pending + s.noPreference + s.unassigned,
    ).not.toBe(s.rostered);
  });
});

describe("conflictsWithPreference", () => {
  it.each([
    [nurse("N", "M"), true],
    [nurse("OFF", "M"), true],
    [nurse("M", "M"), false],
    [nurse("OFF", null), false],
    [nurse("E", null), false],
    [nurse(null, "M"), false],
  ])("%o → %s", (input, expected) => {
    expect(conflictsWithPreference(input)).toBe(expected);
  });
});
