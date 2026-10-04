import { describe, expect, it } from "vitest";

import type { PreferenceValue, ShiftCode } from "../shifts/shift-type";
import { preferenceFit, type PreferenceFit } from "./preference-fit";

describe("preferenceFit (a wish against the assignment, never a rule)", () => {
  it.each<[PreferenceValue | null, ShiftCode | null, PreferenceFit]>([
    [null, null, "NONE"],
    [null, "M", "NONE"],
    ["M", "M", "MATCHES"],
    ["ME", "ME", "MATCHES"],
    ["N", "M", "DIFFERS"],
    // ME is its own shift: wishing M while working ME is a different shift.
    ["M", "ME", "DIFFERS"],
    ["OFF", "E", "DIFFERS"],
    ["OFF", "ME", "DIFFERS"],
    ["E", null, "PENDING"],
    // OFF follows the same lifecycle (D99): no assignment is not a decision.
    ["OFF", null, "PENDING"],
  ])("preference %s with assignment %s → %s", (preference, shift, fit) => {
    expect(preferenceFit(preference, shift)).toBe(fit);
  });
});
