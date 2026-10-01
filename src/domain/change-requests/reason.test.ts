import { describe, expect, it } from "vitest";

import {
  CHANGE_NOTE_MAX_LENGTH,
  checkReason,
  normalizeNote,
  OTHER_REASON_CODE,
  type ChangeReason,
} from "./reason";

const reason = (overrides: Partial<ChangeReason> = {}): ChangeReason => ({
  code: "ILLNESS",
  scope: "REQUEST",
  requiresNote: false,
  isActive: true,
  ...overrides,
});

const fieldOf = (result: ReturnType<typeof checkReason>) =>
  result.ok ? null : result.error.field;

describe("checkReason", () => {
  it("accepts an active reason of the right scope, with an optional note", () => {
    expect(
      checkReason({ reason: reason(), usage: "REQUEST", note: undefined }),
    ).toEqual({ ok: true, value: { reasonCode: "ILLNESS", note: null } });
    expect(
      checkReason({ reason: reason(), usage: "REQUEST", note: "  تب دارم " }),
    ).toEqual({ ok: true, value: { reasonCode: "ILLNESS", note: "تب دارم" } });
  });

  it("accepts a BOTH reason for requests and adjustments", () => {
    const both = reason({ scope: "BOTH" });
    expect(checkReason({ reason: both, usage: "REQUEST", note: null }).ok).toBe(
      true,
    );
    expect(
      checkReason({ reason: both, usage: "ADJUSTMENT", note: null }).ok,
    ).toBe(true);
  });

  it.each([
    ["unknown", null],
    ["inactive", reason({ isActive: false })],
    ["for the other usage", reason({ scope: "ADJUSTMENT" })],
  ])("rejects a reason that is %s", (_, r) => {
    expect(
      fieldOf(checkReason({ reason: r, usage: "REQUEST", note: "x" })),
    ).toBe("reasonCode");
  });

  it("requires a note for Other, even if not flagged", () => {
    const other = reason({ code: OTHER_REASON_CODE });
    expect(
      fieldOf(checkReason({ reason: other, usage: "REQUEST", note: "   " })),
    ).toBe("note");
    expect(
      checkReason({ reason: other, usage: "REQUEST", note: "کار شخصی" }).ok,
    ).toBe(true);
  });

  it("requires a note for a reason flagged requiresNote", () => {
    expect(
      fieldOf(
        checkReason({
          reason: reason({ requiresNote: true }),
          usage: "REQUEST",
          note: null,
        }),
      ),
    ).toBe("note");
  });

  it("rejects a note that is too long", () => {
    expect(
      fieldOf(
        checkReason({
          reason: reason(),
          usage: "REQUEST",
          note: "x".repeat(CHANGE_NOTE_MAX_LENGTH + 1),
        }),
      ),
    ).toBe("note");
  });
});

describe("normalizeNote", () => {
  it("trims, turns blank into null and names the field", () => {
    expect(normalizeNote(" a ")).toEqual({ ok: true, value: "a" });
    expect(normalizeNote(null)).toEqual({ ok: true, value: null });
    const tooLong = normalizeNote("x".repeat(501), "comment");
    expect(!tooLong.ok && tooLong.error.field).toBe("comment");
  });
});
