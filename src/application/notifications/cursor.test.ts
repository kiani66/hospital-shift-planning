import { describe, expect, it } from "vitest";

import { decodeNotificationCursor, encodeNotificationCursor } from "./cursor";

const key = {
  createdAt: "2026-09-01T10:00:00.123456Z",
  id: "11111111-1111-4111-8111-111111111111",
};
const raw = (text: string) => Buffer.from(text).toString("base64url");

describe("notification cursor", () => {
  it("round-trips a key with microseconds", () => {
    const cursor = encodeNotificationCursor(key);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeNotificationCursor(cursor)).toEqual(key);
  });

  it.each([
    ["not base64url", "a+b/c"],
    ["too long", "x".repeat(201)],
    ["no separator", raw(key.createdAt)],
    ["extra part", raw(`${key.createdAt}|${key.id}|x`)],
    ["millisecond precision", raw(`2026-09-01T10:00:00.123Z|${key.id}`)],
    ["impossible date", raw(`2026-13-45T99:00:00.000000Z|${key.id}`)],
    ["non-uuid id", raw(`${key.createdAt}|1 or 1=1`)],
    ["empty", ""],
  ])("rejects %s", (_, cursor) => {
    expect(decodeNotificationCursor(cursor)).toBeNull();
  });
});
