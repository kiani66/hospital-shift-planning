import {
  previewPersonnelImport,
  commitPersonnelImport,
} from "../../src/application/personnel-import/import";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { previewFullReset } from "../../src/application/reset/preview";
import { executeFullReset } from "../../src/application/reset/execute";
import { FULL_OPERATIONAL_CATEGORIES } from "../../src/domain/reset/categories";
import { isoDate } from "../../src/domain/shared/dates";
import {
  users,
  departments,
  schedules,
  shiftAssignments,
  auditEvents,
  resetOperations,
  scheduleVersions,
  scheduleSubmissions,
  scheduleVersionAssignments,
  legacyShiftChangeRequests,
  departmentMemberships,
  shiftTypes,
  changeReasons,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_USERS as U,
  DEMO_ICU as D,
  DEMO_SCHEDULE as S,
  DEMO_ER as ER,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { setupTestDatabase } from "./support/database";
const { db, pool } = setupTestDatabase();
const as = async (id = U.icuHead.id) => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-10")))!,
});
const selection = {
  scope: { kind: "APPLICATION" },
  categories: FULL_OPERATIONAL_CATEGORIES,
};
beforeEach(async () => {
  await db.delete(resetOperations);
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.icuHead.id));
});
const run = async (p: Awaited<ReturnType<typeof previewFullReset>>) =>
  executeFullReset(await as(), { ...p, confirmed: true });
describe("controlled reset execution", () => {
  it("preserves the last credentialed admin when the executing admin has no password", async () => {
    await db
      .update(users)
      .set({ passwordHash: null })
      .where(eq(users.id, U.icuHead.id));
    await db
      .update(users)
      .set({ isHospitalAdmin: true })
      .where(eq(users.id, U.erHead.id));
    const p = await previewFullReset(await as(), selection);
    expect(p.plan.protectedUserIds).toEqual(
      expect.arrayContaining([U.icuHead.id, U.erHead.id]),
    );
    expect((await run(p)).ok).toBe(true);
    expect((await db.select().from(users)).map((u) => u.id).sort()).toEqual(
      [U.icuHead.id, U.erHead.id].sort(),
    );
  });
  it("blocks a reset when no active credentialed admin exists", async () => {
    await db.update(users).set({ passwordHash: null });
    const p = await previewFullReset(await as(), selection);
    expect(p.plan.blockers).toContain("NO_USABLE_ADMIN");
    expect(await run(p)).toMatchObject({
      ok: false,
      error: { reason: "RESET_DEPENDENCY_BLOCKED" },
    });
    expect(await db.select().from(schedules)).toHaveLength(1);
  });
  it("supports importing new personnel after an operational reset", async () => {
    const p = await previewFullReset(await as(), selection);
    expect((await run(p)).ok).toBe(true);
    const ctx = await as();
    const imported = await previewPersonnelImport(ctx, {
      departmentId: D.id,
      startedOn: "2026-10-10",
      text: "personnel_number,display_name\n88001,پرسنل تازه\n",
    });
    if (!imported.ok) throw new Error(imported.fileError);
    expect(
      await commitPersonnelImport(ctx, {
        departmentId: D.id,
        startedOn: imported.startedOn,
        expectedFingerprint: imported.fingerprint,
        rows: imported.plan.rows.map((r) => ({ line: r.line, ...r.person! })),
      }),
    ).toMatchObject({ ok: true });
    expect(await db.select().from(users)).toHaveLength(2);
  });
  it("refuses unregistered foreign-key dependencies", async () => {
    await db.execute(
      sql`create table phase14_unknown (id uuid primary key, user_id uuid references users(id))`,
    );
    try {
      const p = await previewFullReset(await as(), selection);
      expect(p.plan.permitted).toBe(false);
      expect(await run(p)).toMatchObject({
        ok: false,
        error: { reason: "RESET_DEPENDENCY_BLOCKED" },
      });
      expect(await db.select().from(schedules)).toHaveLength(1);
    } finally {
      await db.execute(sql`drop table phase14_unknown`);
    }
  });
  it("blocks concurrent inserts and serializes reset attempts", async () => {
    const p = await previewFullReset(await as(), selection);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "insert into shift_assignments(schedule_id,user_id,date,shift_code,updated_by) values ($1,$2,'2026-10-24','M',$3)",
        [S.id, U.icuNurse1.id, U.icuHead.id],
      );
      expect(await run(p)).toMatchObject({
        ok: false,
        error: { reason: "RESET_BUSY" },
      });
    } finally {
      await client.query("rollback");
      client.release();
    }
    const a = await previewFullReset(await as(), selection),
      b = await previewFullReset(await as(), selection);
    const result = await Promise.all([run(a), run(b)]);
    expect(result.filter((r) => r.ok)).toHaveLength(1);
    expect(result.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("deletes operational data and preserves admin, departments, reference data and independent record; repeats", async () => {
    const p = await previewFullReset(await as(), selection);
    expect(p.plan.blockers).toEqual([]);
    const result = await run(p);
    expect(result).toMatchObject({ ok: true });
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(schedules)).toHaveLength(0);
    expect(await db.select().from(departments)).toHaveLength(2);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(resetOperations)).toMatchObject([
      { executingAdminId: U.icuHead.id, result: "COMPLETED" },
    ]);
    const next = await previewFullReset(await as(), selection);
    expect((await run(next)).ok).toBe(true);
    expect(await db.select().from(resetOperations)).toHaveLength(2);
  });
  it("requires explicit confirmation and rejects nurse execution", async () => {
    const p = await previewFullReset(await as(), selection);
    expect(await executeFullReset(await as(), p)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(
      await executeFullReset(await as(U.icuNurse1.id), {
        ...p,
        confirmed: true,
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await db.select().from(schedules)).toHaveLength(1);
  });
  it("rejects stale data including insertions", async () => {
    const p = await previewFullReset(await as(), selection);
    await db.insert(shiftAssignments).values({
      scheduleId: S.id,
      userId: U.icuNurse1.id,
      date: "2026-10-24",
      shiftCode: "M",
      updatedBy: U.icuHead.id,
    });
    expect(await run(p)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "RESET_PREVIEW_STALE" },
    });
    expect(await db.select().from(shiftAssignments)).toHaveLength(1);
  });
  it("deletes approved snapshots, cycle, legacy requests and audit references safely", async () => {
    const submission = randomUUID(),
      version = randomUUID();
    await db.insert(scheduleSubmissions).values({
      id: submission,
      scheduleId: S.id,
      submittedBy: U.icuHead.id,
      decision: "APPROVED",
      decidedBy: U.supervisor.id,
      decidedAt: new Date(),
    });
    await db.insert(scheduleVersions).values({
      id: version,
      scheduleId: S.id,
      versionNo: 1,
      submissionId: submission,
      approvedBy: U.supervisor.id,
    });
    await db.insert(scheduleVersionAssignments).values({
      versionId: version,
      userId: U.icuNurse1.id,
      date: "2026-10-24",
      shiftCode: "M",
    });
    await db
      .update(schedules)
      .set({ status: "APPROVED", currentVersionId: version })
      .where(eq(schedules.id, S.id));
    await db.insert(legacyShiftChangeRequests).values({
      scheduleId: S.id,
      requesterId: U.icuNurse1.id,
      reason: "test",
      status: "PENDING",
    });
    await db.insert(auditEvents).values({
      actorId: U.icuHead.id,
      departmentId: D.id,
      scheduleId: S.id,
      action: "test",
      entityType: "schedule",
    });
    const p = await previewFullReset(await as(), selection);
    expect((await run(p)).ok).toBe(true);
    expect(await db.select().from(scheduleVersions)).toHaveLength(0);
    expect(await db.select().from(legacyShiftChangeRequests)).toHaveLength(0);
  });
  it("preserves shared personnel and other departments", async () => {
    await db.insert(departmentMemberships).values({
      userId: U.icuNurse1.id,
      departmentId: ER.id,
      role: "NURSE",
      startedOn: "2026-01-01",
    });
    const otherMemberships = await db
      .select()
      .from(departmentMemberships)
      .where(eq(departmentMemberships.departmentId, ER.id));
    const p = await previewFullReset(await as(), {
      scope: { kind: "DEPARTMENTS", departmentIds: [D.id] },
      categories: FULL_OPERATIONAL_CATEGORIES,
    });
    expect(p.plan.preservedUserIds).toContain(U.icuNurse1.id);
    expect((await run(p)).ok).toBe(true);
    expect(
      (await db.select().from(users)).some((u) => u.id === U.icuNurse1.id),
    ).toBe(true);
    expect(
      await db
        .select()
        .from(departmentMemberships)
        .where(eq(departmentMemberships.departmentId, ER.id)),
    ).toEqual(otherMemberships);
  });
  it("rejects active row lockers without waiting or partial deletion", async () => {
    const p = await previewFullReset(await as(), selection);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from schedules for update");
      expect(await run(p)).toMatchObject({
        ok: false,
        error: { code: "CONFLICT", reason: "RESET_BUSY" },
      });
      expect(await db.select().from(schedules)).toHaveLength(1);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("rolls back all deletions when a late write fails", async () => {
    const originalUsers = await db.select().from(users);
    const p = await previewFullReset(await as(), selection);
    await db.execute(
      sql`create function phase14_fail_record() returns trigger language plpgsql as $$ begin if NEW.result = 'COMPLETED' then raise exception 'injected'; end if; return NEW; end $$`,
    );
    await db.execute(
      sql`create trigger phase14_fail_record before insert on reset_operations for each row execute function phase14_fail_record()`,
    );
    try {
      expect(await run(p)).toMatchObject({
        ok: false,
        error: { code: "INTERNAL" },
      });
      expect(await db.select().from(schedules)).toHaveLength(1);
      expect(await db.select().from(users)).toEqual(originalUsers);
      expect(await db.select().from(resetOperations)).toMatchObject([
        { result: "FAILED" },
      ]);
    } finally {
      await db.execute(
        sql`drop trigger phase14_fail_record on reset_operations`,
      );
      await db.execute(sql`drop function phase14_fail_record()`);
    }
  });
  it("allows zero departments and explicit master deletion", async () => {
    const shiftRows = await db.select().from(shiftTypes);
    const reasonRows = await db.select().from(changeReasons);
    const p = await previewFullReset(await as(), {
      scope: { kind: "APPLICATION" },
      categories: [
        ...FULL_OPERATIONAL_CATEGORIES,
        "departments",
        "shiftTypes",
        "changeReasons",
        "departmentStaffingRules",
        "hospitalStaffingRules",
      ],
    });
    expect(p.plan.blockers).toEqual([]);
    expect((await run(p)).ok).toBe(true);
    expect(await db.select().from(departments)).toHaveLength(0);
    expect((await previewFullReset(await as(), selection)).plan.permitted).toBe(
      true,
    );
    await db.insert(shiftTypes).values(shiftRows);
    await db.insert(changeReasons).values(reasonRows);
  });
});
