import { describe, expect, it } from "vitest";

import { pgConstraint, pgErrorCode } from "./errors";

describe("pgErrorCode / pgConstraint", () => {
  const pgError = {
    code: "23505",
    constraint: "schedule_submissions_one_pending_key",
  };

  it.each([
    ["a driver error", pgError],
    [
      "a wrapped error (DrizzleQueryError.cause)",
      { message: "Failed query", cause: pgError },
    ],
    ["a doubly wrapped error", { cause: { cause: pgError } }],
  ])("reads %s", (_, error) => {
    expect(pgErrorCode(error)).toBe("23505");
    expect(pgConstraint(error)).toBe("schedule_submissions_one_pending_key");
  });

  it.each([
    ["undefined", undefined],
    ["a plain error", new Error("x")],
    ["a non-SQLSTATE code", { code: "ECONNREFUSED" }],
  ])("returns undefined for %s", (_, error) => {
    expect(pgErrorCode(error)).toBeUndefined();
    expect(pgConstraint(error)).toBeUndefined();
  });
});
