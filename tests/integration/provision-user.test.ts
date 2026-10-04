import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { authenticateWithPassword } from "../../src/infrastructure/auth/credentials";
import { verifyPassword } from "../../src/infrastructure/auth/password";
import {
  departmentMemberships,
  departments,
  users,
} from "../../src/infrastructure/db/schema";
import { DEMO_USERS } from "../../src/infrastructure/db/seed/demo-data";
import { seedDemoData } from "../../src/infrastructure/db/seed/seed";
import {
  ProvisionError,
  provisionUser,
  type CreateInput,
  type ProvisionInput,
} from "../../src/infrastructure/provisioning/provision-user";
import { auditEvents } from "../../src/infrastructure/db/schema";
import {
  createUser,
  findUserById,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase({ seed: false });

const PASSWORD = "first-long-password";
const NOW = new Date("2026-09-30T08:00:00Z"); // 2026-09-30 in Tehran
const input = (over: Partial<CreateInput> = {}): CreateInput => ({
  mode: "create",
  personnelNumber: "00720",
  email: "head@example.com",
  displayName: "Head Nurse",
  password: PASSWORD,
  departmentCode: "icu",
  role: "HEAD_NURSE",
  allowNewMembership: false,
  ...over,
});

const addDepartment = async (code = "icu", isActive = true) =>
  (
    await db
      .insert(departments)
      .values({ code, name: code, isActive })
      .returning({ id: departments.id })
  )[0]!.id;

const allUsers = () => db.select().from(users);
const allMemberships = () => db.select().from(departmentMemberships);
const signIn = (password: string, identifier = "00720") =>
  authenticateWithPassword(db, { identifier, password }, NOW);
const events = () => db.select().from(auditEvents);

describe("provisionUser: create", () => {
  it("creates an active account with a temporary password that works for sign-in", async () => {
    await addDepartment();
    const result = await provisionUser(db, input(), NOW);
    expect(result).toEqual({
      mode: "create",
      personnelNumber: "00720",
      departmentCode: "icu",
      departmentStatus: "existing",
      role: "HEAD_NURSE",
      user: "created",
      membership: "created",
      password: "set (temporary)",
    });

    const [user] = await allUsers();
    expect(user).toMatchObject({
      personnelNumber: "00720",
      email: "head@example.com",
      displayName: "Head Nurse",
      isActive: true,
      mustChangePassword: true,
    });
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user!.passwordHash!, PASSWORD)).toBe(true);
    expect(await signIn(PASSWORD)).toMatchObject({
      ok: true,
      userId: user!.id,
    });
    expect((await signIn(PASSWORD, "head@example.com")).ok).toBe(true);
    expect((await signIn("wrong-password-x")).ok).toBe(false);
    expect((await events()).map((e) => [e.action, e.actorId])).toEqual([
      ["user.created", user!.id],
      ["membership.added", user!.id],
    ]);
  });

  it("creates an account without e-mail (personnel number only)", async () => {
    await addDepartment();
    await provisionUser(db, input({ email: undefined }), NOW);
    expect(await allUsers()).toMatchObject([
      { personnelNumber: "00720", email: null },
    ]);
    expect((await signIn(PASSWORD)).ok).toBe(true);
  });

  it("requires a password only when it creates the account", async () => {
    await addDepartment();
    await expect(
      provisionUser(db, input({ password: undefined }), NOW),
    ).rejects.toThrow(/PROVISION_PASSWORD is required/);
    expect(await allUsers()).toHaveLength(0);
  });

  it("creates the first HEAD_NURSE membership effective today (Tehran)", async () => {
    const departmentId = await addDepartment();
    await provisionUser(db, input(), new Date("2026-09-30T21:00:00Z")); // 00:30 next day in Tehran
    expect(await allMemberships()).toMatchObject([
      {
        departmentId,
        role: "HEAD_NURSE",
        startedOn: "2026-10-01",
        endedOn: null,
      },
    ]);
  });

  it("matches the department code case-insensitively", async () => {
    await addDepartment("icu");
    await expect(
      provisionUser(db, input({ departmentCode: "ICU" }), NOW),
    ).resolves.toMatchObject({ departmentCode: "icu" });
  });

  it("is idempotent and never resets the password of an existing account", async () => {
    await addDepartment();
    await provisionUser(db, input(), NOW);
    const [userBefore] = await allUsers();
    const [membershipBefore] = await allMemberships();
    const eventsBefore = await events();

    const repeat = await provisionUser(
      db,
      input({ password: "another-long-password" }),
      NOW,
    );
    expect(repeat).toMatchObject({
      user: "unchanged",
      membership: "unchanged",
      password: "unchanged",
    });
    expect(await allUsers()).toEqual([userBefore]);
    expect(await allMemberships()).toEqual([membershipBefore]);
    expect(await events()).toEqual(eventsBefore);
    expect((await signIn("another-long-password")).ok).toBe(false);
    expect((await signIn(PASSWORD)).ok).toBe(true);
  });

  it("never reactivates a disabled account", async () => {
    await addDepartment();
    await provisionUser(db, input(), NOW);
    const [user] = await allUsers();
    await setUserActive(db, user!.id, false);
    await expect(provisionUser(db, input(), NOW)).rejects.toThrow(
      /never reactivates/,
    );
    expect(await findUserById(db, user!.id)).toMatchObject({ isActive: false });
  });

  it.each<[string, Partial<CreateInput>, RegExp]>([
    ["display name", { displayName: "Someone Else" }, /display name/],
    ["mobile", { mobile: "09121234567" }, /mobile/],
    [
      "e-mail (matched by personnel number)",
      { email: "other@example.com" },
      /e-mail/,
    ],
    [
      "personnel number (matched by e-mail)",
      { personnelNumber: "999" },
      /personnel number/,
    ],
  ])(
    "never overwrites identity: a different %s is an error",
    async (_n, over, message) => {
      await addDepartment();
      await provisionUser(db, input(), NOW);
      const before = await allUsers();
      await expect(provisionUser(db, input(over), NOW)).rejects.toThrow(
        message,
      );
      expect(await allUsers()).toEqual(before);
    },
  );

  it("refuses when the personnel number and e-mail point at two accounts", async () => {
    await addDepartment();
    await provisionUser(db, input(), NOW);
    await provisionUser(
      db,
      input({ personnelNumber: "1", email: "b@example.com" }),
      NOW,
    );
    await expect(
      provisionUser(db, input({ email: "b@example.com" }), NOW),
    ).rejects.toThrow(/two different accounts/);
  });

  it("refuses a legacy e-mail account without a personnel number (no silent assignment)", async () => {
    await addDepartment();
    await createUser(db, {
      email: "head@example.com",
      displayName: "Head Nurse",
    });
    await expect(provisionUser(db, input(), NOW)).rejects.toThrow(
      /assign-personnel-number/,
    );
    expect(await allUsers()).toMatchObject([{ personnelNumber: null }]);
  });

  it("adds a membership to an existing account only when explicitly allowed", async () => {
    await addDepartment();
    const other = await addDepartment("er");
    await provisionUser(db, input(), NOW);
    await expect(
      provisionUser(db, input({ departmentCode: "er" }), NOW),
    ).rejects.toThrow(/PROVISION_ALLOW_NEW_MEMBERSHIP/);
    expect(await allMemberships()).toHaveLength(1);
    await expect(
      provisionUser(
        db,
        input({ departmentCode: "er", allowNewMembership: true }),
        NOW,
      ),
    ).resolves.toMatchObject({ user: "unchanged", membership: "created" });
    expect(
      (await allMemberships()).filter((m) => m.departmentId === other),
    ).toHaveLength(1);
  });

  it("fails clearly for a missing department and writes nothing", async () => {
    await expect(provisionUser(db, input(), NOW)).rejects.toThrow(
      /Department "icu" does not exist.*PROVISION_DEPARTMENT_NAME/,
    );
    expect(await allUsers()).toHaveLength(0);
    expect(await db.select().from(departments)).toHaveLength(0);
    expect(await allMemberships()).toHaveLength(0);
  });

  it("refuses an inactive department", async () => {
    await addDepartment("icu", false);
    await expect(provisionUser(db, input(), NOW)).rejects.toThrow(
      /Department "icu" is inactive/,
    );
    expect(await allUsers()).toHaveLength(0);
  });

  it("stops on a current membership with another role and changes nothing", async () => {
    await addDepartment();
    await provisionUser(db, input({ role: "NURSE" }), NOW);
    const [membershipBefore] = await allMemberships();
    const [userBefore] = await allUsers();
    await expect(provisionUser(db, input(), NOW)).rejects.toThrow(
      /current NURSE membership.*does not change roles/,
    );
    expect(await allMemberships()).toEqual([membershipBefore]);
    expect(await allUsers()).toEqual([userBefore]);
  });

  it("creates no user when the transaction fails after the insert", async () => {
    await addDepartment();
    // A fresh user cannot violate a membership constraint, so inject the failure.
    const boom = vi
      .spyOn(
        await import("../../src/infrastructure/repositories/memberships"),
        "addMembership",
      )
      .mockRejectedValueOnce(new Error("boom"));
    await expect(provisionUser(db, input(), NOW)).rejects.toThrow("boom");
    expect(boom).toHaveBeenCalled();
    expect(await allUsers()).toHaveLength(0);
    expect(await allMemberships()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  it("never resets or deletes unrelated data (demo seed survives)", async () => {
    await seedDemoData(db);
    const count = async () =>
      (
        await db.execute<{ u: number; m: number; d: number }>(sql`
          select (select count(*)::int from users) u,
                 (select count(*)::int from department_memberships) m,
                 (select count(*)::int from departments) d`)
      ).rows[0]!;
    const before = await count();

    await provisionUser(
      db,
      input({ email: "real@example.com", personnelNumber: "77" }),
      NOW,
    );

    expect(await count()).toEqual({
      u: before.u + 1,
      m: before.m + 1,
      d: before.d,
    });
    const demo = await db.select().from(users);
    expect(demo.some((u) => u.id === DEMO_USERS.icuHead.id)).toBe(true);
  });

  it("returns, logs and audits neither the password nor its hash", async () => {
    await addDepartment();
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const result = await provisionUser(db, input(), NOW);
    const [user] = await allUsers();

    const serialized = JSON.stringify([result, await events()]);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(user!.passwordHash!);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(
      PASSWORD,
    );
  });
});

describe("provisionUser: explicit recovery and backfill", () => {
  const reset = (
    over: Partial<Extract<ProvisionInput, { mode: "reset-password" }>> = {},
  ): ProvisionInput => ({
    mode: "reset-password",
    personnelNumber: "00720",
    password: "recovery-long-password",
    confirm: "RESET_PASSWORD",
    ...over,
  });

  it("reset-password sets a temporary password, ends sessions and is audited", async () => {
    await addDepartment();
    await provisionUser(db, input(), NOW);
    const [before] = await allUsers();
    expect(await provisionUser(db, reset(), NOW)).toEqual({
      mode: "reset-password",
      userId: before!.id,
    });
    const [after] = await allUsers();
    expect(after).toMatchObject({
      mustChangePassword: true,
      sessionVersion: before!.sessionVersion + 1,
      isActive: true,
    });
    expect((await signIn("recovery-long-password")).ok).toBe(true);
    expect((await signIn(PASSWORD)).ok).toBe(false);
    expect((await events()).at(-1)).toMatchObject({
      action: "user.temporaryCredentialIssued",
      data: { source: "operatorCli" },
    });
  });

  it("reset-password never reactivates and fails for unknown accounts", async () => {
    await addDepartment();
    await provisionUser(db, input(), NOW);
    const [user] = await allUsers();
    await setUserActive(db, user!.id, false);
    await expect(provisionUser(db, reset(), NOW)).rejects.toThrow(
      /never reactivates/,
    );
    await expect(
      provisionUser(db, reset({ personnelNumber: "404" }), NOW),
    ).rejects.toThrow(/No matching account/);
  });

  it("assign-personnel-number backfills a legacy account once, audited, never overwriting", async () => {
    const legacy = await createUser(db, {
      email: "admin@example.com",
      displayName: "Admin",
    });
    const assign = (personnelNumber: string): ProvisionInput => ({
      mode: "assign-personnel-number",
      email: "admin@example.com",
      personnelNumber,
      confirm: "ASSIGN_PERSONNEL_NUMBER",
    });
    expect(await provisionUser(db, assign("0042"), NOW)).toMatchObject({
      result: "assigned",
    });
    expect(await findUserById(db, legacy.id)).toMatchObject({
      personnelNumber: "0042",
    });
    expect(await events()).toMatchObject([
      {
        action: "user.personnelNumberAssigned",
        actorId: legacy.id,
        data: { before: null, after: "0042", source: "operatorCli" },
      },
    ]);
    expect(await provisionUser(db, assign("0042"), NOW)).toMatchObject({
      result: "unchanged",
    });
    await expect(provisionUser(db, assign("43"), NOW)).rejects.toThrow(
      /already has a different personnel number/,
    );
    await createUser(db, { email: "b@example.com", displayName: "B" });
    await expect(
      provisionUser(
        db,
        {
          ...(assign("0042") as object),
          email: "b@example.com",
        } as ProvisionInput,
        NOW,
      ),
    ).rejects.toThrow(/belongs to another account/);
    expect(await events()).toHaveLength(1);
  });
});

describe("department bootstrap", () => {
  const withName = (over: Partial<CreateInput> = {}) =>
    input({ departmentCode: "ICU", departmentName: "Intensive Care", ...over });

  it("creates a missing department when a name is given, with the exact code", async () => {
    const result = await provisionUser(db, withName(), NOW);
    expect(result).toMatchObject({
      departmentCode: "ICU",
      departmentStatus: "created",
      user: "created",
      membership: "created",
    });
    const [department] = await db.select().from(departments);
    expect(department).toMatchObject({
      code: "ICU", // not lowercased or rewritten
      name: "Intensive Care",
      isActive: true,
      timezone: "Asia/Tehran",
    });
    expect(await allMemberships()).toMatchObject([
      { departmentId: department!.id, role: "HEAD_NURSE" },
    ]);
  });

  it("does not create a department without a name and writes nothing", async () => {
    await expect(
      provisionUser(db, input({ departmentCode: "ICU" }), NOW),
    ).rejects.toThrow(/PROVISION_DEPARTMENT_NAME/);
    expect(await db.select().from(departments)).toHaveLength(0);
    expect(await allUsers()).toHaveLength(0);
    expect(await allMemberships()).toHaveLength(0);
  });

  it("reuses an existing department and never renames it", async () => {
    const departmentId = await addDepartment("icu");
    const result = await provisionUser(
      db,
      withName({ departmentCode: "icu" }),
      NOW,
    );
    expect(result).toMatchObject({ departmentStatus: "existing" });
    expect(await db.select().from(departments)).toMatchObject([
      { id: departmentId, code: "icu", name: "icu" },
    ]);
  });

  it("repeat runs create no second department, user or membership", async () => {
    expect(await provisionUser(db, withName(), NOW)).toMatchObject({
      departmentStatus: "created",
    });
    expect(await provisionUser(db, withName(), NOW)).toMatchObject({
      departmentStatus: "existing",
    });
    expect(await db.select().from(departments)).toHaveLength(1);
    expect(await allUsers()).toHaveLength(1);
    expect(await allMemberships()).toHaveLength(1);
  });

  it("does not reactivate an inactive department, even with a name", async () => {
    await addDepartment("ICU", false);
    await expect(provisionUser(db, withName(), NOW)).rejects.toThrow(
      /inactive/,
    );
    expect(await db.select().from(departments)).toMatchObject([
      { isActive: false },
    ]);
    expect(await allUsers()).toHaveLength(0);
  });

  it("rolls back the department, user and membership if a later step fails", async () => {
    const boom = vi
      .spyOn(
        await import("../../src/infrastructure/repositories/memberships"),
        "addMembership",
      )
      .mockRejectedValueOnce(new Error("boom"));
    await expect(provisionUser(db, withName(), NOW)).rejects.toThrow("boom");
    expect(boom).toHaveBeenCalled();
    expect(await db.select().from(departments)).toHaveLength(0);
    expect(await allUsers()).toHaveLength(0);
    expect(await allMemberships()).toHaveLength(0);
  });

  it("concurrent runs for a new department create it exactly once", async () => {
    const results = await Promise.all([
      provisionUser(
        db,
        withName({ email: "a@example.com", personnelNumber: "1" }),
        NOW,
      ),
      provisionUser(
        db,
        withName({ email: "b@example.com", personnelNumber: "2" }),
        NOW,
      ),
      // Same code in another case must resolve to the same department.
      provisionUser(
        db,
        withName({
          email: "c@example.com",
          personnelNumber: "3",
          departmentCode: "icu",
        }),
        NOW,
      ),
    ]);
    expect(
      results.filter(
        (r) => "departmentStatus" in r && r.departmentStatus === "created",
      ),
    ).toHaveLength(1);
    expect(await db.select().from(departments)).toHaveLength(1);
    expect(await allUsers()).toHaveLength(3);
    expect(await allMemberships()).toHaveLength(3);
  });

  it("concurrent runs for the same user still yield one user and membership", async () => {
    await Promise.all([
      provisionUser(db, withName(), NOW),
      provisionUser(db, withName(), NOW),
    ]);
    expect(await db.select().from(departments)).toHaveLength(1);
    expect(await allUsers()).toHaveLength(1);
    expect(await allMemberships()).toHaveLength(1);
  });

  it("reports department state without exposing secrets", async () => {
    const result = await provisionUser(db, withName(), NOW);
    const [user] = await allUsers();
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"departmentStatus":"created"');
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(user!.passwordHash!);
  });
});

describe("ProvisionError", () => {
  it("is what callers get for domain-level failures", async () => {
    await expect(provisionUser(db, input(), NOW)).rejects.toBeInstanceOf(
      ProvisionError,
    );
  });
});
