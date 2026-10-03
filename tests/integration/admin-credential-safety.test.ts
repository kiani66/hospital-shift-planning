import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  setAccountActive,
  setHospitalAdmin,
} from "../../src/application/management/accounts";
import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import { hashPassword } from "../../src/infrastructure/auth/password";
import { auditEvents, users } from "../../src/infrastructure/db/schema";
import { DEMO_USERS as U } from "../../src/infrastructure/db/seed/demo-data";
import {
  countHospitalAdmins,
  countUsableHospitalAdmins,
  hasAccountCredentials,
  listUserAccessHistory,
} from "../../src/infrastructure/repositories/management";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  findUserById,
  setUserCredentials,
} from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const today = isoDate("2026-10-03");
const now = new Date("2026-10-03T08:00:00Z");
const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, today))!,
  clock: () => now,
});
const events = () => db.select().from(auditEvents);
let admin: AppContext;

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    now,
  );
  admin = await as(U.icuHead.id);
});

// Legacy/operator state is arranged directly, never through the management commands being tested.
async function legacy(adminFlag: boolean, active = true) {
  await db
    .update(users)
    .set({ passwordHash: null, isHospitalAdmin: adminFlag, isActive: active })
    .where(eq(users.id, U.icuNurse1.id));
  return U.icuNurse1.id;
}
const remove = (ctx: AppContext, id: string, operation: string) =>
  operation === "demote"
    ? setHospitalAdmin(ctx, { userId: id, isHospitalAdmin: false })
    : setAccountActive(ctx, { userId: id, isActive: false });
function denied(
  result: Awaited<ReturnType<typeof setHospitalAdmin>>,
  reason: string,
) {
  expect(result).toMatchObject({
    ok: false,
    error: { code: "VALIDATION", reason },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /password_hash|token|secret|argon2/,
  );
}

describe("credential-provisioned Hospital Admin safety", () => {
  it("rejects the reproduced passwordless grant and subsequent sole-admin self-demotion without business/audit changes", async () => {
    const id = await legacy(false);
    const before = await events();
    const history = await listUserAccessHistory(db, id);
    denied(
      await setHospitalAdmin(admin, { userId: id, isHospitalAdmin: true }),
      "ADMIN_GRANT_REQUIRES_CREDENTIALS",
    );
    denied(
      await remove(admin, admin.actor.userId, "demote"),
      "LAST_ACTIVE_ADMIN",
    );
    expect(await findUserById(db, id)).toMatchObject({
      isActive: true,
      isHospitalAdmin: false,
    });
    expect(await hasAccountCredentials(db, id)).toBe(false);
    expect(await countUsableHospitalAdmins(db)).toBe(1);
    expect(await events()).toEqual(before);
    expect(await listUserAccessHistory(db, id)).toEqual(history);
  });

  it("rejects grants to inactive credentialed accounts without automatic activation", async () => {
    denied(
      await setHospitalAdmin(admin, {
        userId: U.inactiveNurse.id,
        isHospitalAdmin: true,
      }),
      "ADMIN_GRANT_REQUIRES_ACTIVE_ACCOUNT",
    );
    expect(await findUserById(db, U.inactiveNurse.id)).toMatchObject({
      isActive: false,
      isHospitalAdmin: false,
    });
    expect(await events()).toHaveLength(1);
  });

  it("refuses passwordless stored-admin activation until explicit credential provisioning", async () => {
    const id = await legacy(true, false);
    const history = await listUserAccessHistory(db, id);
    denied(
      await setAccountActive(admin, { userId: id, isActive: true }),
      "ADMIN_ACTIVATION_REQUIRES_CREDENTIALS",
    );
    expect(await findUserById(db, id)).toMatchObject({
      isActive: false,
      isHospitalAdmin: true,
    });
    expect(await events()).toHaveLength(1);
    await setUserCredentials(db, id, {
      passwordHash: await hashPassword("explicit-operator-test-password"),
      isActive: false,
    });
    const result = await setAccountActive(admin, {
      userId: id,
      isActive: true,
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/password|hash|token|argon2/);
    expect(await countUsableHospitalAdmins(db)).toBe(2);
    expect(await listUserAccessHistory(db, id)).toEqual(history);
    expect((await events()).at(-1)).toMatchObject({
      action: "user.activated",
      data: { before: false, after: true },
    });
  });

  it.each(["demote", "deactivate"])(
    "a passwordless active admin cannot replace the sole usable admin during self-%s",
    async (operation) => {
      await legacy(true);
      const before = await events();
      expect(await countHospitalAdmins(db)).toBe(2);
      expect(await countUsableHospitalAdmins(db)).toBe(1);
      denied(
        await remove(admin, admin.actor.userId, operation),
        "LAST_ACTIVE_ADMIN",
      );
      expect(await findUserById(db, admin.actor.userId)).toMatchObject({
        isActive: true,
        isHospitalAdmin: true,
      });
      expect(await events()).toEqual(before);
    },
  );

  it.each(["demote", "deactivate"])(
    "also protects the sole usable target from another stored legacy admin's %s",
    async (operation) => {
      const id = await legacy(true);
      const before = await events();
      denied(
        await remove(await as(id), admin.actor.userId, operation),
        "LAST_ACTIVE_ADMIN",
      );
      expect(await countUsableHospitalAdmins(db)).toBe(1);
      expect(await events()).toEqual(before);
    },
  );

  it.each(["demote", "deactivate"])(
    "permits cleanup of a passwordless legacy admin by %s without losing usable authority",
    async (operation) => {
      const id = await legacy(true);
      expect((await remove(admin, id, operation)).ok).toBe(true);
      expect(await countUsableHospitalAdmins(db)).toBe(1);
      expect(await events()).toHaveLength(2);
    },
  );

  it.each(["demote", "deactivate", "mixed"])(
    "serializes two usable admins' concurrent %s despite a passwordless flagged replacement",
    async (operation) => {
      await legacy(true);
      expect(
        (
          await setHospitalAdmin(admin, {
            userId: U.erHead.id,
            isHospitalAdmin: true,
          })
        ).ok,
      ).toBe(true);
      const other = await as(U.erHead.id);
      const before = await events();
      const results = await Promise.all([
        remove(
          admin,
          admin.actor.userId,
          operation === "mixed" ? "demote" : operation,
        ),
        remove(
          other,
          other.actor.userId,
          operation === "mixed" ? "deactivate" : operation,
        ),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      denied(
        results.find((r) => !r.ok)!,
        "LAST_ACTIVE_ADMIN",
      );
      expect(await countUsableHospitalAdmins(db)).toBe(1);
      expect(await events()).toHaveLength(before.length + 1);
    },
  );

  it("concurrent passwordless grant and sole usable self-demotion both fail without partial audit", async () => {
    const id = await legacy(false);
    const before = await events();
    const [grant, demote] = await Promise.all([
      setHospitalAdmin(admin, { userId: id, isHospitalAdmin: true }),
      remove(admin, admin.actor.userId, "demote"),
    ]);
    denied(grant, "ADMIN_GRANT_REQUIRES_CREDENTIALS");
    denied(demote, "LAST_ACTIVE_ADMIN");
    expect(await countUsableHospitalAdmins(db)).toBe(1);
    expect(await events()).toEqual(before);
  });

  it("concurrent passwordless stored-admin activation and sole usable deactivation both fail", async () => {
    const id = await legacy(true, false);
    const before = await events();
    const [activate, deactivate] = await Promise.all([
      setAccountActive(admin, { userId: id, isActive: true }),
      remove(admin, admin.actor.userId, "deactivate"),
    ]);
    denied(activate, "ADMIN_ACTIVATION_REQUIRES_CREDENTIALS");
    denied(deactivate, "LAST_ACTIVE_ADMIN");
    expect(await countUsableHospitalAdmins(db)).toBe(1);
    expect(await findUserById(db, id)).toMatchObject({
      isActive: false,
      isHospitalAdmin: true,
    });
    expect(await events()).toEqual(before);
  });
});
