import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  commitScheduleImport,
  previewScheduleImport,
  type ScheduleImportPreview,
} from "../../src/application/schedule-import/import";
import {
  commitPersonnelImport,
  previewPersonnelImport,
} from "../../src/application/personnel-import/import";
import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import { getScheduleReview } from "../../src/application/schedules/review";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import { setAssignments } from "../../src/application/schedules/edit-assignments";
import { validateWorkingCopy } from "../../src/application/schedules/working-copy-validation";
import {
  getCoverageCandidates,
  assignCoverageCandidate,
} from "../../src/application/schedules/coverage-candidates";
import { getMyShiftsMonth } from "../../src/application/my-shifts/queries";
import { resetMonthlyPlanning } from "../../src/application/schedules/reset-planning";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import {
  auditEvents,
  departmentMemberships,
  schedules,
  shiftAssignments,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  addMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { createUser } from "../../src/infrastructure/repositories/users";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const NOW = new Date("2026-10-03T08:00:00Z");
const target = {
  departmentId: DEMO_ER.id,
  periodStart: isoDate("2026-03-21"),
  periodEnd: isoDate("2026-04-20"),
  label: "فروردین ۱۴۰۵",
};
const as = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, isoDate("2026-10-03")))!,
  clock: () => NOW,
});
let head: AppContext;
let secretary: Awaited<ReturnType<typeof createUser>>;
let preview: ScheduleImportPreview;
async function file(
  modify?: (s: ExcelJS.Worksheet) => void,
  onlySecretary = false,
) {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("برنامه ماهانه");
  s.addRow([
    "شماره پرسنلی",
    "نام و نام خانوادگی",
    ...Array.from({ length: 31 }, (_, i) => i + 1),
  ]);
  if (!onlySecretary)
    s.addRow([
      U.erHead.personnelNumber,
      U.erHead.displayName,
      "N",
      "M",
      "H",
      "ME",
    ]);
  s.addRow([
    secretary.personnelNumber,
    secretary.displayName,
    "M",
    "E",
    "N",
    "ME",
    "H",
  ]);
  modify?.(s);
  return new Uint8Array(await w.xlsx.writeBuffer());
}
async function read(bytes?: Uint8Array, ctx = head) {
  return previewScheduleImport(ctx, target, bytes ?? (await file()));
}
const scheduleRows = () =>
  db.select().from(schedules).where(eq(schedules.departmentId, DEMO_ER.id));
const assignments = (id: string) =>
  db.select().from(shiftAssignments).where(eq(shiftAssignments.scheduleId, id));
function success<T>(
  result: { ok: true; data: T } | { ok: false; error: unknown },
): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
beforeEach(async () => {
  head = await as(U.erHead.id);
  secretary = await createUser(db, {
    personnelNumber: "009900",
    displayName: "منشی نمونه",
    passwordHash: null,
  });
  await addMembership(db, {
    userId: secretary.id,
    departmentId: DEMO_ER.id,
    role: "SECRETARY",
    startedOn: isoDate("2026-01-01"),
  });
});

describe("atomic monthly schedule import", () => {
  it("creates a historical DRAFT, full eligible roster and explicit OFF with an import audit", async () => {
    preview = await read();
    expect(preview).toMatchObject({
      committable: true,
      createsSchedule: true,
      assignments: 62,
      personnel: { headNurses: 1, secretaries: 1 },
      counts: { H: 2 },
    });
    expect(preview.violations.some((v) => v.rule === "NIGHT_REST")).toBe(true);
    const result = success(await commitScheduleImport(head, preview.payload));
    expect(result).toMatchObject({
      status: "DRAFT",
      assignments: 62,
      revision: 1,
    });
    expect(await findScheduleById(db, result.scheduleId)).toMatchObject({
      period: { start: "2026-03-21", end: "2026-04-20" },
      currentVersionId: null,
    });
    expect(await listRoster(db, result.scheduleId)).toContainEqual({
      userId: secretary.id,
      displayName: secretary.displayName,
      role: "SECRETARY",
    });
    expect(
      (await assignments(result.scheduleId)).filter(
        (a) => a.shiftCode === "OFF",
      ),
    ).toHaveLength(53);
    expect(
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "schedule.imported")),
    ).toMatchObject([
      {
        actorId: U.erHead.id,
        departmentId: DEMO_ER.id,
        data: { assignments: 62, personnel: { clericalStaff: 1 } },
      },
    ]);
  });
  it("allows existing empty planning schedules and preserves status, preferences and pin", async () => {
    const created = success(await createSchedule(head, target));
    await db
      .update(schedules)
      .set({ status: "PLANNING" })
      .where(eq(schedules.id, created.scheduleId));
    preview = await read();
    expect(preview.createsSchedule).toBe(false);
    const result = success(await commitScheduleImport(head, preview.payload));
    expect(result.scheduleId).toBe(created.scheduleId);
    expect(result.status).toBe("PLANNING");
    expect(await scheduleRows()).toHaveLength(1);
  });
  it("refuses occupied schedules, repeated imports and immutable workflow states", async () => {
    const imported = success(
      await commitScheduleImport(head, (await read()).payload),
    );
    expect(
      await commitScheduleImport(head, (await read()).payload),
    ).toMatchObject({ ok: false });
    expect(
      await commitScheduleImport(head, (await read()).payload),
    ).toMatchObject({ ok: false });
    for (const status of [
      "APPROVED",
      "SUBMITTED",
      "FINALIZED",
      "REVISING",
      "RETURNED",
    ] as const) {
      await db
        .update(schedules)
        .set({ status })
        .where(eq(schedules.id, imported.scheduleId));
      const p = await read();
      expect(p.committable).toBe(false);
      expect(await commitScheduleImport(head, p.payload)).toMatchObject({
        ok: false,
      });
    }
    expect(await assignments(imported.scheduleId)).toHaveLength(62);
  });
  it.each([
    "unknown",
    "inactive",
    "name",
    "department",
    "dates",
    "duplicate",
    "invalid code",
  ])("blocks %s rows without account or membership writes", async (kind) => {
    if (kind === "inactive")
      await db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, secretary.id));
    if (kind === "department")
      await db
        .update(departmentMemberships)
        .set({ departmentId: DEMO_ICU.id })
        .where(eq(departmentMemberships.userId, secretary.id));
    if (kind === "dates")
      await db
        .update(departmentMemberships)
        .set({ startedOn: "2026-04-01" })
        .where(eq(departmentMemberships.userId, secretary.id));
    const p = await read(
      await file((s) => {
        if (kind === "unknown") s.getCell("A3").value = "123999";
        if (kind === "name") s.getCell("B3").value = "نام نادرست";
        if (kind === "duplicate")
          s.addRow([secretary.personnelNumber, secretary.displayName]);
        if (kind === "invalid code") s.getCell("C3").value = "MN";
      }),
    );
    expect(p.committable).toBe(false);
    expect(await commitScheduleImport(head, p.payload)).toMatchObject({
      ok: false,
    });
    expect(await scheduleRows()).toEqual([]);
  });
  it("rejects stale preview after ordinary editing and after personnel changes", async () => {
    const created = success(await createSchedule(head, target));
    preview = await read();
    success(
      await setAssignments(head, {
        scheduleId: created.scheduleId,
        expectedRevision: 0,
        changes: [
          { nurseId: secretary.id, date: target.periodStart, shift: "H" },
        ],
      }),
    );
    expect(await commitScheduleImport(head, preview.payload)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await assignments(created.scheduleId)).toHaveLength(1);
  });
  it("binds proofs to actor, period, cells, expiry and explicit confirmation", async () => {
    preview = await read();
    for (const payload of [
      { ...preview.payload, confirm: false },
      { ...preview.payload, periodStart: "2026-03-22" },
      {
        ...preview.payload,
        rows: preview.payload.rows.map((r) => ({
          ...r,
          days: r.days.map(() => "M"),
        })),
      },
      {
        ...preview.payload,
        proof: { ...preview.payload.proof, signature: "0".repeat(64) },
      },
    ])
      expect(await commitScheduleImport(head, payload)).toMatchObject({
        ok: false,
      });
    expect(
      await commitScheduleImport(
        { ...head, clock: () => new Date(NOW.getTime() + 16 * 60 * 1000) },
        preview.payload,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await commitScheduleImport(await as(secretary.id), preview.payload),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await scheduleRows()).toEqual([]);
  });
  it("serializes concurrent imports and prevents duplicates", async () => {
    preview = await read();
    const results = await Promise.all([
      commitScheduleImport(head, preview.payload),
      commitScheduleImport(head, preview.payload),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await scheduleRows()).toHaveLength(1);
    expect(await assignments((await scheduleRows())[0]!.id)).toHaveLength(62);
  });
  it("rolls back schedule, roster, assignments and audits when persistence fails", async () => {
    preview = await read();
    // An isolated database trigger fails the second person's assignment batch.
    await db.execute(
      sql`create function hsp_import_fail() returns trigger language plpgsql as $$ begin if (select count(*) from shift_assignments where schedule_id = NEW.schedule_id) >= 31 then raise exception 'injected assignment failure'; end if; return NEW; end $$`,
    );
    await db.execute(
      sql`create trigger hsp_import_fail before insert on shift_assignments for each row execute function hsp_import_fail()`,
    );
    try {
      expect(await commitScheduleImport(head, preview.payload)).toMatchObject({
        ok: false,
      });
      expect(await scheduleRows()).toEqual([]);
      expect(
        await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.action, "schedule.imported")),
      ).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger hsp_import_fail on shift_assignments`);
      await db.execute(sql`drop function hsp_import_fail()`);
    }
  });
  it("invalidates membership changes, preserves historical dates and leaves missing roster rows undecided", async () => {
    preview = await read();
    await db
      .update(departmentMemberships)
      .set({ endedOn: "2026-03-25" })
      .where(eq(departmentMemberships.userId, secretary.id));
    expect(await commitScheduleImport(head, preview.payload)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(await scheduleRows()).toEqual([]);
  });
});

describe("secretary integration boundaries", () => {
  it("shows a secretary's personal finalized calendar and workload under existing publication rules", async () => {
    const imported = success(
      await commitScheduleImport(head, (await read()).payload),
    );
    const period = { start: target.periodStart, end: target.periodEnd };
    const ctx = await as(secretary.id);
    const hidden = await getMyShiftsMonth(ctx, {
      period,
      today: isoDate("2026-10-03"),
    });
    expect(hidden.totals).toMatchObject({
      shiftCount: 4,
      includesUnapproved: true,
    });
    expect(hidden.days[1]!.entries.map((e) => e.shift)).toEqual(["E"]);
    // Fixture-only status change tests the visibility query; approval workflow is tested separately.
    await db
      .update(schedules)
      .set({ status: "FINALIZED" })
      .where(eq(schedules.id, imported.scheduleId));
    const visible = await getMyShiftsMonth(ctx, {
      period,
      today: isoDate("2026-10-03"),
    });
    expect(visible.totals).toMatchObject({
      shiftCount: 4,
      offCount: 26,
      leaveCount: 1,
      nightCount: 1,
    });
    expect(visible.totals.minutes).toBeGreaterThan(0);
  });

  it("uses the authorized CSV workflow to create SECRETARY membership", async () => {
    await bootstrapHospitalAdmin(
      db,
      { email: U.erHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
      NOW,
    );
    const admin = await as(U.erHead.id);
    const p = await previewPersonnelImport(admin, {
      departmentId: DEMO_ER.id,
      startedOn: "2026-10-03",
      text: "شماره پرسنلی,نام و نام خانوادگی,نقش\n009901,منشی دیگر,منشی",
    });
    if (!p.ok) throw new Error(p.fileError);
    success(
      await commitPersonnelImport(admin, {
        departmentId: DEMO_ER.id,
        startedOn: p.startedOn,
        expectedFingerprint: p.fingerprint,
        rows: p.plan.rows.map((r) => ({ line: r.line, ...r.person! })),
      }),
    );
    expect(
      await db
        .select()
        .from(departmentMemberships)
        .where(eq(departmentMemberships.role, "SECRETARY")),
    ).toHaveLength(2);
  });
  it("keeps secretary unassigned until Head Nurse decides; excludes coverage/candidates and supports reset", async () => {
    const created = success(await createSchedule(head, target));
    expect(await assignments(created.scheduleId)).toEqual([]);
    let revision = 0;
    for (const shift of ["M", "E", "N", "ME", "OFF", "H"] as const) {
      revision = success(
        await setAssignments(head, {
          scheduleId: created.scheduleId,
          expectedRevision: revision,
          changes: [{ nurseId: secretary.id, date: target.periodStart, shift }],
        }),
      ).revision;
    }
    success(
      await setAssignments(head, {
        scheduleId: created.scheduleId,
        expectedRevision: revision,
        changes: [
          { nurseId: secretary.id, date: target.periodStart, shift: "M" },
        ],
      }),
    );
    const review = await getScheduleReview(head, {
      departmentId: DEMO_ER.id,
      scheduleId: created.scheduleId,
      day: target.periodStart,
    });
    expect(
      review.day!.roster.find((r) => r.userId === secretary.id)!.role,
    ).toBe("SECRETARY");
    expect(review.day!.coverage.find((b) => b.period === "M")!.covered).toBe(0);
    const candidates = await getCoverageCandidates(head, {
      scheduleId: created.scheduleId,
      date: target.periodEnd,
      shift: "M",
    });
    if (candidates.status !== "SHORTAGE") throw new Error("Expected shortage");
    expect(
      [...candidates.available, ...candidates.notAllowed].some(
        (c) => c.userId === secretary.id,
      ),
    ).toBe(false);
    const schedule = (await findScheduleById(db, created.scheduleId))!;
    expect(
      await assignCoverageCandidate(head, {
        scheduleId: schedule.id,
        expectedRevision: schedule.revision,
        date: target.periodEnd,
        shift: "M",
        nurseId: secretary.id,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await setAssignments(await as(secretary.id), {
        scheduleId: schedule.id,
        expectedRevision: schedule.revision,
        changes: [
          { nurseId: U.erHead.id, date: target.periodStart, shift: "H" },
        ],
      }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await validateWorkingCopy(db, schedule)).violations).toContainEqual(
      expect.objectContaining({ rule: "STAFFING", covered: 0 }),
    );
    success(
      await resetMonthlyPlanning(head, {
        scheduleId: schedule.id,
        expectedRevision: schedule.revision,
      }),
    );
    expect(await assignments(schedule.id)).toEqual([]);
    expect(await listRoster(db, schedule.id)).toContainEqual(
      expect.objectContaining({ userId: secretary.id, role: "SECRETARY" }),
    );
  });
});
