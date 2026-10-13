import { describe, expect, it } from "vitest";

import { ShiftReferenceDataError, toShiftLabels } from "./labels";

const ROWS = [
  { code: "M", label: "صبح" },
  { code: "E", label: "عصر" },
  { code: "N", label: "شب" },
  { code: "ME", label: "طولانی" },
  { code: "OFF", label: "استراحت" },
  { code: "H", label: "مرخصی" },
];

describe("toShiftLabels", () => {
  it("maps exactly the domain's codes to their stored labels", () => {
    const labels = toShiftLabels(ROWS);
    expect(labels).toEqual({
      M: "صبح",
      E: "عصر",
      N: "شب",
      ME: "طولانی",
      OFF: "استراحت",
      H: "مرخصی",
    });
    expect(Object.isFrozen(labels)).toBe(true);
  });

  it("takes a changed label as is: the code stays the key", () => {
    expect(
      toShiftLabels(
        ROWS.map((r) => (r.code === "OFF" ? { ...r, label: " مرخصی " } : r)),
      ).OFF,
    ).toBe("مرخصی");
  });

  it("ignores rows the domain does not know: a row never becomes a shift code", () => {
    const labels = toShiftLabels([...ROWS, { code: "X", label: "تعطیل" }]);
    expect(Object.keys(labels)).toEqual(["M", "E", "N", "ME", "OFF", "H"]);
    expect(labels).not.toHaveProperty("X");
  });

  it("fails explicitly when a required label is missing or blank", () => {
    expect(() =>
      toShiftLabels(ROWS.filter((r) => r.code !== "OFF")),
    ).toThrowError(ShiftReferenceDataError);
    expect(() =>
      toShiftLabels(ROWS.filter((r) => r.code !== "OFF")),
    ).toThrowError(/required code OFF/);
    expect(() =>
      toShiftLabels(
        ROWS.map((r) => (r.code === "ME" ? { ...r, label: "  " } : r)),
      ),
    ).toThrowError(/required code ME/);
    // Leave (H, D118) is required like every other decision.
    expect(() =>
      toShiftLabels(ROWS.filter((r) => r.code !== "H")),
    ).toThrowError(/required code H/);
    expect(() => toShiftLabels([])).toThrowError(ShiftReferenceDataError);
  });
});
