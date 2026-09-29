import { z } from "zod";
import { describe, expect, it } from "vitest";

import { isoDate } from "../domain/shared/dates";
import {
  ForbiddenError,
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../domain/shared/errors";
import type { Violation } from "../domain/rules/violation";
import { ConflictError, NotFoundError } from "./errors";
import { toActionError } from "./result";

const violation: Violation = {
  rule: "NIGHT_REST",
  severity: "error",
  nurseId: "n",
  nightDate: isoDate("2026-10-24"),
  date: isoDate("2026-10-25"),
  shift: "M",
};

describe("toActionError", () => {
  it.each([
    [
      new ValidationError("bad date", "date"),
      {
        code: "VALIDATION",
        message: "bad date",
        fieldErrors: { date: ["bad date"] },
      },
    ],
    [new ValidationError("bad"), { code: "VALIDATION", message: "bad" }],
    [
      new ForbiddenError("SELF_APPROVAL"),
      {
        code: "FORBIDDEN",
        message: "You are not allowed to do this",
        reason: "SELF_APPROVAL",
      },
    ],
    [
      new InvalidStateError("APPROVED", "FINALIZE"),
      {
        code: "INVALID_STATE",
        message: "Cannot FINALIZE while the schedule is APPROVED",
      },
    ],
    [
      new RuleViolationError([violation]),
      {
        code: "RULE_VIOLATION",
        message: "1 blocking rule violation(s)",
        violations: [violation],
      },
    ],
    [
      new NotFoundError("Schedule"),
      { code: "NOT_FOUND", message: "Schedule not found" },
    ],
    [
      new ConflictError(),
      {
        code: "CONFLICT",
        message: "The data was changed by someone else; reload and try again",
      },
    ],
  ])("maps %s", (error, expected) => {
    expect(toActionError(error)).toEqual(expected);
  });

  it("maps Zod errors to field errors", () => {
    const parsed = z.object({ id: z.uuid() }).safeParse({ id: "x" });
    const mapped = toActionError(!parsed.success && parsed.error);
    expect(mapped.code).toBe("VALIDATION");
    expect(Object.keys(mapped.fieldErrors ?? {})).toEqual(["id"]);
  });

  it.each([
    ["23505", "CONFLICT"],
    ["23503", "VALIDATION"],
    ["23514", "VALIDATION"],
    ["40001", "INTERNAL"],
  ])("maps PostgreSQL %s (wrapped) to %s", (code, expected) => {
    expect(
      toActionError({ message: "Failed query: …", cause: { code } }).code,
    ).toBe(expected);
  });

  it("never exposes the message of an unexpected error", () => {
    expect(toActionError(new Error("password=hunter2"))).toEqual({
      code: "INTERNAL",
      message: "Something went wrong",
    });
    expect(toActionError("oops")).toEqual({
      code: "INTERNAL",
      message: "Something went wrong",
    });
  });
});
