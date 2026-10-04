import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/application/errors";
import {
  getDepartmentForPage,
  getReviewDepartments,
  getShellContext,
} from "../../src/application/workspace/queries";
import type { Actor } from "../../src/domain/authz/actor";
import { isoDate } from "../../src/domain/shared/dates";
import { actorFromSession } from "../../src/infrastructure/auth/actor";
import {
  authenticateWithPassword,
  unknownIdentifierThrottleKey,
} from "../../src/infrastructure/auth/credentials";
import { hashPassword } from "../../src/infrastructure/auth/password";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_PASSWORD,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { LOGIN_THROTTLE } from "../../src/infrastructure/repositories/login-throttles";
import {
  addMembership,
  endMembership,
} from "../../src/infrastructure/repositories/memberships";
import {
  createUser,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import { openPreferencesForTest } from "./support/example-commands";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T08:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const login = (identifier: string, password: string, now = NOW) =>
  authenticateWithPassword(db, { identifier, password }, now);
const INVALID = { ok: false, reason: "INVALID_CREDENTIALS" } as const;
const THROTTLED = { ok: false, reason: "THROTTLED" } as const;

const sessionFor = (id: string, extra: Record<string, unknown> = {}) => ({
  user: { id, ...extra },
  expires: "2099-01-01T00:00:00.000Z",
});
const actorOf = (id: string, onDate = TODAY) =>
  actorFromSession(db, sessionFor(id), onDate);

describe("sign-in with e-mail and password", () => {
  it("accepts the right password and identifies the user", async () => {
    expect(await login(U.icuNurse1.email, DEMO_PASSWORD)).toEqual({
      ok: true,
      userId: U.icuNurse1.id,
      sessionVersion: 0,
    });
  });

  it("matches the e-mail case-insensitively and ignores surrounding spaces", async () => {
    expect(
      await login(`  ${U.icuHead.email.toUpperCase()} `, DEMO_PASSWORD),
    ).toEqual({ ok: true, userId: U.icuHead.id, sessionVersion: 0 });
  });

  it("rejects a wrong password with the generic failure", async () => {
    expect(await login(U.icuNurse1.email, "wrong password")).toEqual(INVALID);
  });

  it("gives an unknown e-mail exactly the same response as a wrong password", async () => {
    const unknown = await login("nobody@demo.invalid", DEMO_PASSWORD);
    const wrong = await login(U.icuNurse1.email, "wrong password");
    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual(INVALID);
  });

  it("rejects a deactivated user even with the right password", async () => {
    expect(await login(U.inactiveNurse.email, DEMO_PASSWORD)).toEqual(INVALID);
  });

  it("rejects a user who has no password set", async () => {
    await createUser(db, {
      email: "no-password@demo.invalid",
      displayName: "بدون رمز",
    });
    expect(await login("no-password@demo.invalid", "")).toEqual(INVALID);
    expect(await login("no-password@demo.invalid", "anything")).toEqual(
      INVALID,
    );
  });

  it("uses the stored Argon2id hash (a changed password takes effect)", async () => {
    await db.execute(
      sql`update users set password_hash = ${await hashPassword("new secret")} where id = ${U.icuNurse2.id}`,
    );
    expect(await login(U.icuNurse2.email, DEMO_PASSWORD)).toEqual(INVALID);
    expect(await login(U.icuNurse2.email, "new secret")).toMatchObject({
      ok: true,
    });
  });
});

describe("login throttling", () => {
  const fail = (email: string, times: number, now = NOW) =>
    Array.from({ length: times }).reduce<Promise<unknown>>(
      (p) => p.then(() => login(email, "wrong password", now)),
      Promise.resolve(),
    );

  it(`locks an address after ${LOGIN_THROTTLE.maxFailures} failures, even for the right password`, async () => {
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures - 1);
    expect(await login(U.icuNurse1.email, "wrong password")).toEqual(INVALID);
    expect(await login(U.icuNurse1.email, DEMO_PASSWORD)).toEqual(THROTTLED);
  });

  it("throttles unknown addresses exactly like known ones", async () => {
    await fail("nobody@demo.invalid", LOGIN_THROTTLE.maxFailures);
    expect(await login("nobody@demo.invalid", "x")).toEqual(THROTTLED);
  });

  it("only locks the attacked address", async () => {
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures);
    expect(await login(U.icuNurse2.email, DEMO_PASSWORD)).toMatchObject({
      ok: true,
    });
  });

  it("unlocks after the lockout period", async () => {
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures);
    expect(await login(U.icuNurse1.email, DEMO_PASSWORD, minutes(14))).toEqual(
      THROTTLED,
    );
    expect(
      await login(U.icuNurse1.email, DEMO_PASSWORD, minutes(16)),
    ).toMatchObject({ ok: true });
  });

  it("starts counting again once the window has passed", async () => {
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures - 1);
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures - 1, minutes(16));
    expect(
      await login(U.icuNurse1.email, DEMO_PASSWORD, minutes(16)),
    ).toMatchObject({ ok: true });
  });

  it("clears the failures after a successful sign-in", async () => {
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures - 1);
    await login(U.icuNurse1.email, DEMO_PASSWORD);
    await fail(U.icuNurse1.email, LOGIN_THROTTLE.maxFailures - 1);
    expect(await login(U.icuNurse1.email, DEMO_PASSWORD)).toMatchObject({
      ok: true,
    });
  });

  it("counts concurrent failures atomically", async () => {
    await Promise.all(
      Array.from({ length: LOGIN_THROTTLE.maxFailures }, () =>
        login(U.icuNurse1.email, "wrong password"),
      ),
    );
    expect(await login(U.icuNurse1.email, DEMO_PASSWORD)).toEqual(THROTTLED);
  });

  it("stores only a hash of the address, never the address itself", async () => {
    await fail("Someone@Example.invalid", 1);
    const { rows } = await db.execute<{ key_hash: string }>(
      sql`select key_hash from login_throttles`,
    );
    expect(rows).toEqual([
      {
        key_hash: unknownIdentifierThrottleKey({
          kind: "email",
          value: "someone@example.invalid",
        }),
      },
    ]);
    expect(rows[0]!.key_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getActor boundary (actorFromSession)", () => {
  it("loads a Head Nurse's membership from the database", async () => {
    expect(await actorOf(U.icuHead.id)).toEqual({
      userId: U.icuHead.id,
      isActive: true,
      isHospitalAdmin: false,
      memberships: [{ departmentId: DEMO_ICU.id, role: "HEAD_NURSE" }],
      supervisedDepartmentIds: [],
    });
  });

  it("loads supervisor assignments from the database", async () => {
    const actor = await actorOf(U.supervisor.id);
    expect(actor?.memberships).toEqual([]);
    expect([...(actor?.supervisedDepartmentIds ?? [])].sort()).toEqual(
      [DEMO_ICU.id, DEMO_ER.id].sort(),
    );
  });

  it("ignores roles, memberships and status claimed by the session", async () => {
    const forged = sessionFor(U.icuNurse1.id, {
      role: "HEAD_NURSE",
      isActive: true,
      isHospitalAdmin: true,
      memberships: [{ departmentId: DEMO_ER.id, role: "HEAD_NURSE" }],
      supervisedDepartmentIds: [DEMO_ICU.id, DEMO_ER.id],
    });
    expect(await actorFromSession(db, forged, TODAY)).toEqual({
      userId: U.icuNurse1.id,
      isActive: true,
      isHospitalAdmin: false,
      memberships: [{ departmentId: DEMO_ICU.id, role: "NURSE" }],
      supervisedDepartmentIds: [],
    });
  });

  it("uses memberships effective on the day, including future end dates", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-10-15"),
    });
    expect(
      (await actorOf(U.icuNurse1.id, isoDate("2026-10-15")))?.memberships,
    ).toEqual([{ departmentId: DEMO_ICU.id, role: "NURSE" }]);
    expect(
      (await actorOf(U.icuNurse1.id, isoDate("2026-10-16")))?.memberships,
    ).toEqual([]);
    // The transfer nurse: ER through 2026-09-22, ICU from 2026-09-23.
    expect(
      (await actorOf(U.transferNurse.id, isoDate("2026-09-22")))?.memberships,
    ).toEqual([{ departmentId: DEMO_ER.id, role: "NURSE" }]);
    expect(
      (await actorOf(U.transferNurse.id, isoDate("2026-09-23")))?.memberships,
    ).toEqual([{ departmentId: DEMO_ICU.id, role: "NURSE" }]);
  });

  it("sees database changes on the next request with the same session", async () => {
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    await addMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      role: "HEAD_NURSE",
      startedOn: TODAY,
    });
    expect((await actorOf(U.icuNurse1.id))?.memberships).toEqual([
      { departmentId: DEMO_ICU.id, role: "HEAD_NURSE" },
    ]);
  });

  it("rejects a deactivated user", async () => {
    expect(await actorOf(U.inactiveNurse.id)).toBeNull();
  });

  it("rejects a user deactivated after signing in (old cookie still valid)", async () => {
    expect(await actorOf(U.icuNurse1.id)).not.toBeNull();
    await setUserActive(db, U.icuNurse1.id, false);
    expect(await actorOf(U.icuNurse1.id)).toBeNull();
  });

  it.each([
    ["no session", null],
    ["a session without a user", { expires: "x" }],
    ["a malformed user id", { user: { id: "not-a-uuid" } }],
    ["an unknown user", sessionFor("99999999-0000-4000-8000-000000000000")],
  ])("returns null for %s", async (_, session) => {
    expect(await actorFromSession(db, session, TODAY)).toBeNull();
  });
});

describe("shell and page queries", () => {
  const ctx = async (id: string) => ({ db, actor: (await actorOf(id))! });

  it("describes a Head Nurse's departments by name", async () => {
    expect(await getShellContext(await ctx(U.icuHead.id))).toEqual({
      isHospitalAdmin: false,
      user: { displayName: U.icuHead.displayName, email: U.icuHead.email },
      memberships: [
        {
          department: {
            id: DEMO_ICU.id,
            code: DEMO_ICU.code,
            name: DEMO_ICU.name,
          },
          role: "HEAD_NURSE",
        },
      ],
      supervised: [],
      unreadNotifications: 0,
    });
  });

  it("lists supervised departments in code order", async () => {
    const shell = await getShellContext(await ctx(U.supervisor.id));
    expect(shell.supervised.map((d) => d.code)).toEqual(["er", "icu"]);
    expect(shell.memberships).toEqual([]);
  });

  it("opens a Head Nurse's own department", async () => {
    expect(
      await getDepartmentForPage(
        await ctx(U.icuHead.id),
        "icu",
        "department.manage",
      ),
    ).toMatchObject({ id: DEMO_ICU.id, name: DEMO_ICU.name });
  });

  it.each<[string, string, string, "department.manage" | "audit.view"]>([
    [
      "another department's Head Nurse",
      U.erHead.id,
      "icu",
      "department.manage",
    ],
    ["a nurse of the department", U.icuNurse1.id, "icu", "department.manage"],
    ["a nurse viewing history", U.icuNurse1.id, "icu", "audit.view"],
    ["a supervisor managing", U.supervisor.id, "icu", "department.manage"],
    ["anyone, for an unknown code", U.icuHead.id, "nope", "department.manage"],
  ])(
    "answers NotFound (not Forbidden) to %s",
    async (_, userId, code, action) => {
      await expect(
        getDepartmentForPage(await ctx(userId), code, action),
      ).rejects.toBeInstanceOf(NotFoundError);
    },
  );

  it("lets a supervisor open a supervised department's history", async () => {
    expect(
      await getDepartmentForPage(
        await ctx(U.supervisor.id),
        "er",
        "audit.view",
      ),
    ).toMatchObject({ id: DEMO_ER.id });
  });

  it("opens the review page only for supervisors", async () => {
    expect(
      (await getReviewDepartments(await ctx(U.supervisor.id))).map(
        (d) => d.code,
      ),
    ).toEqual(["er", "icu"]);
    await expect(
      getReviewDepartments(await ctx(U.icuHead.id)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("command foundation with the session-built actor", () => {
  const run = (actor: Actor) =>
    openPreferencesForTest(
      { db, actor },
      { scheduleId: DEMO_SCHEDULE.id, expectedRevision: 0 },
    );

  it("lets the department's Head Nurse run a Head Nurse command", async () => {
    expect(await run((await actorOf(U.icuHead.id))!)).toMatchObject({
      ok: true,
    });
  });

  it("forbids a nurse, whatever the session claims", async () => {
    const actor = await actorFromSession(
      db,
      sessionFor(U.icuNurse1.id, { role: "HEAD_NURSE" }),
      TODAY,
    );
    expect(await run(actor!)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "NOT_HEAD_NURSE_OF_DEPARTMENT" },
    });
  });

  it("still denies an inactive actor inside the use case (defense in depth)", async () => {
    const active = (await actorOf(U.icuHead.id))!;
    expect(await run({ ...active, isActive: false })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "ACTOR_INACTIVE" },
    });
  });
});
