import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it.each(["/", "/my-shifts", "/departments/icu/schedule?x=1"])(
    "keeps the same-site path %s",
    (path) => {
      expect(safeRedirectPath(path)).toBe(path);
    },
  );

  it.each([
    ["an absolute URL", "https://evil.example/login"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a relative path", "my-shifts"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a control character", "/a\nb"],
    ["an overly long value", `/${"a".repeat(600)}`],
    ["a non-string", 42],
    ["nothing", null],
  ])("falls back to / for %s", (_, value) => {
    expect(safeRedirectPath(value)).toBe("/");
  });
});
