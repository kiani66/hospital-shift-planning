import { describe, expect, it } from "vitest";

import {
  comparePersonnelOrder,
  normalizePersonnelNumberForOrder,
  sortByPersonnelOrder,
  type PersonnelOrderKey,
} from "./personnel-order";

const p = (
  id: string,
  personnelNumber: string | null | undefined,
  displayName: string | null = "",
): PersonnelOrderKey => ({ id, personnelNumber, displayName });

const order = (items: readonly PersonnelOrderKey[]) =>
  sortByPersonnelOrder(items, (i) => i).map((i) => i.id);

describe("personnel number ordering", () => {
  it("orders numerically, not lexically (2, 9, 10, 100)", () => {
    expect(
      order([p("a", "100"), p("b", "10"), p("c", "9"), p("d", "2")]),
    ).toEqual(["d", "c", "b", "a"]);
  });

  it("treats Persian and Arabic digits like ASCII digits", () => {
    expect(
      order([p("a", "۱۰۰"), p("b", "٩"), p("c", "10"), p("d", "۲")]),
    ).toEqual(["d", "b", "c", "a"]);
    expect(normalizePersonnelNumberForOrder("‏۰۰۱۲")).toBe("0012");
  });

  it("is exact for numbers beyond Number precision", () => {
    expect(
      order([p("a", "99999999999999999999"), p("b", "9999999999999999999")]),
    ).toEqual(["b", "a"]);
    expect(
      order([p("a", "12345678901234567891"), p("b", "12345678901234567890")]),
    ).toEqual(["b", "a"]);
  });

  it("sorts missing, empty and blank numbers last", () => {
    expect(
      order([
        p("a", null),
        p("b", "5"),
        p("c", ""),
        p("d", "  "),
        p("e", undefined),
        p("f", "1"),
      ]),
    ).toEqual(["f", "b", "a", "c", "d", "e"]);
  });

  it("orders leading-zero variants deterministically and keeps the input intact", () => {
    const input = [p("a", "007"), p("b", "7"), p("c", "07"), p("d", "8")];
    expect(order(input)).toEqual(["b", "c", "a", "d"]);
    expect(input.map((i) => i.personnelNumber)).toEqual([
      "007",
      "7",
      "07",
      "8",
    ]);
  });

  it("orders alphanumeric values naturally and case-insensitively", () => {
    expect(
      order([p("a", "A10"), p("b", "A2"), p("c", "b1"), p("d", "a2")]),
    ).toEqual(["b", "d", "a", "c"]);
    // A number sorts before text at the first differing chunk; prefixes first.
    expect(
      order([p("a", "A1B"), p("b", "A1"), p("c", "A1A"), p("d", "1")]),
    ).toEqual(["d", "b", "c", "a"]);
  });

  it("breaks ties by display name, then by id", () => {
    expect(
      order([
        p("z", "5", "علی"),
        p("y", "5", "اکبر"),
        p("x", "5", "اکبر"),
        p("w", null, "ب"),
        p("v", null, "الف"),
      ]),
    ).toEqual(["x", "y", "z", "v", "w"]);
  });

  it("compares names after normalization and tolerates a missing name", () => {
    // Arabic yeh/kaf equal their Persian forms, so the id decides.
    expect(
      comparePersonnelOrder(p("b", "1", "علي"), p("a", "1", "علی")),
    ).toBeGreaterThan(0);
    expect(comparePersonnelOrder(p("a", "1", null), p("b", "1"))).toBeLessThan(
      0,
    );
    expect(
      comparePersonnelOrder(p("a", "1", "x"), p("b", "1", null)),
    ).toBeGreaterThan(0);
    expect(comparePersonnelOrder(p("a", "1"), p("a", "1"))).toBe(0);
  });

  it("keeps the same relative order for any filtered subset", () => {
    const all = [
      p("a", "100", "ن"),
      p("b", "2", "م"),
      p("c", null, "ل"),
      p("d", "10", "ک"),
      p("e", "9", "ی"),
    ];
    const sorted = sortByPersonnelOrder(all, (i) => i);
    const filter = (i: PersonnelOrderKey) => i.id !== "e";
    expect(sortByPersonnelOrder(all.filter(filter), (i) => i)).toEqual(
      sorted.filter(filter),
    );
    expect(sortByPersonnelOrder([...all].reverse(), (i) => i)).toEqual(sorted);
  });
});
