import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseProvisionEnv, ProvisionError } from "./provision-user";

const valid = {
  PROVISION_PERSONNEL_NUMBER: " ۰۰۷۲۰ ",
  PROVISION_EMAIL: "  Head@Example.COM ",
  PROVISION_DISPLAY_NAME: " Head  Nurse ",
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

describe("parseProvisionEnv: create (default mode)", () => {
  it("normalizes personnel number, e-mail and display name", () => {
    expect(parseProvisionEnv(valid)).toMatchObject({
      mode: "create",
      personnelNumber: "00720",
      email: "head@example.com",
      displayName: "Head Nurse",
      departmentCode: "ICU",
      role: "HEAD_NURSE",
      allowNewMembership: false,
    });
  });

  it("makes e-mail, mobile and password optional; blank means unset", () => {
    const input = parseProvisionEnv({
      ...valid,
      PROVISION_EMAIL: " ",
      PROVISION_PASSWORD: "",
      PROVISION_MOBILE: "+98 912 123 4567",
      PROVISION_ROLE: "NURSE",
    });
    expect(input).toMatchObject({
      email: undefined,
      password: undefined,
      mobile: "09121234567",
      role: "NURSE",
    });
  });

  it("allows a membership on an existing account only when asked explicitly", () => {
    expect(
      parseProvisionEnv({ ...valid, PROVISION_ALLOW_NEW_MEMBERSHIP: "yes" }),
    ).toMatchObject({ allowNewMembership: true });
    expect(
      parseProvisionEnv({ ...valid, PROVISION_ALLOW_NEW_MEMBERSHIP: "1" }),
    ).toMatchObject({ allowNewMembership: false });
  });

  it("reads the optional department name; blank means unset", () => {
    expect(
      parseProvisionEnv({
        ...valid,
        PROVISION_DEPARTMENT_NAME: "Intensive Care",
      }),
    ).toMatchObject({ departmentName: "Intensive Care" });
    expect(
      parseProvisionEnv({ ...valid, PROVISION_DEPARTMENT_NAME: " " }),
    ).toMatchObject({ departmentName: undefined });
    expect(
      messageFor({ ...valid, PROVISION_DEPARTMENT_NAME: "x".repeat(201) }),
    ).toContain("PROVISION_DEPARTMENT_NAME");
  });

  it.each([
    [
      "missing personnel number",
      { PROVISION_PERSONNEL_NUMBER: undefined },
      "PROVISION_PERSONNEL_NUMBER is required",
    ],
    [
      "invalid personnel number",
      { PROVISION_PERSONNEL_NUMBER: "12-34" },
      "1 to 20 digits",
    ],
    [
      "missing display name",
      { PROVISION_DISPLAY_NAME: undefined },
      "PROVISION_DISPLAY_NAME",
    ],
    ["invalid e-mail", { PROVISION_EMAIL: "not-an-email" }, "valid e-mail"],
    ["invalid mobile", { PROVISION_MOBILE: "123" }, "PROVISION_MOBILE"],
    ["short password", { PROVISION_PASSWORD: "short" }, "at least 12"],
    [
      "over-long password",
      { PROVISION_PASSWORD: "x".repeat(257) },
      "at most 256",
    ],
    ["blank department", { PROVISION_DEPARTMENT_CODE: " " }, "DEPARTMENT_CODE"],
    ["unsupported role", { PROVISION_ROLE: "SUPERVISOR" }, "PROVISION_ROLE"],
    ["missing role", { PROVISION_ROLE: undefined }, "PROVISION_ROLE"],
    ["unknown mode", { PROVISION_MODE: "upsert" }, "PROVISION_MODE"],
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

describe("parseProvisionEnv: explicit recovery and backfill modes", () => {
  it("reset-password requires the confirmation phrase and an identifier", () => {
    const base = {
      PROVISION_MODE: "reset-password",
      PROVISION_PERSONNEL_NUMBER: "720",
      PROVISION_PASSWORD: "a-long-enough-password",
    };
    expect(messageFor(base)).toContain("RESET_PASSWORD");
    expect(
      parseProvisionEnv({ ...base, PROVISION_CONFIRM: "RESET_PASSWORD" }),
    ).toMatchObject({ mode: "reset-password", personnelNumber: "720" });
    expect(
      messageFor({
        ...base,
        PROVISION_PERSONNEL_NUMBER: undefined,
        PROVISION_CONFIRM: "RESET_PASSWORD",
      }),
    ).toContain("PROVISION_PERSONNEL_NUMBER or PROVISION_EMAIL");
  });

  it("assign-personnel-number requires e-mail, number and confirmation", () => {
    const base = {
      PROVISION_MODE: "assign-personnel-number",
      PROVISION_EMAIL: "Admin@Example.com",
      PROVISION_PERSONNEL_NUMBER: "۰۱۲",
    };
    expect(messageFor(base)).toContain("ASSIGN_PERSONNEL_NUMBER");
    expect(
      parseProvisionEnv({
        ...base,
        PROVISION_CONFIRM: "ASSIGN_PERSONNEL_NUMBER",
      }),
    ).toEqual({
      mode: "assign-personnel-number",
      email: "admin@example.com",
      personnelNumber: "012",
      confirm: "ASSIGN_PERSONNEL_NUMBER",
    });
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
