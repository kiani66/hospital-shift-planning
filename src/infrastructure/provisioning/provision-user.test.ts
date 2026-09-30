import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseProvisionEnv, ProvisionError } from "./provision-user";

const valid = {
  PROVISION_EMAIL: "  Head@Example.COM ",
  PROVISION_PASSWORD: "a-long-enough-password",
  PROVISION_DEPARTMENT_CODE: "ICU",
  PROVISION_ROLE: "HEAD_NURSE",
};

const messageFor = (env: Record<string, string | undefined>) => {
  try {
    parseProvisionEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ProvisionError);
    return (error as Error).message;
  }
  throw new Error("expected parseProvisionEnv to throw");
};

describe("parseProvisionEnv", () => {
  it("normalizes the e-mail like sign-in does", () => {
    expect(parseProvisionEnv(valid)).toMatchObject({
      email: "head@example.com",
      departmentCode: "ICU",
      role: "HEAD_NURSE",
      displayName: undefined,
    });
  });

  it("accepts NURSE and an optional display name; blank means unset", () => {
    expect(
      parseProvisionEnv({
        ...valid,
        PROVISION_ROLE: "NURSE",
        PROVISION_DISPLAY_NAME: "Head",
      }),
    ).toMatchObject({ role: "NURSE", displayName: "Head" });
    expect(
      parseProvisionEnv({ ...valid, PROVISION_DISPLAY_NAME: "  " }).displayName,
    ).toBeUndefined();
  });

  it("reads the optional department name; blank means unset", () => {
    expect(
      parseProvisionEnv({
        ...valid,
        PROVISION_DEPARTMENT_NAME: "Intensive Care",
      }).departmentName,
    ).toBe("Intensive Care");
    expect(
      parseProvisionEnv({ ...valid, PROVISION_DEPARTMENT_NAME: " " })
        .departmentName,
    ).toBeUndefined();
    expect(
      messageFor({ ...valid, PROVISION_DEPARTMENT_NAME: "x".repeat(201) }),
    ).toContain("PROVISION_DEPARTMENT_NAME");
  });

  it.each([
    ["missing e-mail", { PROVISION_EMAIL: undefined }, "PROVISION_EMAIL"],
    ["invalid e-mail", { PROVISION_EMAIL: "not-an-email" }, "valid e-mail"],
    [
      "missing password",
      { PROVISION_PASSWORD: undefined },
      "PROVISION_PASSWORD",
    ],
    ["short password", { PROVISION_PASSWORD: "short" }, "at least 12"],
    [
      "over-long password",
      { PROVISION_PASSWORD: "x".repeat(257) },
      "at most 256",
    ],
    ["blank department", { PROVISION_DEPARTMENT_CODE: " " }, "DEPARTMENT_CODE"],
    ["unsupported role", { PROVISION_ROLE: "SUPERVISOR" }, "PROVISION_ROLE"],
    ["missing role", { PROVISION_ROLE: undefined }, "PROVISION_ROLE"],
  ])("rejects %s", (_name, override, fragment) => {
    expect(messageFor({ ...valid, ...override })).toContain(fragment);
  });

  it("never echoes the password in an error", () => {
    const message = messageFor({
      ...valid,
      PROVISION_EMAIL: "bad",
      PROVISION_PASSWORD: "secret-but-invalid",
      PROVISION_ROLE: "X",
    });
    expect(message).not.toContain("secret-but-invalid");
  });
});

describe("production safety wiring", () => {
  const sources = [
    "scripts/db-provision-user.ts",
    "src/infrastructure/provisioning/provision-user.ts",
  ].map((f) =>
    // Code only: the doc comments legitimately say "no truncate".
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  );

  it("never touches the demo seed or its guard", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/seedDemoData|resetData|assertSeedAllowed/);
      expect(source).not.toMatch(/db\/seed\//);
      expect(source).not.toMatch(/truncate|\bdelete\s+from\b|\.delete\(/i);
    }
  });

  it("is not part of the deployment build", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts["db:provision-user"]).toContain("db-provision-user");
    for (const name of ["vercel-build", "build", "start", "db:migrate"])
      expect(scripts[name]).not.toContain("provision");
  });
});
