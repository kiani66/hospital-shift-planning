import { readFileSync } from "node:fs";

import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";

import { changeOwnPassword } from "../../src/application/account/password";
import { createAccount } from "../../src/application/management/accounts";
import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import { issueTemporaryPassword } from "../../src/application/management/credentials";
import { setUserPersonnelNumber } from "../../src/application/management/personnel-number";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import {
  actorFromSession,
  resolveSession,
} from "../../src/infrastructure/auth/actor";
import { authenticateWithPassword } from "../../src/infrastructure/auth/credentials";
import { auditEvents, users } from "../../src/infrastructure/db/schema";
import {
  DEMO_PASSWORD,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { readPersonnelInventory } from "../../src/infrastructure/provisioning/personnel-inventory";
import { LOGIN_THROTTLE } from "../../src/infrastructure/repositories/login-throttles";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  createUser,
  findUserById,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db, url } = setupTestDatabase();
const TODAY = isoDate("2026-10-03");
const NOW = new Date("2026-10-03T08:00:00Z");

const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, TODAY))!,
  clock: () => NOW,
});
let admin: AppContext;

function data<T>(result: ActionResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
const failure = (result: ActionResult<unknown>) => {
  expect(result.ok).toBe(false);
  return (result as { error: { code: string; reason?: string } }).error;
};
const login = (identifier: string, password: string, now = NOW) =>
  authenticateWithPassword(db, { identifier, password }, now);
const session = (id: string, sv?: number) => ({
  user: sv === undefined ? { id } : { id, sv },
  expires: "2099-01-01T00:00:00.000Z",
});
const events = () => db.select().from(auditEvents).orderBy(auditEvents.id);

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    NOW,
  );
  admin = await as(U.icuHead.id);
});

describe("database constraints (migration 0009)", () => {
  it("stores personnel numbers as text, preserving leading zeros", async () => {
    const user = await createUser(db, {
      personnelNumber: "00125",
      displayName: "Zero",
    });
    expect((await findUserById(db, user.id))?.personnelNumber).toBe("00125");
    await createUser(db, { personnelNumber: "125", displayName: "Other" });
  });

  it.each([
    ["non-digits", { personnelNumber: "12a" }],
    ["21 digits", { personnelNumber: "1".repeat(21) }],
    ["Persian digits (must be normalized first)", { personnelNumber: "۱۲" }],
    ["empty", { personnelNumber: "" }],
    ["a malformed mobile", { personnelNumber: "1", mobile: "9121234567" }],
    ["no login identifier at all", { personnelNumber: null, email: null }],
  ])("rejects %s", async (_name, values) => {
    await expect(
      createUser(db, { displayName: "x", ...values }),
    ).rejects.toThrow();
  });

  it("enforces unique personnel numbers but allows shared mobiles and missing e-mail", async () => {
    await createUser(db, {
      personnelNumber: "777",
      mobile: "09121234567",
      displayName: "A",
    });
    await createUser(db, {
      personnelNumber: "778",
      mobile: "09121234567",
      displayName: "B",
    });
    await expect(
      createUser(db, { personnelNumber: "777", displayName: "C" }),
    ).rejects.toThrow();
  });

  it("gives existing rows safe defaults (no forced change, session version 0)", async () => {
    const [row] = await db
      .select({
        mustChangePassword: users.mustChangePassword,
        sessionVersion: users.sessionVersion,
      })
      .from(users)
      .where(eq(users.id, U.icuNurse1.id));
    expect(row).toEqual({ mustChangePassword: false, sessionVersion: 0 });
  });
});

describe("sign-in by personnel number or e-mail", () => {
  it("accepts the personnel number, with leading zeros and Persian digits", async () => {
    expect(await login("01011", DEMO_PASSWORD)).toEqual({
      ok: true,
      userId: U.icuNurse1.id,
      sessionVersion: 0,
    });
    expect(await login(" ۰۱۰۱۱ ", DEMO_PASSWORD)).toMatchObject({ ok: true });
    // Leading zeros are significant: 1011 is a different (unknown) number.
    expect(await login("1011", DEMO_PASSWORD)).toEqual({
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });
  });

  it("keeps e-mail sign-in for existing users", async () => {
    expect(await login(U.icuNurse1.email, DEMO_PASSWORD)).toMatchObject({
      ok: true,
      userId: U.icuNurse1.id,
    });
  });

  it("lets personnel without e-mail sign in by personnel number", async () => {
    const created = data(
      await createAccount(admin, {
        personnelNumber: "4242",
        displayName: "بدون ایمیل",
        issueTemporaryPassword: true,
      }),
    );
    expect(created.email).toBeNull();
    expect(await login("4242", created.temporaryPassword!)).toMatchObject({
      ok: true,
      userId: created.id,
    });
  });

  it("gives unknown and unrecognized identifiers the generic failure", async () => {
    for (const identifier of ["9999999", "nobody@demo.invalid", "not a number"])
      expect(await login(identifier, DEMO_PASSWORD)).toEqual({
        ok: false,
        reason: "INVALID_CREDENTIALS",
      });
  });

  it("refuses a newly imported account that has no password yet", async () => {
    await createUser(db, { personnelNumber: "5151", displayName: "No pass" });
    expect(await login("5151", "")).toMatchObject({ ok: false });
    expect(await login("5151", "anything-long")).toMatchObject({ ok: false });
  });
});

describe("account-level throttling across identifiers", () => {
  it("counts e-mail and personnel-number failures against the same account", async () => {
    for (let i = 0; i < LOGIN_THROTTLE.maxFailures; i++)
      await login(i % 2 ? U.icuNurse1.email : "01011", "wrong password");
    for (const identifier of [U.icuNurse1.email, "01011", "۰۱۰۱۱"])
      expect(await login(identifier, DEMO_PASSWORD)).toEqual({
        ok: false,
        reason: "THROTTLED",
      });
    expect(await login(U.icuNurse2.email, DEMO_PASSWORD)).toMatchObject({
      ok: true,
    });
  });

  it("throttles unknown identifiers with a fallback key, like real ones", async () => {
    for (let i = 0; i < LOGIN_THROTTLE.maxFailures; i++)
      await login("123456789", "wrong password");
    expect(await login("123456789", "x")).toEqual({
      ok: false,
      reason: "THROTTLED",
    });
    // Another unknown identifier is not affected.
    expect(await login("123456780", "x")).toEqual({
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });
  });
});

describe("temporary passwords, forced change and session invalidation", () => {
  const issue = async (userId = U.icuNurse1.id) =>
    data(await issueTemporaryPassword(admin, { userId })).temporaryPassword;

  it("issues a strong one-time password, audited without any credential material", async () => {
    const password = await issue();
    expect(password).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
    expect(await issue()).not.toBe(password);
    const serialized = JSON.stringify(await events());
    expect(serialized).not.toContain(password);
    expect(serialized).not.toMatch(/argon2|hash|secret/i);
    expect((await events()).at(-1)).toMatchObject({
      action: "user.temporaryCredentialIssued",
      actorId: admin.actor.userId,
      entityId: U.icuNurse1.id,
      data: { source: "single", hadCredentials: true },
    });
  });

  it("invalidates every existing session of the user", async () => {
    const before = session(U.icuNurse1.id);
    expect(await actorFromSession(db, before, TODAY)).not.toBeNull();
    await issue();
    expect(await actorFromSession(db, before, TODAY)).toBeNull();
    expect(
      await actorFromSession(db, session(U.icuNurse1.id, 0), TODAY),
    ).toBeNull();
  });

  it("requires the forced change before anything else, then works with a new session", async () => {
    const temporary = await issue();
    const signedIn = await login("01011", temporary);
    expect(signedIn).toEqual({
      ok: true,
      userId: U.icuNurse1.id,
      sessionVersion: 1,
    });
    const forcedSession = session(U.icuNurse1.id, 1);
    expect(await resolveSession(db, forcedSession, TODAY)).toMatchObject({
      status: "passwordChangeRequired",
    });
    // No actor: every page, action and use case refuses until the change.
    expect(await actorFromSession(db, forcedSession, TODAY)).toBeNull();

    const forced = await as(U.icuNurse1.id);
    const changed = data(
      await changeOwnPassword(forced, {
        currentPassword: temporary,
        newPassword: "my-own-new-password",
        confirmation: "my-own-new-password",
      }),
    );
    expect(changed).toEqual({
      status: "CHANGED",
      loginIdentifier: "01011",
      wasForced: true,
    });
    // The forced-change session itself is now invalid too.
    expect(await resolveSession(db, forcedSession, TODAY)).toEqual({
      status: "none",
    });
    const next = await login("01011", "my-own-new-password");
    expect(next).toMatchObject({ ok: true, sessionVersion: 2 });
    expect(
      await actorFromSession(db, session(U.icuNurse1.id, 2), TODAY),
    ).toMatchObject({ userId: U.icuNurse1.id });
    expect(await login("01011", temporary)).toMatchObject({ ok: false });
    expect((await events()).at(-1)).toMatchObject({
      action: "user.credentialsChanged",
      actorId: U.icuNurse1.id,
      data: { source: "selfService", afterTemporary: true },
    });
  });

  it("self-service change invalidates the user's other sessions", async () => {
    const nurse = await as(U.icuNurse2.id);
    const otherDevice = session(U.icuNurse2.id);
    data(
      await changeOwnPassword(nurse, {
        currentPassword: DEMO_PASSWORD,
        newPassword: "another-long-password",
        confirmation: "another-long-password",
      }),
    );
    expect(await actorFromSession(db, otherDevice, TODAY)).toBeNull();
    expect(
      await login(U.icuNurse2.email, "another-long-password"),
    ).toMatchObject({ ok: true, sessionVersion: 1 });
  });

  it("counts wrong current passwords against the account throttle and changes nothing", async () => {
    const nurse = await as(U.icuNurse3.id);
    for (let i = 0; i < LOGIN_THROTTLE.maxFailures; i++)
      expect(
        data(
          await changeOwnPassword(nurse, {
            currentPassword: "wrong password",
            newPassword: "another-long-password",
            confirmation: "another-long-password",
          }),
        ),
      ).toEqual({ status: "INVALID_CURRENT_PASSWORD" });
    expect(
      data(
        await changeOwnPassword(nurse, {
          currentPassword: DEMO_PASSWORD,
          newPassword: "another-long-password",
          confirmation: "another-long-password",
        }),
      ),
    ).toEqual({ status: "THROTTLED" });
    expect(await login(U.icuNurse3.email, DEMO_PASSWORD)).toEqual({
      ok: false,
      reason: "THROTTLED",
    });
    expect(
      await actorFromSession(db, session(U.icuNurse3.id), TODAY),
    ).not.toBeNull();
  });

  it.each<[string, Record<string, string>, string]>([
    [
      "too short",
      { newPassword: "short", confirmation: "short" },
      "PASSWORD_LENGTH",
    ],
    [
      "unconfirmed",
      { confirmation: "different-long-pass" },
      "PASSWORD_CONFIRMATION_MISMATCH",
    ],
    [
      "unchanged",
      { newPassword: DEMO_PASSWORD, confirmation: DEMO_PASSWORD },
      "PASSWORD_UNCHANGED",
    ],
  ])("rejects a %s new password", async (_name, over, reason) => {
    const result = await changeOwnPassword(await as(U.icuNurse4.id), {
      currentPassword: DEMO_PASSWORD,
      newPassword: "valid-new-password",
      confirmation: "valid-new-password",
      ...over,
    });
    expect(failure(result)).toMatchObject({ code: "VALIDATION", reason });
  });

  it("cannot change another user's password", async () => {
    const forged = await as(U.icuNurse1.id);
    // The command always targets the actor; there is no user id input.
    data(
      await changeOwnPassword(forged, {
        currentPassword: DEMO_PASSWORD,
        newPassword: "another-long-password",
        confirmation: "another-long-password",
        userId: U.icuNurse2.id,
      } as never),
    );
    expect(await login(U.icuNurse2.email, DEMO_PASSWORD)).toMatchObject({
      ok: true,
    });
  });

  it("is admin-only, never for oneself, never reactivates, with stale protection", async () => {
    expect(
      failure(
        await issueTemporaryPassword(await as(U.erHead.id), {
          userId: U.icuNurse1.id,
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      failure(
        await issueTemporaryPassword(admin, { userId: admin.actor.userId }),
      ),
    ).toMatchObject({ reason: "SELF_TEMPORARY_PASSWORD" });
    expect(
      failure(
        await issueTemporaryPassword(admin, { userId: U.inactiveNurse.id }),
      ),
    ).toMatchObject({ reason: "ACCOUNT_INACTIVE" });
    expect((await findUserById(db, U.inactiveNurse.id))?.isActive).toBe(false);
    expect(
      failure(
        await issueTemporaryPassword(admin, {
          userId: U.icuNurse1.id,
          expectedHasCredentials: false,
        }),
      ),
    ).toMatchObject({ code: "CONFLICT", reason: "CREDENTIALS_CHANGED" });
  });

  it("clears an existing lockout so the temporary password works at once", async () => {
    for (let i = 0; i < LOGIN_THROTTLE.maxFailures; i++)
      await login("01011", "wrong password");
    const temporary = await issue();
    expect(await login("01011", temporary)).toMatchObject({ ok: true });
  });

  it("a deactivated user stays out even with a valid new-version session", async () => {
    const temporary = await issue();
    await login("01011", temporary);
    await setUserActive(db, U.icuNurse1.id, false);
    expect(await resolveSession(db, session(U.icuNurse1.id, 1), TODAY)).toEqual(
      { status: "none" },
    );
  });
});

describe("personnel-number assignment and correction", () => {
  const legacy = () =>
    createUser(db, {
      email: "legacy@demo.invalid",
      displayName: "Legacy",
      passwordHash: null,
    });

  it("backfills a legacy account (audited) and the number then signs in", async () => {
    const user = await legacy();
    data(
      await setUserPersonnelNumber(admin, {
        userId: user.id,
        expectedPersonnelNumber: null,
        personnelNumber: "۰۰۹",
      }),
    );
    expect((await findUserById(db, user.id))?.personnelNumber).toBe("009");
    expect((await events()).at(-1)).toMatchObject({
      action: "user.personnelNumberAssigned",
      actorId: admin.actor.userId,
      entityId: user.id,
      data: { before: null, after: "009" },
    });
  });

  it("corrects a number: old one stops working, new one works, sessions and id untouched", async () => {
    const live = session(U.icuNurse1.id);
    data(
      await setUserPersonnelNumber(admin, {
        userId: U.icuNurse1.id,
        expectedPersonnelNumber: "01011",
        personnelNumber: "2011",
      }),
    );
    expect(await login("01011", DEMO_PASSWORD)).toMatchObject({ ok: false });
    expect(await login("2011", DEMO_PASSWORD)).toEqual({
      ok: true,
      userId: U.icuNurse1.id,
      sessionVersion: 0,
    });
    expect(await actorFromSession(db, live, TODAY)).toMatchObject({
      userId: U.icuNurse1.id,
    });
    const event = (await events()).at(-1)!;
    expect(event).toMatchObject({
      action: "user.personnelNumberCorrected",
      actorId: admin.actor.userId,
      entityId: U.icuNurse1.id,
      data: { before: "01011", after: "2011" },
    });
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("rejects duplicates, clearing, invalid values and stale forms without writes", async () => {
    const before = await events();
    const base = {
      userId: U.icuNurse1.id,
      expectedPersonnelNumber: "01011",
    };
    expect(
      failure(
        await setUserPersonnelNumber(admin, {
          ...base,
          personnelNumber: "1012",
        }),
      ),
    ).toMatchObject({ code: "VALIDATION", reason: "PERSONNEL_NUMBER_TAKEN" });
    for (const personnelNumber of ["", "  ", "12-3", "1".repeat(21)])
      expect(
        failure(
          await setUserPersonnelNumber(admin, { ...base, personnelNumber }),
        ),
      ).toMatchObject({ code: "VALIDATION" });
    expect(
      failure(
        await setUserPersonnelNumber(admin, {
          ...base,
          expectedPersonnelNumber: null,
          personnelNumber: "3000",
        }),
      ),
    ).toMatchObject({ code: "CONFLICT", reason: "PERSONNEL_NUMBER_CHANGED" });
    expect(
      failure(
        await setUserPersonnelNumber(await as(U.erHead.id), {
          ...base,
          personnelNumber: "3000",
        }),
      ),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(await events()).toEqual(before);
    expect((await findUserById(db, U.icuNurse1.id))?.personnelNumber).toBe(
      "01011",
    );
  });

  it("an unchanged value is a no-op", async () => {
    const before = await events();
    data(
      await setUserPersonnelNumber(admin, {
        userId: U.icuNurse1.id,
        expectedPersonnelNumber: "01011",
        personnelNumber: "01011",
      }),
    );
    expect(await events()).toEqual(before);
  });
});

describe("personnel-number stages (inventory and staged NOT NULL)", () => {
  const staged = readFileSync(
    "src/infrastructure/db/staged/0010_personnel_number_required.sql",
    "utf8",
  )
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  /** Runs the staged migration in a transaction that is always rolled back. */
  async function tryStrictStage(prepare?: (c: Client) => Promise<void>) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("begin");
      await prepare?.(client);
      for (const statement of staged) await client.query(statement);
      const { rows } = await client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
         where table_name = 'users' and column_name = 'personnel_number'`,
      );
      return rows[0]!.is_nullable;
    } finally {
      await client.query("rollback").catch(() => {});
      await client.end();
    }
  }

  it("is not part of the journaled migrations", () => {
    const journal = JSON.parse(
      readFileSync(
        "src/infrastructure/db/migrations/meta/_journal.json",
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).not.toContain(
      "0010_personnel_number_required",
    );
  });

  it("inventories legacy accounts without inventing numbers", async () => {
    const user = await createUser(db, {
      email: "legacy@demo.invalid",
      displayName: "Legacy",
    });
    const inventory = await readPersonnelInventory(db);
    expect(inventory.readyForStrictStage).toBe(false);
    expect(inventory.missing).toEqual([
      {
        id: user.id,
        email: "legacy@demo.invalid",
        displayName: "Legacy",
        isActive: true,
        isHospitalAdmin: false,
      },
    ]);
    expect(JSON.stringify(inventory)).not.toMatch(/hash|password/i);
    expect((await findUserById(db, user.id))?.personnelNumber).toBeNull();
  });

  it("fails safely while any account lacks a personnel number", async () => {
    await createUser(db, { email: "legacy@demo.invalid", displayName: "L" });
    await expect(tryStrictStage()).rejects.toThrow(
      /backfill incomplete: 1 user/,
    );
    // Nothing changed: the column is still nullable.
    expect(
      await tryStrictStage(async (c) => {
        await c.query(
          `update users set personnel_number = '99' where personnel_number is null`,
        );
      }),
    ).toBe("NO");
    const { rows } = await db.execute<{ is_nullable: string }>(
      sql`select is_nullable from information_schema.columns
          where table_name = 'users' and column_name = 'personnel_number'`,
    );
    expect(rows[0]!.is_nullable).toBe("YES");
  });

  it("succeeds once every account is backfilled (demo data)", async () => {
    expect((await readPersonnelInventory(db)).readyForStrictStage).toBe(true);
    expect(await tryStrictStage()).toBe("NO");
  });
});
