import { createHash } from "node:crypto";

import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  exportScheduleToExcel,
  getExcelExportAvailability,
} from "../../src/application/excel-export/export";
import {
  getExcelTemplateFile,
  getExcelTemplateSettings,
  listExcelTemplateOverview,
  previewExcelTemplate,
  updateExcelTemplateMapping,
  uploadExcelTemplate,
} from "../../src/application/excel-export/templates";
import { NotFoundError } from "../../src/application/errors";
import { jalaliExportCalendar as calendar } from "../../src/features/excel-export/calendar";
import { executeFullReset } from "../../src/application/reset/execute";
import { previewFullReset } from "../../src/application/reset/preview";
import { FULL_OPERATIONAL_CATEGORIES } from "../../src/domain/reset/categories";
import { readResetInventory } from "../../src/infrastructure/repositories/reset-inventory";
import type { ActionResult } from "../../src/application/result";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import {
  approveSchedule,
  finalizeSchedule,
  submitSchedule,
} from "../../src/application/schedules/lifecycle";
import {
  closePreferenceWindow,
  openPreferenceWindow,
} from "../../src/application/schedules/preference-windows";
import { adjustSchedule } from "../../src/application/schedules/schedule-changes";
import type { AppContext } from "../../src/application/use-case";
import type { Actor } from "../../src/domain/authz/actor";
import { ValidationError } from "../../src/domain/shared/errors";
import { addDays, isoDate } from "../../src/domain/shared/dates";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import { jalaliMonthPeriod } from "../../src/features/calendar/jalali";
import {
  auditEvents,
  departmentExcelTemplates,
  departments,
  resetOperations,
  scheduleVersionAssignments,
  schedules,
  shiftAssignments,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { setAssignment } from "../../src/infrastructure/repositories/assignments";
import {
  addMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { createUser } from "../../src/infrastructure/repositories/users";
import { completeScheduleFixture } from "../support/complete-schedule";
import {
  readWorkbook,
  syntheticTemplate,
  type TemplatePersonRow,
} from "../support/excel-templates";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");
const S = DEMO_SCHEDULE.id;
const SHEET = "برنامه ماهانه";

const as = (actor: Actor): AppContext => ({ db, actor, clock: () => NOW });
const load = async (id: string) => (await loadActor(db, id, TODAY))!;
let head: AppContext;
let erHead: AppContext;
let admin: AppContext;
let secretaryId: string;

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(
      `${result.error.code} ${result.error.reason ?? ""}: ${result.error.message}`,
    );
  return result.data;
}

/** ICU people in an arbitrary row order, with blank rows between them. */
const ICU_ROWS: TemplatePersonRow[] = [
  { row: 7, number: U.icuNurse3.personnelNumber, name: "پرستار ۳" },
  { row: 8, number: U.icuHead.personnelNumber, name: "سرپرستار" },
  { row: 11, number: U.icuNurse1.personnelNumber, name: "پرستار ۱" },
  { row: 12, number: "7700", name: "منشی", numeric: true },
  { row: 13, number: U.icuNurse2.personnelNumber, name: "پرستار ۲" },
  { row: 14, number: U.icuNurse4.personnelNumber, name: "پرستار ۴" },
  { row: 15, number: U.transferNurse.personnelNumber, name: "پرستار انتقالی" },
  { row: 16, number: "9999", name: "فرد بدون برنامه" },
];
const MAPPING = {
  sheetName: SHEET,
  personnelColumn: "B",
  firstRow: 7,
  lastRow: 17,
  firstDayColumn: "F",
};

const upload = async (
  ctx: AppContext,
  content: Uint8Array,
  options: {
    departmentId?: string;
    expectedTemplateId?: string | null;
    fileName?: string;
    mapping?: typeof MAPPING;
  } = {},
) =>
  uploadExcelTemplate(ctx, {
    departmentId: options.departmentId ?? DEMO_ICU.id,
    expectedTemplateId: options.expectedTemplateId ?? null,
    fileName: options.fileName ?? "nicu-template.xlsx",
    content,
    mapping: options.mapping ?? MAPPING,
  });

const icuTemplate = (rows = ICU_ROWS) => syntheticTemplate({ people: rows });

const assign = (
  userId: string,
  date: string,
  shift: AssignmentCode,
  scheduleId = S,
) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });

async function exported(
  ctx: AppContext,
  input: Omit<Parameters<typeof exportScheduleToExcel>[1], "calendar">,
) {
  const result = await exportScheduleToExcel(ctx, { ...input, calendar });
  const sheet = (await readWorkbook(result.bytes)).getWorksheet(SHEET)!;
  const row = (r: number) =>
    Array.from({ length: 31 }, (_, d) => sheet.getCell(r, 6 + d).value ?? null);
  return { result, sheet, row };
}

const snapshot = async () => {
  const [a] = await db.select({ n: count() }).from(shiftAssignments);
  const [e] = await db.select({ n: count() }).from(auditEvents);
  const [v] = await db.select({ n: count() }).from(scheduleVersionAssignments);
  const s = await db
    .select({ id: schedules.id, r: schedules.revision, u: schedules.updatedAt })
    .from(schedules)
    .orderBy(schedules.id);
  const t = await db
    .select({
      id: departmentExcelTemplates.id,
      sha: sql<string>`encode(sha256(${departmentExcelTemplates.content}), 'hex')`,
      r: departmentExcelTemplates.revision,
    })
    .from(departmentExcelTemplates)
    .orderBy(departmentExcelTemplates.id);
  return JSON.stringify({ a, e, v, s, t });
};

beforeEach(async () => {
  head = as(await load(U.icuHead.id));
  erHead = as(await load(U.erHead.id));
  const adminUser = await createUser(db, {
    personnelNumber: "8800",
    displayName: "مدیر بیمارستان",
    passwordHash: null,
  });
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, adminUser.id));
  admin = as(await load(adminUser.id));
  const secretary = await createUser(db, {
    personnelNumber: "7700",
    displayName: "منشی بخش",
    passwordHash: null,
  });
  secretaryId = secretary.id;
  await addMembership(db, {
    userId: secretary.id,
    departmentId: DEMO_ICU.id,
    role: "SECRETARY",
    startedOn: isoDate("2026-01-01"),
  });
  // The demo schedule's roster predates the secretary; add them explicitly.
  await db.execute(
    sql`insert into schedule_roster (schedule_id, user_id, role, added_by) values (${S}, ${secretary.id}, 'SECRETARY', ${U.icuHead.id})`,
  );
});

describe("template management (D124)", () => {
  it("stores an upload with its mapping and returns the identical file", async () => {
    const content = await icuTemplate();
    const created = ok(await upload(head, content));
    expect(created.version).toBe(1);
    const settings = await getExcelTemplateSettings(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(settings.template).toMatchObject({
      id: created.templateId,
      fileName: "nicu-template.xlsx",
      byteSize: content.byteLength,
      uploadedByName: U.icuHead.displayName,
      mapping: MAPPING,
      inspection: { valid: true, personnelColumnHidden: true },
    });
    expect(settings.template!.inspection.personnel).toHaveLength(8);
    const file = await getExcelTemplateFile(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(file.content).toEqual(content);
    const [audit] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "excelTemplate.uploaded"));
    expect(audit).toMatchObject({
      actorId: U.icuHead.id,
      departmentId: DEMO_ICU.id,
      entityId: created.templateId,
      data: expect.objectContaining({
        sha256: createHash("sha256").update(content).digest("hex"),
        personnel: 8,
      }),
    });
  });

  it("lets a Hospital Admin manage any department and lists them all", async () => {
    ok(await upload(admin, await icuTemplate(), { departmentId: DEMO_ER.id }));
    const overview = await listExcelTemplateOverview(admin);
    expect(overview.map((o) => [o.department.code, !!o.template])).toEqual([
      ["er", true],
      ["icu", false],
    ]);
    await expect(listExcelTemplateOverview(head)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("denies nurses, secretaries, supervisors and other departments' Head Nurses", async () => {
    const content = await icuTemplate();
    const denied = [
      erHead,
      as(await load(U.icuNurse1.id)),
      as(await load(U.supervisor.id)),
      as(await load(secretaryId)),
    ];
    for (const ctx of denied) {
      const result = await upload(ctx, content);
      expect(result.ok ? null : result.error.code).toBe("FORBIDDEN");
      await expect(
        getExcelTemplateSettings(ctx, { departmentId: DEMO_ICU.id }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        previewExcelTemplate(ctx, {
          departmentId: DEMO_ICU.id,
          mapping: MAPPING,
          content,
        }),
      ).rejects.toThrow(NotFoundError);
    }
    ok(await upload(head, content));
    for (const ctx of denied)
      await expect(
        getExcelTemplateFile(ctx, { departmentId: DEMO_ICU.id }),
      ).rejects.toThrow(NotFoundError);
    expect(
      await db.select({ n: count() }).from(departmentExcelTemplates),
    ).toEqual([{ n: 1 }]);
  });

  it("replaces atomically and keeps the working template when a replacement fails", async () => {
    const first = ok(await upload(head, await icuTemplate()));
    // A stale view of the active template is a conflict, not an overwrite.
    const stale = await upload(head, await icuTemplate(), {
      expectedTemplateId: null,
    });
    expect(stale.ok ? null : stale.error.code).toBe("CONFLICT");
    // An invalid replacement changes nothing.
    const invalid = await upload(
      head,
      await syntheticTemplate({ people: ICU_ROWS, merges: ["F11:G11"] }),
      { expectedTemplateId: first.templateId },
    );
    expect(invalid.ok ? null : invalid.error.code).toBe("VALIDATION");
    const notXlsx = await upload(head, new TextEncoder().encode("a,b"), {
      expectedTemplateId: first.templateId,
    });
    expect(notXlsx.ok ? null : notXlsx.error.code).toBe("VALIDATION");
    expect(
      (await getExcelTemplateSettings(head, { departmentId: DEMO_ICU.id }))
        .template?.id,
    ).toBe(first.templateId);

    const replacement = await syntheticTemplate({
      people: ICU_ROWS,
      sheetName: "Sheet2",
      otherSheets: ["Sheet1"],
    });
    const second = ok(
      await upload(head, replacement, {
        expectedTemplateId: first.templateId,
        fileName: "C:\\fakepath\\new.xlsx",
        mapping: { ...MAPPING, sheetName: "Sheet2" },
      }),
    );
    expect(second.version).toBe(2);
    const rows = await db
      .select({
        id: departmentExcelTemplates.id,
        isActive: departmentExcelTemplates.isActive,
        fileName: departmentExcelTemplates.fileName,
      })
      .from(departmentExcelTemplates)
      .orderBy(departmentExcelTemplates.version);
    expect(rows).toEqual([
      { id: first.templateId, isActive: false, fileName: "nicu-template.xlsx" },
      { id: second.templateId, isActive: true, fileName: "new.xlsx" },
    ]);
    // The next export uses the new template at once.
    const { sheet } = await exportScheduleToExcel(head, {
      scheduleId: S,
      calendar,
    }).then(async (r) => ({
      sheet: (await readWorkbook(r.bytes)).getWorksheet("Sheet2"),
    }));
    expect(sheet).toBeDefined();
  });

  it("lets exactly one of two concurrent replacements win", async () => {
    const first = ok(await upload(head, await icuTemplate()));
    const content = await icuTemplate();
    const results = await Promise.all([
      upload(head, content, { expectedTemplateId: first.templateId }),
      upload(admin, content, { expectedTemplateId: first.templateId }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      error: { code: "CONFLICT" },
    });
    const active = await db
      .select({ n: count() })
      .from(departmentExcelTemplates)
      .where(eq(departmentExcelTemplates.isActive, true));
    expect(active).toEqual([{ n: 1 }]);
  });

  it("previews and saves a new mapping for the stored file", async () => {
    const created = ok(await upload(head, await icuTemplate()));
    const preview = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: { ...MAPPING, lastRow: 12 },
    });
    expect(preview.personnel).toHaveLength(4);
    const bad = await updateExcelTemplateMapping(head, {
      departmentId: DEMO_ICU.id,
      templateId: created.templateId,
      expectedRevision: 0,
      mapping: { ...MAPPING, firstDayColumn: "C" },
    });
    expect(bad.ok ? null : bad.error.code).toBe("VALIDATION");
    const saved = ok(
      await updateExcelTemplateMapping(head, {
        departmentId: DEMO_ICU.id,
        templateId: created.templateId,
        expectedRevision: 0,
        mapping: { ...MAPPING, lastRow: 16 },
      }),
    );
    expect(saved.revision).toBe(1);
    const stale = await updateExcelTemplateMapping(admin, {
      departmentId: DEMO_ICU.id,
      templateId: created.templateId,
      expectedRevision: 0,
      mapping: MAPPING,
    });
    expect(stale.ok ? null : stale.error.code).toBe("CONFLICT");
    expect(
      (await getExcelTemplateSettings(head, { departmentId: DEMO_ICU.id }))
        .template?.mapping.lastRow,
    ).toBe(16);
  });
});

describe("schedule export (D124)", () => {
  it("requires a template first", async () => {
    expect(await getExcelExportAvailability(head, { scheduleId: S })).toEqual({
      hasTemplate: false,
      revisionDraftAvailable: false,
    });
    await expect(
      exportScheduleToExcel(head, { scheduleId: S, calendar }),
    ).rejects.toThrow(ValidationError);
  });

  it("exports a partial DRAFT: shifts and H as codes, OFF blank, undecided ?, secretary included", async () => {
    const template = await icuTemplate();
    ok(await upload(head, template));
    expect(
      (await getExcelExportAvailability(head, { scheduleId: S })).hasTemplate,
    ).toBe(true);
    // Aban 1405 starts 2026-10-23; only the first ten days are planned.
    await assign(U.icuNurse1.id, "2026-10-23", "M");
    await assign(U.icuNurse1.id, "2026-10-24", "E");
    await assign(U.icuNurse1.id, "2026-10-25", "N");
    await assign(U.icuNurse1.id, "2026-10-26", "OFF");
    await assign(U.icuNurse1.id, "2026-10-27", "ME");
    await assign(U.icuNurse1.id, "2026-10-28", "H");
    await assign(U.icuHead.id, "2026-11-01", "M");
    await assign(secretaryId, "2026-10-23", "M");
    await assign(secretaryId, "2026-10-24", "H");
    const before = await snapshot();
    const { result, sheet, row } = await exported(head, { scheduleId: S });
    expect(await snapshot()).toBe(before);
    expect(result).toMatchObject({
      status: "DRAFT",
      source: "WORKING_COPY",
      period: { start: "2026-10-23", end: "2026-11-21" },
      department: { code: "icu" },
      templateVersion: 1,
    });
    expect(row(11).slice(0, 7)).toEqual(["M", "E", "N", null, "ME", "H", "?"]);
    // Undecided is never printed as rest (blank): every open day is ?.
    expect(
      row(11)
        .slice(6, 30)
        .every((v) => v === "?"),
    ).toBe(true);
    expect(row(8)[9]).toBe("M"); // 1 Nov is day 10.
    expect(row(8)[0]).toBe("?");
    expect(row(12).slice(0, 3)).toEqual(["M", "H", "?"]); // The secretary.
    // Rostered people without decisions: undecided all month.
    for (const r of [7, 13, 14, 15])
      expect(
        row(r)
          .slice(0, 30)
          .every((v) => v === "?"),
      ).toBe(true);
    // The template's extra person (not on the roster) is cleared.
    expect(row(16).every((v) => v === null)).toBe(true);
    // Aban has 30 days: day 31 is blank even if a stale value was there.
    for (const r of [7, 8, 11, 12, 13, 14, 15]) expect(row(r)[30]).toBeNull();
    expect(sheet.getCell("B12").value).toBe(7700);
    expect(sheet.getColumn(2).hidden).toBe(true);
    // The stored template is unchanged.
    const stored = await getExcelTemplateFile(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(stored.content).toEqual(template);
  });

  it("fails with the unmatched personnel number instead of omitting anyone", async () => {
    ok(
      await upload(
        head,
        await icuTemplate(
          ICU_ROWS.filter((r) => r.number !== U.icuNurse2.personnelNumber),
        ),
      ),
    );
    await expect(
      exportScheduleToExcel(head, { scheduleId: S, calendar }),
    ).rejects.toThrow(new RegExp(`${U.icuNurse2.personnelNumber}`));
  });

  it("matches by personnel number only, so a corrected number works without a deployment", async () => {
    ok(await upload(head, await icuTemplate()));
    await assign(U.icuNurse4.id, "2026-10-23", "N");
    await db
      .update(users)
      .set({ personnelNumber: "5555" })
      .where(eq(users.id, U.icuNurse4.id));
    await expect(
      exportScheduleToExcel(head, { scheduleId: S, calendar }),
    ).rejects.toThrow(/5555/);
    const rows = ICU_ROWS.map((r) =>
      r.number === U.icuNurse4.personnelNumber ? { ...r, number: "5555" } : r,
    );
    const current = await getExcelTemplateSettings(head, {
      departmentId: DEMO_ICU.id,
    });
    ok(
      await upload(head, await icuTemplate(rows), {
        expectedTemplateId: current.template!.id,
      }),
    );
    const { row } = await exported(head, { scheduleId: S });
    expect(row(14)[0]).toBe("N");
  });

  it("isolates departments and follows schedule visibility", async () => {
    ok(await upload(head, await icuTemplate()));
    await expect(
      exportScheduleToExcel(erHead, { scheduleId: S, calendar }),
    ).rejects.toThrow(NotFoundError);
    const supervisor = as(await load(U.supervisor.id));
    // A Supervisor sees the grid only from FINALIZED (D12).
    await expect(
      exportScheduleToExcel(supervisor, { scheduleId: S, calendar }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      exportScheduleToExcel(as(await load(U.icuNurse1.id)), {
        scheduleId: S,
        calendar,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      exportScheduleToExcel(as(await load(secretaryId)), {
        scheduleId: S,
        calendar,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      exportScheduleToExcel(admin, { scheduleId: S, calendar }),
    ).rejects.toThrow(NotFoundError);
  });

  it.each([
    [{ year: 1404, month: 12 }, 29],
    [{ year: 1405, month: 7 }, 30],
    [{ year: 1405, month: 1 }, 31],
  ])(
    "blanks the days a %j month does not have (%i days)",
    async (month, days) => {
      ok(await upload(head, await icuTemplate()));
      const period = jalaliMonthPeriod(month);
      const created = ok(
        await createSchedule(head, {
          departmentId: DEMO_ICU.id,
          periodStart: period.start,
          periodEnd: period.end,
          label: "ماه آزمایشی",
        }),
      );
      for (let d = 0; d < days; d++)
        await assign(
          U.icuNurse1.id,
          addDays(period.start, d),
          "H",
          created.scheduleId,
        );
      const { row } = await exported(head, { scheduleId: created.scheduleId });
      expect(row(11).filter((v) => v === "H")).toHaveLength(days);
      expect(
        row(11)
          .slice(days)
          .every((v) => v === null),
      ).toBe(true);
    },
  );

  describe("approved schedules and revisions", () => {
    const step = async (command: typeof finalizeSchedule, ctx: AppContext) =>
      ok(
        await command(ctx, {
          scheduleId: S,
          expectedRevision: (await findScheduleById(db, S))!.revision,
        }),
      );

    async function approve() {
      await assign(U.icuNurse1.id, "2026-10-25", "M");
      await step(openPreferenceWindow as typeof finalizeSchedule, head);
      await step(closePreferenceWindow as typeof finalizeSchedule, head);
      await completeScheduleFixture(db, S, [
        U.icuHead.id,
        U.icuNurse4.id,
        U.transferNurse.id,
      ]);
      await step(finalizeSchedule, head);
      await step(submitSchedule, head);
      await step(approveSchedule, as(await load(U.supervisor.id)));
    }

    it("exports the approved version, and the revision draft only when asked", async () => {
      ok(await upload(head, await icuTemplate()));
      await approve();
      const approved = await exported(head, { scheduleId: S });
      expect(approved.result.source).toBe("APPROVED_VERSION");
      expect(approved.row(11)[2]).toBe("M");
      // A complete approved month has no undecided day; OFF is blank.
      for (const r of [7, 8, 11, 12, 13, 14, 15])
        expect(
          approved
            .row(r)
            .slice(0, 30)
            .every(
              (v) =>
                v === null || ["M", "E", "N", "ME", "H"].includes(String(v)),
            ),
        ).toBe(true);
      expect(approved.row(11).slice(0, 30)).toContain(null);

      ok(
        await adjustSchedule(head, {
          scheduleId: S,
          expectedRevision: (await findScheduleById(db, S))!.revision,
          changes: [
            { nurseId: U.icuNurse1.id, date: "2026-10-25", shift: "E" },
          ],
          reasonCode: "STAFFING_NEED",
        }),
      );
      expect((await findScheduleById(db, S))!.status).toBe("REVISING");
      expect(await getExcelExportAvailability(head, { scheduleId: S })).toEqual(
        {
          hasTemplate: true,
          revisionDraftAvailable: true,
        },
      );
      const before = await snapshot();
      const official = await exported(head, { scheduleId: S });
      expect(official.result.source).toBe("APPROVED_VERSION");
      expect(official.row(11)[2]).toBe("M");
      const draft = await exported(head, {
        scheduleId: S,
        source: "REVISION_DRAFT",
      });
      expect(draft.result.source).toBe("REVISION_DRAFT");
      expect(draft.row(11)[2]).toBe("E");
      expect(await snapshot()).toBe(before);
      // The Supervisor reads the approved schedule too.
      const supervisor = await exported(as(await load(U.supervisor.id)), {
        scheduleId: S,
      });
      expect(supervisor.row(11)[2]).toBe("M");
    });
  });
});

describe("templates and data lifecycle (D124)", () => {
  const templates = async () =>
    (await db.select({ n: count() }).from(departmentExcelTemplates))[0]!.n;
  const reset = async (
    categories: readonly (typeof FULL_OPERATIONAL_CATEGORIES)[number][],
  ) => {
    await db.delete(resetOperations);
    // The reset requires a usable (credentialed) admin; the value is never verified here.
    await db
      .update(users)
      .set({ passwordHash: "test-only-placeholder" })
      .where(eq(users.id, admin.actor.userId));
    const preview = await previewFullReset(admin, {
      scope: { kind: "APPLICATION" },
      categories: [...categories],
    });
    expect(preview.plan.blockers).toEqual([]);
    expect(
      await executeFullReset(admin, { ...preview, confirmed: true }),
    ).toMatchObject({ ok: true });
    return preview;
  };

  it("cannot orphan a template: its department cannot be deleted under it", async () => {
    ok(await upload(head, await icuTemplate()));
    await expect(
      db.delete(departments).where(eq(departments.id, DEMO_ICU.id)),
    ).rejects.toThrow();
  });

  it("keeps templates through an operational reset (configuration)", async () => {
    ok(await upload(head, await icuTemplate()));
    await reset(FULL_OPERATIONAL_CATEGORIES);
    expect(await templates()).toBe(1);
    expect(
      (await getExcelTemplateSettings(admin, { departmentId: DEMO_ICU.id }))
        .template?.inspection.valid,
    ).toBe(true);
  });

  it("deletes a department's templates, counted in the preview, when the department is reset", async () => {
    ok(await upload(head, await icuTemplate()));
    const current = await getExcelTemplateSettings(head, {
      departmentId: DEMO_ICU.id,
    });
    ok(
      await upload(head, await icuTemplate(), {
        expectedTemplateId: current.template!.id,
      }),
    );
    // Departments only (plus the operational data that depends on them);
    // global reference data (shift types, reasons) is left alone.
    const preview = await reset([
      ...FULL_OPERATIONAL_CATEGORIES,
      "departments",
    ]);
    expect(
      preview.plan.tables.find((t) => t.table === "department_excel_templates"),
    ).toMatchObject({ category: "departments", total: 2, remove: 2 });
    expect(await templates()).toBe(0);
  });

  it("never reads the template bytes into the reset inventory", async () => {
    ok(await upload(head, await icuTemplate()));
    const table = (await readResetInventory(db)).find(
      (t) => t.name === "department_excel_templates",
    )!;
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).not.toHaveProperty("content");
    expect(table.rows[0]).toHaveProperty("sha256");
  });
});
