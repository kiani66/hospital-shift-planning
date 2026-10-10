import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { previewFullReset } from "../../src/application/reset/preview";
import { executeFullReset } from "../../src/application/reset/execute";
import {
  previewMasterRecovery,
  executeMasterRecovery,
} from "../../src/application/reset/recovery";
import {
  previewPersonnelImport,
  commitPersonnelImport,
} from "../../src/application/personnel-import/import";
import { setUserPersonnelNumber } from "../../src/application/management/personnel-number";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import {
  FULL_OPERATIONAL_CATEGORIES,
  CATEGORY_IDS,
} from "../../src/domain/reset/categories";
import { isoDate } from "../../src/domain/shared/dates";
import {
  users,
  departmentMemberships,
  departments,
  shiftTypes,
  changeReasons,
  staffingRuleSetVersions,
  staffingRuleSetRequirements,
  auditEvents,
  resetOperations,
  schedules,
  LEGACY_BASELINE_VERSION_ID,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_USERS as U,
  DEMO_ICU as D,
  DEMO_ER as ER,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { readResetInventory } from "../../src/infrastructure/repositories/reset-inventory";
import { RECOVERY_REASONS } from "../../src/infrastructure/repositories/master-recovery";
import { setupTestDatabase } from "./support/database";
const { db, pool } = setupTestDatabase();
const ctx = async (id = U.icuHead.id) => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-10")))!,
});
const scoped = {
  scope: { kind: "DEPARTMENTS" as const, departmentIds: [D.id] },
  categories: FULL_OPERATIONAL_CATEGORIES,
};
beforeEach(async () => {
  await db.delete(resetOperations);
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.icuHead.id));
  await db.insert(changeReasons).values(RECOVERY_REASONS).onConflictDoNothing();
});
async function resetAll() {
  const admin = await ctx();
  const preview = await previewFullReset(admin, {
    scope: { kind: "APPLICATION" },
    categories: CATEGORY_IDS,
  });
  expect(preview.plan.blockers).toEqual([]);
  expect(
    await executeFullReset(admin, { ...preview, confirmed: true }),
  ).toMatchObject({ ok: true });
  return admin;
}
async function importPreview(number: string, name: string, email = "") {
  return previewPersonnelImport(await ctx(), {
    departmentId: D.id,
    startedOn: "2026-10-10",
    text: `personnel_number,display_name,email\n${number},${name},${email}\n`,
  });
}
async function commit(p: Awaited<ReturnType<typeof importPreview>>) {
  if (!p.ok) throw new Error(p.fileError);
  return commitPersonnelImport(await ctx(), {
    departmentId: D.id,
    startedOn: p.startedOn,
    expectedFingerprint: p.fingerprint,
    rows: p.plan.rows.map((r) => ({ line: r.line, ...r.person! })),
  });
}
describe("personnel replacement readiness", () => {
  it("lists every surviving identity, including outside scope and inactive accounts, with retained reference reasons", async () => {
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, U.erNurse1.id));
    await db
      .delete(departmentMemberships)
      .where(eq(departmentMemberships.userId, U.erNurse2.id));
    const preview = await previewFullReset(await ctx(), scoped);
    const orphan = preview.preservedUsers.find((u) => u.id === U.erNurse2.id)!;
    expect(orphan.memberships).toEqual([]);
    expect(orphan.importBehavior).toBe("MATCH_AND_REUSE_OR_CONFLICT");
    expect(orphan.reasons.some((r) => r.includes("خارج از دامنه"))).toBe(true);
    const allIds = [...preview.users, ...preview.preservedUsers]
      .map((u) => u.id)
      .sort();
    expect(allIds).toEqual(
      (await db.select().from(users)).map((u) => u.id).sort(),
    );
    const outsider = preview.preservedUsers.find(
      (u) => u.id === U.erNurse1.id,
    )!;
    expect(outsider).toMatchObject({
      label: U.erNurse1.displayName,
      isActive: false,
      personnelNumber: U.erNurse1.personnelNumber,
      importBehavior: "INACTIVE_BLOCKS_IMPORT",
    });
    expect(outsider.reasons.some((r) => r.includes("خارج از دامنه"))).toBe(
      true,
    );
    expect(outsider.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ departmentId: ER.id, retained: true }),
      ]),
    );
    expect(
      preview.preservedUsers.find((u) => u.id === U.icuHead.id)!.reasons,
    ).toContain("مدیر اجراکننده محافظت‌شده");
    expect(
      preview.users.every((u) => u.importBehavior === "NEW_IDENTITY_AVAILABLE"),
    ).toBe(true);
  });
  it("explains master-data references and users retained when personnel is not selected", async () => {
    await db
      .update(staffingRuleSetVersions)
      .set({ createdBy: U.icuNurse1.id })
      .where(eq(staffingRuleSetVersions.id, LEGACY_BASELINE_VERSION_ID));
    const p = await previewFullReset(await ctx(), {
      scope: { kind: "APPLICATION" },
      categories: FULL_OPERATIONAL_CATEGORIES,
    });
    expect(
      p.preservedUsers
        .find((u) => u.id === U.icuNurse1.id)!
        .reasons.some((r) =>
          r.includes("staffing_rule_set_versions.created_by"),
        ),
    ).toBe(true);
    const onlySchedules = await previewFullReset(await ctx(), {
      ...scoped,
      categories: ["schedules"],
    });
    expect(
      onlySchedules.preservedUsers.find((u) => u.id === U.icuNurse1.id)!
        .reasons,
    ).toContain("دسته حساب‌های پرسنل برای حذف انتخاب نشده است");
  });
  it("detects retained personnel-number conflict after reset; explicit correction frees it for a new CSV identity without touching credentials", async () => {
    const old = (
      await db.select().from(users).where(eq(users.id, U.erNurse1.id))
    )[0]!;
    const p = await previewFullReset(await ctx(), scoped);
    expect(
      await executeFullReset(await ctx(), { ...p, confirmed: true }),
    ).toMatchObject({ ok: true });
    const blocked = await importPreview(
      old.personnelNumber!,
      "کارمند واقعی جدید",
    );
    expect(blocked).toMatchObject({ ok: true, plan: { committable: false } });
    if (!blocked.ok) throw new Error("bad preview");
    expect(blocked.plan.rows[0]!.errors).toContain("IDENTITY_CONFLICT");
    expect(blocked.accountIdsByLine[2]).toContain(old.id);
    expect(await commit(blocked)).toMatchObject({ ok: false });
    expect(
      await setUserPersonnelNumber(await ctx(), {
        userId: old.id,
        expectedPersonnelNumber: old.personnelNumber,
        personnelNumber: "98000001",
      }),
    ).toMatchObject({ ok: true });
    const ready = await importPreview(
      old.personnelNumber!,
      "کارمند واقعی جدید",
    );
    expect(ready).toMatchObject({
      ok: true,
      plan: { counts: { CREATE: 1 }, committable: true },
    });
    expect(await commit(ready)).toMatchObject({
      ok: true,
      data: {
        created: [
          expect.objectContaining({ personnelNumber: old.personnelNumber }),
        ],
      },
    });
    const survivor = (
      await db.select().from(users).where(eq(users.id, old.id))
    )[0]!;
    expect(survivor.passwordHash).toBe(old.passwordHash);
    expect(survivor.isActive).toBe(old.isActive);
    expect(survivor.displayName).toBe(old.displayName);
  });
  it("detects reserved email for a new number and links the owner even when outside scope", async () => {
    const p = await previewFullReset(await ctx(), scoped);
    expect(
      await executeFullReset(await ctx(), { ...p, confirmed: true }),
    ).toMatchObject({ ok: true });
    const blocked = await importPreview("98000002", "واقعی", U.erNurse1.email!);
    expect(blocked).toMatchObject({ ok: true, plan: { committable: false } });
    if (!blocked.ok) throw new Error("bad preview");
    expect(blocked.plan.rows[0]!.errors).toContain("EMAIL_TAKEN");
    expect(blocked.accountIdsByLine[2]).toContain(U.erNurse1.id);
  });
  it("uses the same active matching account after reset and never overwrites its password", async () => {
    const before = (
      await db.select().from(users).where(eq(users.id, U.erNurse1.id))
    )[0]!;
    const p = await previewFullReset(await ctx(), scoped);
    expect(
      await executeFullReset(await ctx(), { ...p, confirmed: true }),
    ).toMatchObject({ ok: true });
    const ready = await importPreview(
      before.personnelNumber!,
      before.displayName,
      before.email!,
    );
    expect(ready).toMatchObject({
      ok: true,
      plan: { counts: { ADD_MEMBERSHIP: 1 } },
    });
    expect(await commit(ready)).toMatchObject({
      ok: true,
      data: { created: [], membershipsAdded: 1 },
    });
    expect(
      (await db.select().from(users).where(eq(users.id, before.id)))[0]!
        .passwordHash,
    ).toBe(before.passwordHash);
  });
});
describe("controlled master-data recovery", () => {
  it("previews without writes, restores exact defaults after master deletion, and permits schedule creation following approved department/membership provision", async () => {
    const admin = await resetAll();
    const before = await readResetInventory(db);
    const p = await previewMasterRecovery(admin);
    expect(await readResetInventory(db)).toEqual(before);
    expect(p.plan.counts).toEqual({
      shiftTypes: 5,
      changeReasons: 7,
      staffingRuleSets: 1,
      staffingRuleSetVersions: 1,
      staffingRequirements: 3,
    });
    expect(p.plan.warnings.some((w) => w.includes("هیچ بخش فعال"))).toBe(true);
    expect(
      await executeMasterRecovery(admin, { ...p, confirmed: true }),
    ).toMatchObject({
      ok: true,
      data: { counts: p.plan.counts, changed: true },
    });
    expect(await db.select().from(shiftTypes)).toHaveLength(5);
    expect(await db.select().from(changeReasons)).toHaveLength(7);
    expect(await db.select().from(departments)).toHaveLength(0);
    expect((await db.select().from(staffingRuleSetVersions))[0]).toMatchObject({
      id: LEGACY_BASELINE_VERSION_ID,
      status: "PUBLISHED",
      effectiveFrom: "1900-01-01",
      origin: "MIGRATION",
    });
    expect(
      (await db.select().from(staffingRuleSetRequirements)).every(
        (r) => r.minStaff === 1 && r.maxStaff === null,
      ),
    ).toBe(true);
    // Isolated fixture emulates the documented operator step, using an explicit approved test department.
    await db.insert(departments).values(D);
    await db.insert(departmentMemberships).values({
      userId: U.icuHead.id,
      departmentId: D.id,
      role: "HEAD_NURSE",
      startedOn: "2026-01-01",
    });
    const created = await createSchedule(await ctx(), {
      departmentId: D.id,
      periodStart: "2026-10-23",
      periodEnd: "2026-11-21",
      label: "پس از بازیابی",
    });
    expect(created).toMatchObject({ ok: true });
    expect(await db.select().from(schedules)).toHaveLength(1);
    expect(
      (await db.select().from(auditEvents)).some(
        (a) => a.action === "masterData.defaultsRestored",
      ),
    ).toBe(true);
    expect(
      (await db.select().from(resetOperations)).some(
        (r) => r.result === "COMPLETED",
      ),
    ).toBe(true);
  });
  it("is a successful no-op on fresh repeated previews", async () => {
    const admin = await resetAll();
    expect(
      await executeMasterRecovery(admin, {
        ...(await previewMasterRecovery(admin)),
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
    const before = await readResetInventory(db);
    const p = await previewMasterRecovery(admin);
    expect(
      await executeMasterRecovery(admin, { ...p, confirmed: true }),
    ).toMatchObject({ ok: true, data: { changed: false } });
    expect(await readResetInventory(db)).toEqual(before);
  });
  it("preserves customized shift labels, inactive reasons and existing staffing policies", async () => {
    await db
      .update(shiftTypes)
      .set({ label: "صبح سفارشی" })
      .where(eq(shiftTypes.code, "M"));
    await db
      .update(changeReasons)
      .set({ isActive: false })
      .where(eq(changeReasons.code, "ILLNESS"));
    await db
      .update(staffingRuleSetRequirements)
      .set({ minStaff: 2 })
      .where(
        eq(staffingRuleSetRequirements.versionId, LEGACY_BASELINE_VERSION_ID),
      );
    const before = await readResetInventory(db);
    const p = await previewMasterRecovery(await ctx());
    expect(p.plan.restoreBaseline).toBe(false);
    expect(p.plan.warnings.some((w) => w.includes("غیرفعال"))).toBe(true);
    expect(
      await executeMasterRecovery(await ctx(), { ...p, confirmed: true }),
    ).toMatchObject({ ok: true, data: { changed: false } });
    expect(await readResetInventory(db)).toEqual(before);
    await db
      .update(changeReasons)
      .set({ isActive: true })
      .where(eq(changeReasons.code, "ILLNESS"));
  });
  it("rejects nurses and currently revoked administrators for preview and execution", async () => {
    const p = await previewMasterRecovery(await ctx());
    await expect(
      previewMasterRecovery(await ctx(U.icuNurse1.id)),
    ).rejects.toThrow();
    expect(
      await executeMasterRecovery(await ctx(U.icuNurse1.id), {
        ...p,
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const admin = await ctx();
    await db
      .update(users)
      .set({ isHospitalAdmin: false })
      .where(eq(users.id, U.icuHead.id));
    await expect(previewMasterRecovery(admin)).rejects.toThrow();
    expect(
      await executeMasterRecovery(admin, { ...p, confirmed: true }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
  it("requires explicit confirmation and refuses replaying a Full Reset proof", async () => {
    const p = await previewMasterRecovery(await ctx());
    expect(
      await executeMasterRecovery(await ctx(), { ...p, confirmed: false }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    const full = await previewFullReset(await ctx(), {
      scope: { kind: "APPLICATION" },
      categories: ["changeReasons", "hospitalStaffingRules", "shiftTypes"],
    });
    expect(
      await executeMasterRecovery(await ctx(), { ...full, confirmed: true }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(
      await executeFullReset(await ctx(), { ...full, ...p, confirmed: true }),
    ).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });
  it("rejects stale recovery previews when existing definitions change", async () => {
    const p = await previewMasterRecovery(await ctx());
    await db
      .update(shiftTypes)
      .set({ label: "برچسب تازه" })
      .where(eq(shiftTypes.code, "E"));
    expect(
      await executeMasterRecovery(await ctx(), { ...p, confirmed: true }),
    ).toMatchObject({ ok: false, error: { reason: "RESET_PREVIEW_STALE" } });
  });
  it("refuses inconsistent existing shift semantics without overwriting them", async () => {
    await db
      .update(shiftTypes)
      .set({ covers: ["E"] })
      .where(eq(shiftTypes.code, "M"));
    const p = await previewMasterRecovery(await ctx());
    expect(p.plan.permitted).toBe(false);
    expect(
      await executeMasterRecovery(await ctx(), { ...p, confirmed: true }),
    ).toMatchObject({ ok: false, error: { reason: "RECOVERY_BLOCKED" } });
    expect(
      (await db.select().from(shiftTypes).where(eq(shiftTypes.code, "M")))[0]!
        .covers,
    ).toEqual(["E"]);
    await db
      .update(shiftTypes)
      .set({ covers: ["M"] })
      .where(eq(shiftTypes.code, "M"));
  });
  it("rolls back every inserted default if audit recording fails late", async () => {
    const admin = await resetAll();
    const p = await previewMasterRecovery(admin);
    await db.execute(
      sql`create function test_recovery_fail() returns trigger language plpgsql as $$ begin raise exception 'isolated injected failure'; end $$`,
    );
    await db.execute(
      sql`create trigger test_recovery_fail before insert on audit_events for each row execute function test_recovery_fail()`,
    );
    try {
      expect(
        await executeMasterRecovery(admin, { ...p, confirmed: true }),
      ).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      expect(await db.select().from(shiftTypes)).toHaveLength(0);
      expect(await db.select().from(changeReasons)).toHaveLength(0);
      expect(await db.select().from(staffingRuleSetVersions)).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger test_recovery_fail on audit_events`);
      await db.execute(sql`drop function test_recovery_fail()`);
    }
  });
  it("refuses a concurrent writer and accepts a fresh retry after release", async () => {
    const admin = await resetAll();
    const p = await previewMasterRecovery(admin);
    const writer = await pool.connect();
    try {
      await writer.query("begin");
      await writer.query(
        "insert into shift_types(code,label,covers,is_night,sort_order) values('CUSTOM','آزمایشی',ARRAY[]::text[],false,10)",
      );
      expect(
        await executeMasterRecovery(admin, { ...p, confirmed: true }),
      ).toMatchObject({ ok: false, error: { reason: "RESET_BUSY" } });
      await writer.query("rollback");
    } finally {
      writer.release();
    }
    expect(
      await executeMasterRecovery(admin, {
        ...(await previewMasterRecovery(admin)),
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
  });
  it("two concurrent recovery confirmations insert one complete set only", async () => {
    const admin = await resetAll();
    const p = await previewMasterRecovery(admin);
    const results = await Promise.all([
      executeMasterRecovery(admin, { ...p, confirmed: true }),
      executeMasterRecovery(admin, { ...p, confirmed: true }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(shiftTypes)).toHaveLength(5);
    expect(await db.select().from(staffingRuleSetVersions)).toHaveLength(1);
  });
});
