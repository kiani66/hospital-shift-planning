import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  authenticateWithPassword,
  normalizeEmail,
} from "../../src/infrastructure/auth/credentials";
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
  type ProvisionInput,
} from "../../src/infrastructure/provisioning/provision-user";
import { createUser } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase({ seed: false });

const PASSWORD = "first-long-password";
const NOW = new Date("2026-09-30T08:00:00Z"); // 2026-09-30 in Tehran
const input = (over: Partial<ProvisionInput> = {}): ProvisionInput => ({
  email: "head@example.com",
  password: PASSWORD,
  departmentCode: "icu",
  role: "HEAD_NURSE",
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
const signIn = (password: string, email = "head@example.com") =>
  authenticateWithPassword(db, { email, password }, NOW);

describe("provisionUser", () => {
  it("creates an active user whose hash works with the login path", async () => {
    await addDepartment();
    const result = await provisionUser(
      db,
      input({ email: "head@example.com" }),
      NOW,
    );
    expect(result).toMatchObject({
      userCreated: true,
      membership: "created",
      role: "HEAD_NURSE",
      isActive: true,
    });

    const [user] = await allUsers();
    expect(user).toMatchObject({
      email: "head@example.com",
      displayName: "head",
      isActive: true,
    });
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user!.passwordHash!, PASSWORD)).toBe(true);
    expect(await signIn(PASSWORD)).toEqual({ ok: true, userId: user!.id });
    expect((await signIn("wrong-password-x")).ok).toBe(false);
  });

  it("stores the normalized e-mail and uses the display name when given", async () => {
    await addDepartment();
    await provisionUser(
      db,
      input({
        email: normalizeEmail("  Head@Example.COM "),
        displayName: "Head N.",
      }),
      NOW,
    );
    expect(await allUsers()).toMatchObject([
      { email: "head@example.com", displayName: "Head N." },
    ]);
    expect((await signIn(PASSWORD, "HEAD@example.com ")).ok).toBe(true);
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

  it("reuses an existing user, updates the password, keeps other data", async () => {
    await addDepartment();
    const existing = await createUser(db, {
      email: "Head@Example.com",
      displayName: "Keep Me",
      passwordHash: "old-hash",
      isActive: false,
    });

    const result = await provisionUser(
      db,
      input({ password: "second-long-password" }),
      NOW,
    );
    expect(result.userCreated).toBe(false);

    const rows = await allUsers();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: existing.id,
      email: "Head@Example.com",
      displayName: "Keep Me",
      isActive: true, // inactive user is reactivated
    });
    expect(await signIn(PASSWORD)).toMatchObject({ ok: false });
    expect(await signIn("second-long-password")).toEqual({
      ok: true,
      userId: existing.id,
    });
  });

  it("is idempotent: a repeat run adds no user or membership", async () => {
    await addDepartment();
    await provisionUser(db, input(), NOW);
    const [before] = await allMemberships();
    const repeat = await provisionUser(db, input(), NOW);

    expect(repeat).toMatchObject({
      userCreated: false,
      membership: "unchanged",
    });
    expect(await allUsers()).toHaveLength(1);
    expect(await allMemberships()).toEqual([before]);
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

    await expect(
      provisionUser(db, input({ password: "changed-long-password" }), NOW),
    ).rejects.toThrow(/current NURSE membership.*does not change roles/);

    expect(await allMemberships()).toEqual([membershipBefore]);
    // The password update in the same transaction was rolled back too.
    expect(await allUsers()).toEqual([userBefore]);
    expect((await signIn(PASSWORD)).ok).toBe(true);
  });

  it("rolls back the password update when the membership step fails", async () => {
    const departmentId = await addDepartment();
    const other = await createUser(db, {
      email: "x@example.com",
      displayName: "x",
    });
    // An upcoming membership would overlap a new one: the command must stop
    // after it already updated the user, and roll that update back.
    await db.insert(departmentMemberships).values({
      userId: other.id,
      departmentId,
      role: "NURSE",
      startedOn: "2026-12-01",
    });
    const before = await allUsers();

    await expect(
      provisionUser(
        db,
        input({ email: "x@example.com", password: "changed-long-password" }),
        NOW,
      ),
    ).rejects.toThrow(/starting 2026-12-01/);
    expect(await allUsers()).toEqual(before);
    expect(await allMemberships()).toHaveLength(1);
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
  });

  it("starts a new membership after a past one ended (history kept)", async () => {
    const departmentId = await addDepartment();
    const user = await createUser(db, {
      email: "head@example.com",
      displayName: "h",
    });
    await db.insert(departmentMemberships).values({
      userId: user.id,
      departmentId,
      role: "NURSE",
      startedOn: "2025-01-01",
      endedOn: "2026-01-31",
    });
    await provisionUser(db, input(), NOW);
    expect(await allMemberships()).toHaveLength(2);
    expect(
      (await allMemberships()).find((m) => m.endedOn === "2026-01-31"),
    ).toMatchObject({ role: "NURSE" });
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

    await provisionUser(db, input({ email: "real@example.com" }), NOW);

    expect(await count()).toEqual({
      u: before.u + 1,
      m: before.m + 1,
      d: before.d,
    });
    const demo = await db.select().from(users);
    expect(demo.some((u) => u.id === DEMO_USERS.icuHead.id)).toBe(true);
  });

  it("returns and logs neither the password nor its hash", async () => {
    await addDepartment();
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const result = await provisionUser(db, input(), NOW);
    const [user] = await allUsers();

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(user!.passwordHash!);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(
      PASSWORD,
    );
  });
});

describe("department bootstrap", () => {
  const withName = (over: Partial<ProvisionInput> = {}) =>
    input({ departmentCode: "ICU", departmentName: "Intensive Care", ...over });

  it("creates a missing department when a name is given, with the exact code", async () => {
    const result = await provisionUser(db, withName(), NOW);
    expect(result).toMatchObject({
      departmentCode: "ICU",
      departmentStatus: "created",
      userCreated: true,
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
    expect(result.departmentStatus).toBe("existing");
    expect(await db.select().from(departments)).toMatchObject([
      { id: departmentId, code: "icu", name: "icu" },
    ]);
  });

  it("repeat runs create no second department, user or membership", async () => {
    expect((await provisionUser(db, withName(), NOW)).departmentStatus).toBe(
      "created",
    );
    expect((await provisionUser(db, withName(), NOW)).departmentStatus).toBe(
      "existing",
    );
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
      provisionUser(db, withName({ email: "a@example.com" }), NOW),
      provisionUser(db, withName({ email: "b@example.com" }), NOW),
      // Same code in another case must resolve to the same department.
      provisionUser(
        db,
        withName({ email: "c@example.com", departmentCode: "icu" }),
        NOW,
      ),
    ]);
    expect(
      results.filter((r) => r.departmentStatus === "created"),
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
