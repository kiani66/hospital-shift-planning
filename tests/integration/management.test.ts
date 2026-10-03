import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAccount,
  setAccountActive,
  setHospitalAdmin,
  updateAccountProfile,
} from "../../src/application/management/accounts";
import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import {
  addDepartmentMembership,
  endDepartmentMembership,
  transitionDepartmentMembership,
} from "../../src/application/management/memberships";
import {
  getDepartmentPersonnel,
  getUserAccessHistory,
  listHospitalUsers,
} from "../../src/application/management/queries";
import {
  assignDepartmentSupervisor,
  endDepartmentSupervisor,
} from "../../src/application/management/supervisors";
import { createChangeRequest } from "../../src/application/change-requests/commands";
import {
  getChangeRequestOptions,
  getChangeRequestReview,
} from "../../src/application/change-requests/queries";
import type { ActionResult } from "../../src/application/result";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { adjustSchedule } from "../../src/application/schedules/schedule-changes";
import type { AppContext } from "../../src/application/use-case";
import { decide } from "../../src/domain/authz/policies";
import { isoDate } from "../../src/domain/shared/dates";
import { actorFromSession } from "../../src/infrastructure/auth/actor";
import { authenticateWithPassword } from "../../src/infrastructure/auth/credentials";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  auditEvents,
  departmentMemberships,
  schedules,
} from "../../src/infrastructure/db/schema";
import * as audit from "../../src/infrastructure/repositories/audit";
import {
  setAssignment,
  listAssignments,
} from "../../src/infrastructure/repositories/assignments";
import {
  countHospitalAdmins,
  findMembership,
  findSupervisorRelation,
  lockActiveSchedulingUsers,
} from "../../src/infrastructure/repositories/management";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  addToRoster,
  listRoster,
  listSchedulingRoster,
} from "../../src/infrastructure/repositories/roster";
import { createSubmission } from "../../src/infrastructure/repositories/submissions";
import { findUserById } from "../../src/infrastructure/repositories/users";
import {
  createVersionFromWorkingCopy,
  listVersionAssignments,
} from "../../src/infrastructure/repositories/versions";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const NOW = new Date("2026-10-03T08:00:00Z");
const TODAY = isoDate("2026-10-03");
const PASSWORD = "phase10-test-password";
let admin: AppContext;
const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, TODAY))!,
  clock: () => NOW,
});
function data<T>(result: ActionResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
const code = (result: ActionResult<unknown>, expected: string) =>
  expect(result).toMatchObject({ ok: false, error: { code: expected } });
const newAccount = async (name = "new") =>
  data(
    await createAccount(admin, {
      email: `${name}@phase10.invalid`,
      displayName: name,
      password: PASSWORD,
    }),
  );
const member = async (userId: string, extra: Record<string, unknown> = {}) =>
  data(
    await addDepartmentMembership(admin, {
      userId,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: "2026-01-01",
      ...extra,
    }),
  );
const events = () => db.select().from(auditEvents);

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    NOW,
  );
  admin = await as(U.icuHead.id);
});

describe("Hospital Admin boundary and last-admin safety", () => {
  it("loads system authority from the database, never the session", async () => {
    const forged = await actorFromSession(
      db,
      {
        user: { id: U.icuNurse1.id, isHospitalAdmin: true },
        isHospitalAdmin: true,
      },
      TODAY,
    );
    expect(forged?.isHospitalAdmin).toBe(false);
    expect(
      (await actorFromSession(db, { user: { id: U.icuHead.id } }, TODAY))
        ?.isHospitalAdmin,
    ).toBe(true);
  });
  it.each([U.erHead.id, U.supervisor.id, U.icuNurse1.id])(
    "denies administrative writes for department actor %s",
    async (id) => {
      const ctx = await as(id);
      const attempts = [
        createAccount(ctx, {
          email: "denied@phase10.invalid",
          displayName: "denied",
          password: PASSWORD,
        }),
        setAccountActive(ctx, { userId: U.icuNurse1.id, isActive: false }),
        setHospitalAdmin(ctx, { userId: id, isHospitalAdmin: true }),
        updateAccountProfile(ctx, {
          userId: id,
          email: "denied@phase10.invalid",
          displayName: "denied",
          expectedEmail: "old",
          expectedDisplayName: "old",
        }),
        addDepartmentMembership(ctx, {
          userId: id,
          departmentId: DEMO_ER.id,
          role: "HEAD_NURSE",
          startedOn: "2026-01-01",
        }),
        endDepartmentMembership(ctx, {
          relationId: randomUUID(),
          expectedEndedOn: null,
          endedOn: TODAY,
        }),
        transitionDepartmentMembership(ctx, {
          relationId: randomUUID(),
          expectedEndedOn: null,
          departmentId: DEMO_ER.id,
          role: "HEAD_NURSE",
          startedOn: TODAY,
          endedOn: null,
        }),
        assignDepartmentSupervisor(ctx, {
          userId: id,
          departmentId: DEMO_ER.id,
          startedOn: TODAY,
        }),
        endDepartmentSupervisor(ctx, {
          relationId: randomUUID(),
          expectedEndedOn: null,
          endedOn: TODAY,
        }),
      ];
      for (const result of await Promise.all(attempts))
        code(result, "FORBIDDEN");
      expect((await events()).map((e) => e.action)).toEqual([
        "user.hospitalAdminBootstrapped",
      ]);
    },
  );
  it("denies an inactive Hospital Admin", async () => {
    code(
      await createAccount(
        { ...admin, actor: { ...admin.actor, isActive: false } },
        { email: "x@phase10.invalid", displayName: "x", password: PASSWORD },
      ),
      "FORBIDDEN",
    );
  });
  it("rechecks stale or fabricated authority against the database", async () => {
    const forged = {
      ...(await as(U.icuNurse1.id)),
      actor: { ...(await as(U.icuNurse1.id)).actor, isHospitalAdmin: true },
    };
    code(
      await setAccountActive(forged, {
        userId: U.erNurse1.id,
        isActive: false,
      }),
      "FORBIDDEN",
    );
    expect((await findUserById(db, U.erNurse1.id))?.isActive).toBe(true);
  });
  it.each(["deactivate", "strip"])(
    "refuses to %s the last active admin",
    async (operation) => {
      code(
        await (operation === "deactivate"
          ? setAccountActive(admin, {
              userId: admin.actor.userId,
              isActive: false,
            })
          : setHospitalAdmin(admin, {
              userId: admin.actor.userId,
              isHospitalAdmin: false,
            })),
        "VALIDATION",
      );
      expect(await countHospitalAdmins(db)).toBe(1);
      expect(await events()).toHaveLength(1);
    },
  );
  it("does not count inactive admins as replacements", async () => {
    const other = await newAccount("other");
    data(
      await setHospitalAdmin(admin, {
        userId: other.id,
        isHospitalAdmin: true,
      }),
    );
    data(await setAccountActive(admin, { userId: other.id, isActive: false }));
    code(
      await setAccountActive(admin, {
        userId: admin.actor.userId,
        isActive: false,
      }),
      "VALIDATION",
    );
  });
  it.each(["deactivate", "strip"])(
    "serializes concurrent self-%s attempts",
    async (operation) => {
      const other = await newAccount("other");
      data(
        await setHospitalAdmin(admin, {
          userId: other.id,
          isHospitalAdmin: true,
        }),
      );
      const second = await as(other.id);
      const results = await Promise.all(
        [admin, second].map((ctx) =>
          operation === "deactivate"
            ? setAccountActive(ctx, {
                userId: ctx.actor.userId,
                isActive: false,
              })
            : setHospitalAdmin(ctx, {
                userId: ctx.actor.userId,
                isHospitalAdmin: false,
              }),
        ),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      code(
        results.find((r) => !r.ok)!,
        "VALIDATION",
      );
      expect(await countHospitalAdmins(db)).toBe(1);
    },
  );
  it("a concurrent admin revocation invalidates the waiting caller", async () => {
    const other = await newAccount("other");
    data(
      await setHospitalAdmin(admin, {
        userId: other.id,
        isHospitalAdmin: true,
      }),
    );
    const second = await as(other.id);
    const results = await Promise.all([
      setHospitalAdmin(admin, { userId: other.id, isHospitalAdmin: false }),
      setHospitalAdmin(second, {
        userId: admin.actor.userId,
        isHospitalAdmin: false,
      }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    code(
      results.find((r) => !r.ok)!,
      "FORBIDDEN",
    );
    expect(await countHospitalAdmins(db)).toBe(1);
  });

  it("mixed concurrent deactivation and authority removal also retain an active admin", async () => {
    const other = await newAccount("other");
    data(
      await setHospitalAdmin(admin, {
        userId: other.id,
        isHospitalAdmin: true,
      }),
    );
    const second = await as(other.id);
    const results = await Promise.all([
      setAccountActive(admin, { userId: admin.actor.userId, isActive: false }),
      setHospitalAdmin(second, { userId: other.id, isHospitalAdmin: false }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    code(
      results.find((r) => !r.ok)!,
      "VALIDATION",
    );
    expect(await countHospitalAdmins(db)).toBe(1);
  });
  it("denies a previously loaded admin after database deactivation", async () => {
    const other = await newAccount("other");
    data(
      await setHospitalAdmin(admin, {
        userId: other.id,
        isHospitalAdmin: true,
      }),
    );
    const stale = await as(other.id);
    data(await setAccountActive(admin, { userId: other.id, isActive: false }));
    code(
      await setAccountActive(stale, { userId: U.erNurse1.id, isActive: false }),
      "FORBIDDEN",
    );
  });

  it("authority changes are visible with the same cookie", async () => {
    const other = await newAccount("other");
    const session = { user: { id: other.id } };
    data(
      await setHospitalAdmin(admin, {
        userId: other.id,
        isHospitalAdmin: true,
      }),
    );
    expect((await actorFromSession(db, session, TODAY))?.isHospitalAdmin).toBe(
      true,
    );
    data(
      await setHospitalAdmin(admin, {
        userId: other.id,
        isHospitalAdmin: false,
      }),
    );
    expect((await actorFromSession(db, session, TODAY))?.isHospitalAdmin).toBe(
      false,
    );
  });
});

describe("account lifecycle and identity reads", () => {
  it("creates a normalized password account without accidental authority", async () => {
    const account = data(
      await createAccount(admin, {
        email: " NEW@phase10.invalid ",
        displayName: " New ",
        password: PASSWORD,
        isHospitalAdmin: true,
      }),
    );
    expect(account).toMatchObject({
      email: "new@phase10.invalid",
      displayName: "New",
      isHospitalAdmin: false,
    });
    expect(account).not.toHaveProperty("passwordHash");
    expect(
      await authenticateWithPassword(
        db,
        { email: account.email, password: PASSWORD },
        NOW,
      ),
    ).toEqual({ ok: true, userId: account.id });
    expect((await events()).at(-1)).toMatchObject({
      action: "user.created",
      actorId: admin.actor.userId,
    });
  });
  it("rejects duplicate emails differing only in case without partial audit", async () => {
    await newAccount();
    const before = await events();
    code(
      await createAccount(admin, {
        email: "NEW@phase10.invalid",
        displayName: "other",
        password: PASSWORD,
      }),
      "CONFLICT",
    );
    expect(await events()).toEqual(before);
  });
  it.each([
    { email: "invalid", displayName: "x", password: PASSWORD },
    { email: "x@phase10.invalid", displayName: " ", password: PASSWORD },
    { email: "x@phase10.invalid", displayName: "x", password: "short" },
    { email: "x@phase10.invalid", displayName: "x", password: "x".repeat(257) },
  ])("rejects invalid account input %#", async (input) => {
    code(await createAccount(admin, input), "VALIDATION");
    expect(await events()).toHaveLength(1);
  });
  it("deactivation prevents login and old-cookie access; reactivation restores effective memberships", async () => {
    const account = await newAccount();
    await member(account.id);
    const session = { user: { id: account.id } };
    const history = await getUserAccessHistory(admin, account.id);
    data(
      await setAccountActive(admin, { userId: account.id, isActive: false }),
    );
    expect(await actorFromSession(db, session, TODAY)).toBeNull();
    expect(
      await authenticateWithPassword(
        db,
        { email: account.email, password: PASSWORD },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(await getUserAccessHistory(admin, account.id)).toEqual(history);
    data(await setAccountActive(admin, { userId: account.id, isActive: true }));
    expect((await actorFromSession(db, session, TODAY))?.memberships).toEqual([
      { departmentId: DEMO_ICU.id, role: "NURSE" },
    ]);
    expect((await events()).slice(-2).map((e) => e.action)).toEqual([
      "user.deactivated",
      "user.activated",
    ]);
  });
  it("activation and authority operations are idempotent and unknown ids are not found", async () => {
    const before = await events();
    data(
      await setAccountActive(admin, {
        userId: admin.actor.userId,
        isActive: true,
      }),
    );
    data(
      await setHospitalAdmin(admin, {
        userId: admin.actor.userId,
        isHospitalAdmin: true,
      }),
    );
    expect(await events()).toEqual(before);
    code(
      await setAccountActive(admin, { userId: randomUUID(), isActive: false }),
      "NOT_FOUND",
    );
    code(
      await setHospitalAdmin(admin, {
        userId: randomUUID(),
        isHospitalAdmin: true,
      }),
      "NOT_FOUND",
    );
  });
  it("updates only approved identity fields with stale-form protection", async () => {
    const account = await newAccount();
    const input = {
      userId: account.id,
      email: "updated@phase10.invalid",
      displayName: "Updated",
      expectedEmail: account.email,
      expectedDisplayName: account.displayName,
      isHospitalAdmin: true,
      password: "ignored",
    };
    expect(data(await updateAccountProfile(admin, input))).toMatchObject({
      email: input.email,
      displayName: input.displayName,
      isHospitalAdmin: false,
    });
    code(await updateAccountProfile(admin, input), "CONFLICT");
    expect(
      await authenticateWithPassword(
        db,
        { email: input.email, password: PASSWORD },
        NOW,
      ),
    ).toEqual({ ok: true, userId: account.id });
    expect((await events()).at(-1)?.action).toBe("user.profileChanged");
  });
  it("identity conflicts roll back and unchanged profiles do not add events", async () => {
    const account = await newAccount();
    const base = {
      userId: account.id,
      displayName: account.displayName,
      expectedEmail: account.email,
      expectedDisplayName: account.displayName,
    };
    data(await updateAccountProfile(admin, { ...base, email: account.email }));
    const before = await events();
    code(
      await updateAccountProfile(admin, { ...base, email: U.erHead.email }),
      "CONFLICT",
    );
    expect(await findUserById(db, account.id)).toEqual(account);
    expect(await events()).toEqual(before);
  });
  it("offers bounded literal search without credentials", async () => {
    const account = await newAccount();
    expect(
      await listHospitalUsers(admin, { search: "NEW@", limit: 1 }),
    ).toEqual([account]);
    expect(await listHospitalUsers(admin, { search: "%" })).toEqual([]);
    const matches = await listHospitalUsers(admin);
    expect(matches.every((r) => !("passwordHash" in r))).toBe(true);
    await expect(
      listHospitalUsers(await as(U.erHead.id)),
    ).rejects.toMatchObject({ reason: "NOT_HOSPITAL_ADMIN" });
    await expect(
      getUserAccessHistory(await as(U.erHead.id), U.icuHead.id),
    ).rejects.toMatchObject({ reason: "NOT_HOSPITAL_ADMIN" });
    await expect(
      getUserAccessHistory(admin, randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("head nurses and supervisors see only relevant department personnel", async () => {
    const head = await as(U.erHead.id);
    const rows = await getDepartmentPersonnel(head, DEMO_ER.id);
    expect(rows.some((r) => r.userId === U.erNurse1.id)).toBe(true);
    expect(
      rows.every((r) => !("email" in r) && !("isHospitalAdmin" in r)),
    ).toBe(true);
    await expect(
      getDepartmentPersonnel(head, DEMO_ICU.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await getDepartmentPersonnel(await as(U.supervisor.id), DEMO_ICU.id),
    ).not.toHaveLength(0);
    await expect(
      getDepartmentPersonnel(await as(U.icuNurse1.id), DEMO_ICU.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getDepartmentPersonnel(admin, DEMO_ER.id)).not.toHaveLength(0);
  });
});

describe("membership lifecycle", () => {
  it.each([
    ["2020-01-01", "2020-12-31"],
    ["2026-10-03", null],
    ["2027-01-01", null],
    ["2027-01-01", "2027-02-01"],
  ])(
    "adds historical/current/future/fixed-term membership %s",
    async (startedOn, endedOn) => {
      const account = await newAccount();
      const relation = await member(account.id, {
        startedOn,
        endedOn,
        role: "HEAD_NURSE",
      });
      expect(await findMembership(db, relation.id)).toMatchObject(relation);
      expect((await events()).at(-1)).toMatchObject({
        action: "membership.added",
        departmentId: DEMO_ICU.id,
      });
    },
  );
  it("rejects invalid or overlapping dates", async () => {
    const account = await newAccount();
    code(
      await addDepartmentMembership(admin, {
        userId: account.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: "2026-02-30",
      }),
      "VALIDATION",
    );
    code(
      await addDepartmentMembership(admin, {
        userId: account.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: "2026-01-02",
        endedOn: "2026-01-01",
      }),
      "VALIDATION",
    );
    await member(account.id);
    const before = await events();
    code(
      await addDepartmentMembership(admin, {
        userId: account.id,
        departmentId: DEMO_ICU.id,
        role: "HEAD_NURSE",
        startedOn: TODAY,
      }),
      "CONFLICT",
    );
    expect(await events()).toEqual(before);
  });
  it("keeps account status separate while rejecting inactive/unknown departments", async () => {
    const account = await newAccount();
    data(
      await setAccountActive(admin, { userId: account.id, isActive: false }),
    );
    const relation = data(
      await addDepartmentMembership(admin, {
        userId: account.id,
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: TODAY,
      }),
    );
    data(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
    );
    expect((await findUserById(db, account.id))?.isActive).toBe(false);
    code(
      await addDepartmentMembership(admin, {
        userId: U.erNurse1.id,
        departmentId: randomUUID(),
        role: "NURSE",
        startedOn: TODAY,
      }),
      "NOT_FOUND",
    );
    await db.execute(
      sql`update departments set is_active = false where id = ${DEMO_ER.id}`,
    );
    code(
      await addDepartmentMembership(admin, {
        userId: U.icuNurse1.id,
        departmentId: DEMO_ER.id,
        role: "NURSE",
        startedOn: TODAY,
      }),
      "NOT_FOUND",
    );
  });
  it("ends a current membership inclusively with stale-end protection", async () => {
    const account = await newAccount();
    const relation = await member(account.id);
    data(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
    );
    expect((await loadActor(db, account.id, TODAY))?.memberships).toHaveLength(
      1,
    );
    expect(
      (await loadActor(db, account.id, isoDate("2026-10-04")))?.memberships,
    ).toHaveLength(0);
    code(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        endedOn: "2026-10-04",
      }),
      "CONFLICT",
    );
    data(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: TODAY,
        endedOn: TODAY,
      }),
    );
    expect((await events()).at(-1)?.action).toBe("membership.ended");
  });
  it("shortens fixed terms while denying historical correction and future-row edits", async () => {
    const account = await newAccount();
    const relation = await member(account.id, { endedOn: "2026-12-31" });
    data(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: "2026-12-31",
        endedOn: TODAY,
      }),
    );
    const future = await member(account.id, { startedOn: "2027-01-01" });
    code(
      await endDepartmentMembership(admin, {
        relationId: future.id,
        expectedEndedOn: null,
        endedOn: "2027-02-01",
      }),
      "VALIDATION",
    );
    code(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: TODAY,
        endedOn: "2026-10-02",
      }),
      "VALIDATION",
    );
    code(
      await endDepartmentMembership(admin, {
        relationId: randomUUID(),
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
      "NOT_FOUND",
    );
  });
  it.each(["role", "transfer"])(
    "performs an atomic %s transition without overwriting the source",
    async (kind) => {
      const account = await newAccount();
      const relation = await member(account.id);
      const destination = kind === "role" ? DEMO_ICU.id : DEMO_ER.id;
      const output = data(
        await transitionDepartmentMembership(admin, {
          relationId: relation.id,
          expectedEndedOn: null,
          departmentId: destination,
          role: "HEAD_NURSE",
          startedOn: TODAY,
          endedOn: null,
        }),
      );
      expect(await findMembership(db, relation.id)).toEqual({
        ...relation,
        endedOn: "2026-10-02",
      });
      expect(output.successor).toMatchObject({
        userId: account.id,
        departmentId: destination,
        role: "HEAD_NURSE",
        startedOn: TODAY,
      });
      expect(
        (await loadActor(db, account.id, isoDate("2026-10-02")))?.memberships,
      ).toEqual([{ departmentId: DEMO_ICU.id, role: "NURSE" }]);
      expect((await loadActor(db, account.id, TODAY))?.memberships).toEqual([
        { departmentId: destination, role: "HEAD_NURSE" },
      ]);
      expect((await events()).at(-1)?.action).toBe(
        kind === "role" ? "membership.roleChanged" : "membership.transferred",
      );
    },
  );
  it("supports a future transition with an explicit successor term", async () => {
    const account = await newAccount();
    const relation = await member(account.id, { endedOn: "2026-12-31" });
    const output = data(
      await transitionDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: "2026-12-31",
        departmentId: DEMO_ICU.id,
        role: "HEAD_NURSE",
        startedOn: "2026-11-01",
        endedOn: "2026-12-31",
      }),
    );
    expect(output.predecessor.endedOn).toBe("2026-10-31");
    expect(output.successor.endedOn).toBe("2026-12-31");
    expect((await loadActor(db, account.id, TODAY))?.memberships[0]?.role).toBe(
      "NURSE",
    );
  });
  it("rolls back the predecessor change when the destination overlaps", async () => {
    const account = await newAccount();
    const relation = await member(account.id);
    await member(account.id, { departmentId: DEMO_ER.id });
    const before = await events();
    code(
      await transitionDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        departmentId: DEMO_ER.id,
        role: "NURSE",
        startedOn: TODAY,
        endedOn: null,
      }),
      "CONFLICT",
    );
    expect(await findMembership(db, relation.id)).toEqual(relation);
    expect(await events()).toEqual(before);
  });
  it("rejects stale, missing, unchanged and backdated transitions", async () => {
    const account = await newAccount();
    const relation = await member(account.id);
    const base = {
      relationId: relation.id,
      expectedEndedOn: null,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: TODAY,
      endedOn: null,
    };
    code(
      await transitionDepartmentMembership(admin, {
        ...base,
        expectedEndedOn: TODAY,
      }),
      "CONFLICT",
    );
    code(
      await transitionDepartmentMembership(admin, {
        ...base,
        relationId: randomUUID(),
      }),
      "NOT_FOUND",
    );
    code(
      await transitionDepartmentMembership(admin, {
        ...base,
        departmentId: DEMO_ICU.id,
      }),
      "VALIDATION",
    );
    code(
      await transitionDepartmentMembership(admin, {
        ...base,
        startedOn: "2026-10-02",
      }),
      "VALIDATION",
    );
  });
});

describe("supervisor lifecycle", () => {
  it("creates and ends a separate relation without granting membership", async () => {
    const account = await newAccount();
    const relation = data(
      await assignDepartmentSupervisor(admin, {
        userId: account.id,
        departmentId: DEMO_ER.id,
        startedOn: "2026-01-01",
      }),
    );
    expect(await loadActor(db, account.id, TODAY)).toMatchObject({
      memberships: [],
      supervisedDepartmentIds: [DEMO_ER.id],
    });
    data(
      await endDepartmentSupervisor(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
    );
    expect(
      (await loadActor(db, account.id, isoDate("2026-10-04")))
        ?.supervisedDepartmentIds,
    ).toEqual([]);
    expect(await findSupervisorRelation(db, relation.id)).toEqual({
      ...relation,
      endedOn: TODAY,
    });
    expect((await events()).slice(-2).map((e) => e.action)).toEqual([
      "supervisor.assigned",
      "supervisor.ended",
    ]);
  });
  it("respects overlaps, fixed-term boundaries, and stale-end checks", async () => {
    const account = await newAccount();
    const relation = data(
      await assignDepartmentSupervisor(admin, {
        userId: account.id,
        departmentId: DEMO_ER.id,
        startedOn: "2026-01-01",
        endedOn: "2026-12-31",
      }),
    );
    code(
      await assignDepartmentSupervisor(admin, {
        userId: account.id,
        departmentId: DEMO_ER.id,
        startedOn: TODAY,
      }),
      "CONFLICT",
    );
    code(
      await endDepartmentSupervisor(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
      "CONFLICT",
    );
    code(
      await endDepartmentSupervisor(admin, {
        relationId: randomUUID(),
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
      "NOT_FOUND",
    );
    code(
      await endDepartmentSupervisor(admin, {
        relationId: relation.id,
        expectedEndedOn: "2026-12-31",
        endedOn: "2027-01-01",
      }),
      "VALIDATION",
    );
    data(
      await endDepartmentSupervisor(admin, {
        relationId: relation.id,
        expectedEndedOn: "2026-12-31",
        endedOn: TODAY,
      }),
    );
    const before = await events();
    data(
      await endDepartmentSupervisor(admin, {
        relationId: relation.id,
        expectedEndedOn: TODAY,
        endedOn: TODAY,
      }),
    );
    expect(await events()).toEqual(before);
    data(
      await assignDepartmentSupervisor(admin, {
        userId: account.id,
        departmentId: DEMO_ER.id,
        startedOn: "2026-10-04",
      }),
    );
  });
  it("rejects invalid supervisor dates and does not infer exactly-one supervisors", async () => {
    code(
      await assignDepartmentSupervisor(admin, {
        userId: U.erHead.id,
        departmentId: DEMO_ER.id,
        startedOn: TODAY,
        endedOn: "2026-10-02",
      }),
      "VALIDATION",
    );
    data(
      await assignDepartmentSupervisor(admin, {
        userId: U.erHead.id,
        departmentId: DEMO_ER.id,
        startedOn: TODAY,
      }),
    );
    expect(
      (await loadActor(db, U.supervisor.id, TODAY))?.supervisedDepartmentIds,
    ).toContain(DEMO_ER.id);
  });
});

describe("history, scheduling eligibility, and audit atomicity", () => {
  it("excludes inactive users from new snapshots without rewriting an old roster", async () => {
    const before = await listRoster(db, DEMO_SCHEDULE.id);
    data(
      await setAccountActive(admin, {
        userId: U.icuNurse1.id,
        isActive: false,
      }),
    );
    const created = data(
      await createSchedule(admin, {
        departmentId: DEMO_ICU.id,
        periodStart: "2027-01-01",
        periodEnd: "2027-01-31",
        label: "Phase 10",
      }),
    );
    expect(
      (await listRoster(db, created.scheduleId)).map((r) => r.userId),
    ).not.toContain(U.icuNurse1.id);
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(before);
    expect(
      (await listSchedulingRoster(db, DEMO_SCHEDULE.id)).map((r) => r.userId),
    ).not.toContain(U.icuNurse1.id);
    await expect(
      addToRoster(db, {
        scheduleId: created.scheduleId,
        userId: U.icuNurse1.id,
        role: "NURSE",
        addedBy: admin.actor.userId,
      }),
    ).rejects.toThrow("Inactive");
  });
  it("refuses new/reassigned shifts to inactive rostered users while permitting clearing", async () => {
    const created = data(
      await createSchedule(admin, {
        departmentId: DEMO_ICU.id,
        periodStart: "2027-01-01",
        periodEnd: "2027-01-31",
        label: "Phase 10",
      }),
    );
    const cell = { nurseId: U.icuNurse1.id, date: "2027-01-01", shift: "M" };
    data(
      await setAssignments(admin, {
        scheduleId: created.scheduleId,
        expectedRevision: 0,
        changes: [cell],
      }),
    );
    data(
      await setAccountActive(admin, {
        userId: U.icuNurse1.id,
        isActive: false,
      }),
    );
    // Stored state is preserved and repeating it is a no-op.
    data(
      await setAssignments(admin, {
        scheduleId: created.scheduleId,
        expectedRevision: 1,
        changes: [cell],
      }),
    );
    code(
      await setAssignments(admin, {
        scheduleId: created.scheduleId,
        expectedRevision: 1,
        changes: [{ ...cell, shift: "E" }],
      }),
      "VALIDATION",
    );
    code(
      await setAssignments(admin, {
        scheduleId: created.scheduleId,
        expectedRevision: 1,
        changes: [{ ...cell, date: "2027-01-02" }],
      }),
      "VALIDATION",
    );
    data(
      await setAssignments(admin, {
        scheduleId: created.scheduleId,
        expectedRevision: 1,
        changes: [{ ...cell, shift: null }],
      }),
    );
    expect(await listAssignments(db, created.scheduleId)).toEqual([]);
  });
  it("post-finalization adjustments also reject new assignments to inactive users", async () => {
    await db
      .update(schedules)
      .set({ status: "FINALIZED" })
      .where(eq(schedules.id, DEMO_SCHEDULE.id));
    data(
      await setAccountActive(admin, {
        userId: U.icuNurse1.id,
        isActive: false,
      }),
    );
    code(
      await adjustSchedule(admin, {
        scheduleId: DEMO_SCHEDULE.id,
        expectedRevision: 0,
        reasonCode: "OTHER",
        note: "Operational change",
        changes: [
          {
            nurseId: U.icuNurse1.id,
            date: DEMO_SCHEDULE.periodStart,
            shift: "M",
          },
        ],
      }),
      "VALIDATION",
    );
  });
  it("membership transfer preserves rosters, assignments, and approved versions", async () => {
    await setAssignment(db, {
      scheduleId: DEMO_SCHEDULE.id,
      userId: U.icuNurse1.id,
      date: isoDate(DEMO_SCHEDULE.periodStart),
      shift: "M",
      updatedBy: admin.actor.userId,
    });
    const submission = await createSubmission(db, {
      scheduleId: DEMO_SCHEDULE.id,
      submittedBy: admin.actor.userId,
    });
    const version = await createVersionFromWorkingCopy(db, {
      scheduleId: DEMO_SCHEDULE.id,
      submissionId: submission.id,
      approvedBy: U.supervisor.id,
    });
    const roster = await listRoster(db, DEMO_SCHEDULE.id);
    const assignments = await listAssignments(db, DEMO_SCHEDULE.id);
    const approved = await listVersionAssignments(db, version.id);
    const [relation] = await db
      .select()
      .from(departmentMemberships)
      .where(eq(departmentMemberships.userId, U.icuNurse1.id));
    data(
      await transitionDepartmentMembership(admin, {
        relationId: relation!.id,
        expectedEndedOn: null,
        departmentId: DEMO_ER.id,
        role: "NURSE",
        startedOn: TODAY,
        endedOn: null,
      }),
    );
    data(
      await setAccountActive(admin, {
        userId: U.icuNurse1.id,
        isActive: false,
      }),
    );
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(roster);
    expect(await listAssignments(db, DEMO_SCHEDULE.id)).toEqual(assignments);
    expect(await listVersionAssignments(db, version.id)).toEqual(approved);
  });
  it("former members keep only approved own-history permissions", async () => {
    const account = await newAccount();
    const relation = await member(account.id);
    data(
      await endDepartmentMembership(admin, {
        relationId: relation.id,
        expectedEndedOn: null,
        endedOn: TODAY,
      }),
    );
    const actor = (await loadActor(db, account.id, isoDate("2026-10-04")))!;
    expect(
      decide(actor, "schedule.viewOwn", {
        departmentId: DEMO_ICU.id,
        onRoster: true,
      }).allowed,
    ).toBe(true);
    expect(
      decide(actor, "changeRequest.view", {
        departmentId: DEMO_ICU.id,
        requesterId: account.id,
      }).allowed,
    ).toBe(true);
    expect(
      decide(actor, "preference.editOwn", { departmentId: DEMO_ICU.id })
        .allowed,
    ).toBe(false);
    expect(
      decide(actor, "changeRequest.cancel", {
        departmentId: DEMO_ICU.id,
        requesterId: account.id,
      }).allowed,
    ).toBe(false);
    expect(
      decide(actor, "personnel.view", { departmentId: DEMO_ICU.id }).allowed,
    ).toBe(false);
  });

  it("removes inactive nurses from swap/replacement candidates and rejects forged selections", async () => {
    await db
      .update(schedules)
      .set({ status: "FINALIZED" })
      .where(eq(schedules.id, DEMO_SCHEDULE.id));
    await setAssignment(db, {
      scheduleId: DEMO_SCHEDULE.id,
      userId: U.icuNurse1.id,
      date: isoDate(DEMO_SCHEDULE.periodStart),
      shift: "M",
      updatedBy: admin.actor.userId,
    });
    const nurse = await as(U.icuNurse1.id);
    const request = data(
      await createChangeRequest(nurse, {
        scheduleId: DEMO_SCHEDULE.id,
        type: "UNAVAILABLE",
        date: DEMO_SCHEDULE.periodStart,
        reasonCode: "ILLNESS",
      }),
    );
    data(
      await setAccountActive(admin, {
        userId: U.icuNurse2.id,
        isActive: false,
      }),
    );
    const options = await getChangeRequestOptions(nurse);
    expect(
      JSON.stringify(options.schedules.map((s) => s.swapCandidates)),
    ).not.toContain(U.icuNurse2.id);
    const review = await getChangeRequestReview(admin, {
      departmentId: DEMO_ICU.id,
      requestId: request.id,
    });
    expect(review.replacementCandidates.map((r) => r.userId)).not.toContain(
      U.icuNurse2.id,
    );
    const forged = await getChangeRequestReview(admin, {
      departmentId: DEMO_ICU.id,
      requestId: request.id,
      resolution: { replacementNurseId: U.icuNurse2.id },
    });
    expect(
      forged.preview && !forged.preview.ok
        ? forged.preview.error
        : forged.blocker,
    ).toMatchObject({ code: "VALIDATION" });
    await setAssignment(db, {
      scheduleId: DEMO_SCHEDULE.id,
      userId: U.icuNurse1.id,
      date: isoDate("2026-10-24"),
      shift: "M",
      updatedBy: admin.actor.userId,
    });
    code(
      await createChangeRequest(nurse, {
        scheduleId: DEMO_SCHEDULE.id,
        type: "SWAP",
        date: "2026-10-24",
        counterpartId: U.icuNurse2.id,
        reasonCode: "PERSONAL_MATTER",
      }),
      "VALIDATION",
    );
  });
  it("account deactivation waits for a scheduling eligibility transaction", async () => {
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scheduling = db.transaction(async (tx) => {
      expect(await lockActiveSchedulingUsers(tx, [U.icuNurse1.id])).toBe(true);
      locked();
      await hold;
    });
    await ready;
    let completed = false;
    const deactivation = setAccountActive(admin, {
      userId: U.icuNurse1.id,
      isActive: false,
    }).then((result) => {
      completed = true;
      return result;
    });
    try {
      // Wait for PostgreSQL's actual lock waiter, not an arbitrary timing assumption.
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const result = await db.execute<{
          waiting: boolean;
        }>(sql`select exists (
          select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'
        ) as waiting`);
        if (result.rows[0]!.waiting) {
          waiting = true;
          break;
        }
      }
      expect(waiting).toBe(true);
      expect(completed).toBe(false);
    } finally {
      release();
    }
    await scheduling;
    data(await deactivation);
    await db.transaction(async (tx) => {
      expect(await lockActiveSchedulingUsers(tx, [U.icuNurse1.id])).toBe(false);
    });
  });

  it("rolls back business writes when the audit writer fails", async () => {
    const account = await newAccount();
    const before = await events();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(audit, "recordAuditEvent").mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    code(
      await setAccountActive(admin, { userId: account.id, isActive: false }),
      "INTERNAL",
    );
    expect((await findUserById(db, account.id))?.isActive).toBe(true);
    expect(await events()).toEqual(before);
  });
  it("never audits credentials and a failure after an audit insert rolls everything back", async () => {
    const original = audit.recordAuditEvent;
    const before = await events();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(audit, "recordAuditEvent").mockImplementationOnce(
      async (tx, event) => {
        await original(tx, event);
        throw new Error("failure after audit insert");
      },
    );
    code(
      await createAccount(admin, {
        email: "rollback@phase10.invalid",
        displayName: "rollback",
        password: PASSWORD,
      }),
      "INTERNAL",
    );
    expect(await listHospitalUsers(admin, { search: "rollback@" })).toEqual([]);
    expect(await events()).toEqual(before);
    await newAccount();
    const serialized = JSON.stringify(await events());
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toMatch(/password|hash|token|secret/i);
  });
});
