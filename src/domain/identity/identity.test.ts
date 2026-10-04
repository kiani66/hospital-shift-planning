import { describe, expect, it } from "vitest";

import { ValidationError } from "../shared/errors";
import { parseLoginIdentifier } from "./login-identifier";
import { parseMobileNumber, parseOptionalMobileNumber } from "./mobile";
import {
  normalizeDisplayName,
  normalizeIdentifierText,
  stripInvisible,
  toAsciiDigits,
} from "./normalize";
import { assertAcceptableNewPassword } from "./password-policy";
import { isPersonnelNumber, parsePersonnelNumber } from "./personnel-number";

const reasonOf = (result: { ok: boolean; error?: unknown }) =>
  result.ok ? null : (result.error as ValidationError).reason;

describe("digit and text normalization", () => {
  it("maps Persian and Arabic-Indic digits to ASCII", () => {
    expect(toAsciiDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(toAsciiDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toAsciiDigits("a1۲٣")).toBe("a123");
  });

  it("removes invisible formatting characters anywhere", () => {
    expect(stripInvisible("\u200f12\u200b3\ufeff\u2066")).toBe("123");
  });

  it("trims surrounding whitespace including NBSP and keeps internal text", () => {
    expect(normalizeIdentifierText("\u00a0 ۱۲۳\t\n")).toBe("123");
    expect(normalizeIdentifierText(" 1 2 ")).toBe("1 2");
  });

  it("normalizes display names for comparison", () => {
    expect(normalizeDisplayName("  علي   كريمي\u200f ")).toBe("علی کریمی");
    // ZWNJ is part of Persian spelling and is kept.
    expect(normalizeDisplayName("می\u200cخواهم")).toBe("می\u200cخواهم");
  });
});

describe("parsePersonnelNumber", () => {
  it.each([
    ["720", "720"],
    ["00125", "00125"],
    ["۰۰۱۲۵", "00125"],
    ["٧٢٠", "720"],
    ["\u200f 720 \u200e", "720"],
    ["1".repeat(20), "1".repeat(20)],
  ])("accepts %j as %j and keeps leading zeros", (raw, expected) => {
    const result = parsePersonnelNumber(raw);
    expect(result).toEqual({ ok: true, value: expected });
  });

  it.each(["", "   ", "\u200f"])("requires a value (%j)", (raw) => {
    expect(reasonOf(parsePersonnelNumber(raw))).toBe(
      "PERSONNEL_NUMBER_REQUIRED",
    );
  });

  it.each([
    "1".repeat(21),
    "12 34",
    "12-34",
    "-12",
    "+12",
    "720.0",
    "1.2E+5",
    "abc",
    "۱۲a",
  ])("rejects %j without repairing it", (raw) => {
    expect(reasonOf(parsePersonnelNumber(raw))).toBe(
      "PERSONNEL_NUMBER_INVALID",
    );
  });

  it("recognizes stored values", () => {
    expect(isPersonnelNumber("00125")).toBe(true);
    expect(isPersonnelNumber("۱۲")).toBe(false);
  });
});

describe("parseMobileNumber", () => {
  it.each([
    "09121234567",
    "9121234567",
    "+989121234567",
    "00989121234567",
    "989121234567",
    "۰۹۱۲۱۲۳۴۵۶۷",
    "0912-123-4567",
    "(0912) 123 4567",
    "+98 912 123 4567",
    "\u200e09121234567",
  ])("normalizes %j", (raw) => {
    expect(parseMobileNumber(raw)).toEqual({
      ok: true,
      value: "09121234567",
    });
  });

  it.each([
    "0912123456",
    "091212345678",
    "02112345678",
    "+18005550000",
    "0912abc4567",
    "",
  ])("rejects %j", (raw) => {
    expect(reasonOf(parseMobileNumber(raw))).toBe("MOBILE_INVALID");
  });

  it("treats empty optional values as absent", () => {
    expect(parseOptionalMobileNumber(undefined)).toEqual({
      ok: true,
      value: null,
    });
    expect(parseOptionalMobileNumber(null)).toEqual({ ok: true, value: null });
    expect(parseOptionalMobileNumber(" \u200f ")).toEqual({
      ok: true,
      value: null,
    });
    expect(parseOptionalMobileNumber("9121234567")).toEqual({
      ok: true,
      value: "09121234567",
    });
  });
});

describe("parseLoginIdentifier", () => {
  it("detects e-mail by @ and lower-cases it", () => {
    expect(parseLoginIdentifier("  Head@Example.COM ")).toEqual({
      kind: "email",
      value: "head@example.com",
    });
  });

  it("detects personnel numbers after digit normalization", () => {
    expect(parseLoginIdentifier("۰۰۱۲۵")).toEqual({
      kind: "personnelNumber",
      value: "00125",
    });
  });

  it("marks anything else unrecognized", () => {
    expect(parseLoginIdentifier("Some Name")).toEqual({
      kind: "unrecognized",
      value: "some name",
    });
    expect(parseLoginIdentifier("1".repeat(21)).kind).toBe("unrecognized");
  });
});

describe("assertAcceptableNewPassword", () => {
  const valid = {
    currentPassword: "temporary-pass-1",
    newPassword: "my-new-long-password",
    confirmation: "my-new-long-password",
  };

  it("accepts a new, confirmed password of valid length", () => {
    expect(() => assertAcceptableNewPassword(valid)).not.toThrow();
  });

  it.each([
    [{ newPassword: "short", confirmation: "short" }, "PASSWORD_LENGTH"],
    [
      { newPassword: "x".repeat(257), confirmation: "x".repeat(257) },
      "PASSWORD_LENGTH",
    ],
    [{ confirmation: "different-password" }, "PASSWORD_CONFIRMATION_MISMATCH"],
    [
      {
        newPassword: "temporary-pass-1",
        confirmation: "temporary-pass-1",
      },
      "PASSWORD_UNCHANGED",
    ],
  ])("rejects %j with %s", (over, reason) => {
    expect(() => assertAcceptableNewPassword({ ...valid, ...over })).toThrow(
      expect.objectContaining({ reason }),
    );
  });
});
