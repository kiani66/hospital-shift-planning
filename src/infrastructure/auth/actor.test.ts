import { describe, expect, it } from "vitest";

import { sessionUserId, todayIn } from "./actor";

describe("todayIn", () => {
  it("uses the calendar day in the given timezone, not UTC", () => {
    // 21:00 UTC is already the next day in Tehran (UTC+3:30).
    const now = new Date("2026-10-01T21:00:00Z");
    expect(todayIn("Asia/Tehran", now)).toBe("2026-10-02");
    expect(todayIn("UTC", now)).toBe("2026-10-01");
  });
});

describe("sessionUserId", () => {
  const id = "20000000-0000-4000-8000-000000000011";

  it("reads only the user id", () => {
    expect(sessionUserId({ user: { id }, expires: "x" })).toBe(id);
  });

  it.each([
    ["no session", null],
    ["no user", { expires: "x" }],
    ["a non-uuid id", { user: { id: "admin" } }],
    ["a numeric id", { user: { id: 1 } }],
  ])("returns null for %s", (_, session) => {
    expect(sessionUserId(session)).toBeNull();
  });
});
