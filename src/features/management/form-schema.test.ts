import { describe, expect, it } from "vitest";

import { managementFormSchemas, parseManagementForm } from "./form-schema";

const userId = "20000000-0000-4000-8000-000000000011";
const departmentId = "10000000-0000-4000-8000-000000000001";
const profile = { displayName: "  نام نمونه  ", email: " USER@DEMO.INVALID " };
const member = {
  userId,
  departmentId,
  role: "NURSE",
  startedOn: "۱۴۰۵/۰۷/۱۱",
  endedOn: "",
};

describe("management form schemas", () => {
  it("requires expected authority and active flags and never accepts activation as a grant side effect", () => {
    const values = {
      userId,
      isHospitalAdmin: "true",
      expectedIsHospitalAdmin: "false",
      expectedIsActive: "false",
      isActive: "true",
      passwordHash: "ignored",
    };
    expect(managementFormSchemas.authority.parse(values)).toEqual({
      userId,
      isHospitalAdmin: true,
      expectedIsHospitalAdmin: false,
      expectedIsActive: false,
    });
    for (const field of [
      "isHospitalAdmin",
      "expectedIsHospitalAdmin",
      "expectedIsActive",
    ])
      for (const invalid of [true, "yes", "", undefined])
        expect(
          managementFormSchemas.authority.safeParse({
            ...values,
            [field]: invalid,
          }).success,
        ).toBe(false);
  });
  it("converts separate Supervisor assignment dates without creating a membership role", () => {
    const parsed = managementFormSchemas.supervisorAdd.parse({
      ...member,
      role: "HEAD_NURSE",
      endedOn: "۱۴۰۵/۰۷/۱۲",
    });
    expect(parsed).toEqual({
      userId,
      departmentId,
      startedOn: "2026-10-03",
      endedOn: "2026-10-04",
    });
    expect(
      managementFormSchemas.supervisorAdd.parse(member).endedOn,
    ).toBeNull();
  });
  it.each<Record<string, unknown>>([
    { departmentId: "unknown" },
    { userId: "unknown" },
    { startedOn: "1405/07/31" },
    { endedOn: "not a date" },
    { endedOn: undefined },
  ])("rejects invalid Supervisor form fields %#", (extra) => {
    expect(
      managementFormSchemas.supervisorAdd.safeParse({ ...member, ...extra })
        .success,
    ).toBe(false);
  });
  it("requires the Supervisor expected end separately from its Jalali ending date", () => {
    const input = {
      relationId: userId,
      expectedEndedOn: "",
      endedOn: "۱۴۰۵/۰۷/۱۲",
    };
    expect(managementFormSchemas.supervisorEnd.parse(input)).toEqual({
      relationId: userId,
      expectedEndedOn: null,
      endedOn: "2026-10-04",
    });
    expect(
      managementFormSchemas.supervisorEnd.safeParse({
        ...input,
        expectedEndedOn: undefined,
      }).success,
    ).toBe(false);
  });
  it("normalizes profile fields, strips unapproved fields, and retains the exact password", () => {
    expect(
      managementFormSchemas.create.parse({
        ...profile,
        password: " a-valid-password ",
        isHospitalAdmin: true,
        isActive: false,
        passwordHash: "secret",
      }),
    ).toEqual({
      displayName: "نام نمونه",
      email: "user@demo.invalid",
      password: " a-valid-password ",
    });
  });
  it.each([
    {
      displayName: " ",
      email: "user@demo.invalid",
      password: "valid-password",
    },
    { ...profile, email: "not-an-email", password: "valid-password" },
    { ...profile, password: "short" },
    { ...profile, password: "a".repeat(257) },
    { ...profile, displayName: "a".repeat(201), password: "valid-password" },
  ])("rejects invalid account field values %#", (input) => {
    expect(managementFormSchemas.create.safeParse(input).success).toBe(false);
  });
  it("requires the expected profile values and ignores secret edits", () => {
    expect(
      managementFormSchemas.profile.parse({
        ...profile,
        userId,
        expectedEmail: "old@demo.invalid",
        expectedDisplayName: "old",
        password: "ignored",
      }),
    ).not.toHaveProperty("password");
    expect(
      managementFormSchemas.profile.safeParse({ ...profile, userId }).success,
    ).toBe(false);
  });
  it("requires explicit expected and requested account statuses", () => {
    expect(
      managementFormSchemas.status.parse({
        userId,
        isActive: "false",
        expectedIsActive: "true",
        isHospitalAdmin: "true",
      }),
    ).toEqual({ userId, isActive: false, expectedIsActive: true });
    for (const invalid of [true, "yes", "", undefined])
      expect(
        managementFormSchemas.status.safeParse({
          userId,
          isActive: invalid,
          expectedIsActive: "true",
        }).success,
      ).toBe(false);
    expect(
      managementFormSchemas.status.safeParse({ userId, isActive: "true" })
        .success,
    ).toBe(false);
  });
  it("converts membership dates to ISO and allows an explicitly empty optional term", () => {
    expect(
      managementFormSchemas.add.parse({ ...member, endedOn: "  " }),
    ).toEqual({
      userId,
      departmentId,
      role: "NURSE",
      startedOn: "2026-10-03",
      endedOn: null,
    });
    expect(
      managementFormSchemas.add.parse({ ...member, endedOn: "۱۴۰۵/۰۷/۱۲" })
        .endedOn,
    ).toBe("2026-10-04");
  });
  it.each([
    { ...member, role: "SUPERVISOR" },
    { ...member, role: "HOSPITAL_ADMIN" },
    { ...member, departmentId: "missing" },
    { ...member, userId: "missing" },
    { ...member, startedOn: "1405/07/31" },
    { ...member, startedOn: "2026-10-03" },
  ])("rejects unsupported role/identity/calendar values %#", (input) => {
    expect(managementFormSchemas.add.safeParse(input).success).toBe(false);
  });
  it("retains ISO expected end dates separately from the presented end date", () => {
    expect(
      managementFormSchemas.end.parse({
        relationId: userId,
        expectedEndedOn: "2026-12-31",
        endedOn: "۱۴۰۵/۰۷/۱۱",
      }),
    ).toEqual({
      relationId: userId,
      expectedEndedOn: "2026-12-31",
      endedOn: "2026-10-03",
    });
    expect(
      managementFormSchemas.end.safeParse({
        relationId: userId,
        expectedEndedOn: "۱۴۰۵/۰۷/۱۱",
        endedOn: "۱۴۰۵/۰۷/۱۱",
      }).success,
    ).toBe(false);
  });
  it.each(["transfer", "role"] as const)(
    "requires an explicit successor term and stale token for %s",
    (operation) => {
      const input = {
        relationId: userId,
        expectedEndedOn: "",
        departmentId,
        role: "HEAD_NURSE",
        startedOn: "۱۴۰۵/۰۷/۱۲",
        endedOn: "",
      };
      expect(managementFormSchemas[operation].parse(input)).toMatchObject({
        expectedEndedOn: null,
        startedOn: "2026-10-04",
        endedOn: null,
      });
      expect(
        managementFormSchemas[operation].safeParse({
          ...input,
          endedOn: undefined,
        }).success,
      ).toBe(false);
      expect(
        managementFormSchemas[operation].safeParse({
          ...input,
          expectedEndedOn: undefined,
        }).success,
      ).toBe(false);
    },
  );
  it("reads only known string form fields and refuses file values", () => {
    const form = new FormData();
    form.set("displayName", "Name");
    form.set("email", "name@demo.invalid");
    form.set("password", "valid-password");
    form.set("isHospitalAdmin", "true");
    const parsed = parseManagementForm("create", form);
    expect(parsed.success && parsed.data).toEqual({
      displayName: "Name",
      email: "name@demo.invalid",
      password: "valid-password",
    });
    form.set("password", new Blob(["secret"]), "secret.txt");
    expect(parseManagementForm("create", form).success).toBe(false);
  });
});
