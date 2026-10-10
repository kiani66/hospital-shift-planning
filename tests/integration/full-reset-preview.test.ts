import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  previewFullReset,
  verifyResetProof,
} from "../../src/application/reset/preview";
import { FULL_OPERATIONAL_CATEGORIES } from "../../src/domain/reset/categories";
import { isoDate } from "../../src/domain/shared/dates";
import {
  users,
  auditEvents,
  shiftAssignments,
  schedules,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_USERS as U,
  DEMO_ICU as D,
  DEMO_ER as ER,
  DEMO_SCHEDULE as S,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { setupTestDatabase } from "./support/database";
const { db } = setupTestDatabase();
const as = async (id = U.icuHead.id) => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-10")))!,
});
const selection = {
  scope: { kind: "DEPARTMENTS", departmentIds: [D.id] },
  categories: FULL_OPERATIONAL_CATEGORIES,
};
beforeEach(async () => {
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.icuHead.id));
});
describe("read-only reset preview", () => {
  it("uses actual counts and writes nothing", async () => {
    const before = await db.select().from(auditEvents);
    const p = await previewFullReset(await as(), selection);
    expect(p.plan.blockers).toEqual([]);
    expect(p.plan.permitted).toBe(true);
    expect(p.plan.tables.find((t) => t.table === "schedules")).toMatchObject({
      remove: 1,
      total: 1,
    });
    expect(p.plan.deleteKeys.users).not.toContain(
      JSON.stringify([U.icuHead.id]),
    );
    expect(await db.select().from(auditEvents)).toEqual(before);
    expect(p.proof).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(p)).not.toContain("password_hash");
  });
  it("rejects nurse or revoked admin", async () => {
    await expect(
      previewFullReset(await as(U.icuNurse1.id), selection),
    ).rejects.toThrow();
    const ctx = await as();
    await db
      .update(users)
      .set({ isHospitalAdmin: false })
      .where(eq(users.id, U.icuHead.id));
    await expect(previewFullReset(ctx, selection)).rejects.toThrow();
  });
  it("fingerprint changes when cells change with the same count", async () => {
    await db.insert(shiftAssignments).values({
      scheduleId: S.id,
      userId: U.icuNurse1.id,
      date: "2026-10-24",
      shiftCode: "M",
      updatedBy: U.icuHead.id,
    });
    const a = await previewFullReset(await as(), selection);
    await db.update(shiftAssignments).set({ shiftCode: "E" });
    const b = await previewFullReset(await as(), selection);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
  it("binds proof to actor, scope, categories and expiry", async () => {
    const p = await previewFullReset(await as(), selection);
    expect(() =>
      verifyResetProof(U.icuHead.id, p.selection, p, p.issuedAt),
    ).not.toThrow();
    expect(() =>
      verifyResetProof(U.icuNurse1.id, p.selection, p, p.issuedAt),
    ).toThrow();
    expect(() =>
      verifyResetProof(
        U.icuHead.id,
        { ...p.selection, categories: ["shiftTypes"] },
        p,
        p.issuedAt,
      ),
    ).toThrow();
    expect(() =>
      verifyResetProof(
        U.icuHead.id,
        p.selection,
        p,
        p.issuedAt + 16 * 60 * 1000,
      ),
    ).toThrow();
  });
  it("blocks global master deletion with out-of-scope references", async () => {
    await db.insert(schedules).values({
      departmentId: ER.id,
      periodStart: "2026-10-23",
      periodEnd: "2026-11-21",
      label: "ER",
      createdBy: U.erHead.id,
    });
    const p = await previewFullReset(await as(), {
      scope: { kind: "DEPARTMENTS", departmentIds: [D.id] },
      categories: ["hospitalStaffingRules"],
    });
    expect(p.plan.permitted).toBe(false);
    expect(
      p.plan.blockers.some((b) => b.startsWith("CROSS_SCOPE_DEPENDENCY")),
    ).toBe(true);
  });
});
