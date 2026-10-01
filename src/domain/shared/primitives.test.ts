import { describe, expect, it } from "vitest";

import { allow, deny } from "./decision";
import {
  DomainError,
  ForbiddenError,
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "./errors";
import { err, ok, unwrap } from "./result";

describe("Result", () => {
  it("ok / err build tagged values", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("x")).toEqual({ ok: false, error: "x" });
  });

  it("unwrap returns the value or throws the error", () => {
    expect(unwrap(ok("v"))).toBe("v");
    const error = new ValidationError("bad");
    expect(() => unwrap(err(error))).toThrow(error);
  });
});

describe("Decision", () => {
  it("allow / deny", () => {
    expect(allow).toEqual({ allowed: true });
    expect(deny("NOPE")).toEqual({ allowed: false, reason: "NOPE" });
  });
});

describe("domain errors", () => {
  it.each([
    [
      new ValidationError("bad date", "date"),
      "VALIDATION",
      "ValidationError",
      "bad date",
    ],
    [
      new ForbiddenError("SELF_APPROVAL"),
      "FORBIDDEN",
      "ForbiddenError",
      "Forbidden: SELF_APPROVAL",
    ],
    [
      new InvalidStateError("APPROVED", "FINALIZE"),
      "INVALID_STATE",
      "InvalidStateError",
      "Cannot FINALIZE while the schedule is APPROVED",
    ],
    [
      new RuleViolationError([]),
      "RULE_VIOLATION",
      "RuleViolationError",
      "0 blocking rule violation(s)",
    ],
  ])("%s has code %s", (error, code, name, message) => {
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
    expect(error.message).toBe(message);
  });

  it("keeps structured details", () => {
    expect(new ValidationError("x", "comment").field).toBe("comment");
    expect(new ValidationError("x").field).toBeUndefined();
    expect(new ForbiddenError("R").reason).toBe("R");
    const e = new InvalidStateError("DRAFT", "SUBMIT");
    expect([e.status, e.attempted]).toEqual(["DRAFT", "SUBMIT"]);
  });

  it("names another stateful subject when given one", () => {
    expect(
      new InvalidStateError("APPLIED", "CANCEL", "the change request").message,
    ).toBe("Cannot CANCEL while the change request is APPLIED");
  });
});
