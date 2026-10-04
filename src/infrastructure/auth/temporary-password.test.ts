import { describe, expect, it } from "vitest";

import { generateTemporaryPassword } from "./temporary-password";

describe("generateTemporaryPassword", () => {
  it("produces four groups of four unambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
      expect(password).not.toMatch(/[01lIoO25SZ]/);
      // Long enough for the account-creation password policy.
      expect(password.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("does not repeat", () => {
    const seen = new Set(
      Array.from({ length: 500 }, () => generateTemporaryPassword()),
    );
    expect(seen.size).toBe(500);
  });
});
