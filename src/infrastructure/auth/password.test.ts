import { describe, expect, it } from "vitest";

import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";

describe("password hashing (Argon2id)", () => {
  it("produces an Argon2id hash with the OWASP parameters, never the plaintext", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain("correct horse");
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword(hash, "correct horse")).toBe(true);
    expect(await verifyPassword(hash, "Correct horse")).toBe(false);
  });

  it("treats a malformed hash as a failed verification", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("always fails the constant-time dummy check", async () => {
    expect(await verifyAgainstDummy("anything")).toBe(false);
  });
});
