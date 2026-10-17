import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { exportScheduleToExcel } from "../../src/application/excel-export/export";
import {
  describeTemplateRows,
  getExcelTemplateSettings,
  prepareTemplatePersonnelColumn,
  previewExcelTemplate,
  uploadExcelTemplate,
} from "../../src/application/excel-export/templates";
import type { ActionResult } from "../../src/application/result";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import type { AppContext } from "../../src/application/use-case";
import { ValidationError } from "../../src/domain/shared/errors";
import { daysBetween, isoDate } from "../../src/domain/shared/dates";
import { periodDays } from "../../src/domain/shared/period";
import type { AssignmentCode } from "../../src/domain/shifts/shift-type";
import { jalaliMonthPeriod } from "../../src/features/calendar/jalali";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import {
  addMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { createUser } from "../../src/infrastructure/repositories/users";
import { completeScheduleFixture } from "../support/complete-schedule";
import { readWorkbook } from "../support/excel-templates";
import {
  NICU_MAPPING,
  NICU_SECRETARY_ROW,
  NICU_SHEET,
  nicuTemplate,
} from "../support/nicu-template";
import { setupTestDatabase } from "./support/database";

/**
 * The NICU print layout end to end (D124), on the sanitized equivalent of
 * the hospital's workbook and the demo ICU department: prepare the hidden
 * personnel-number column from the system's records, upload and validate,
 * then export partial, complete, 29-, 30- and 31-day months.
 */

const { db } = setupTestDatabase();
const NOW = new Date("2026-10-01T06:30:00Z");
const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-01")))!,
  clock: () => NOW,
});
let head: AppContext;
let secretaryId: string;

function ok<T>(result: ActionResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

/** Template rows of the demo ICU people: Head Nurse first, the secretary on 23. */
const rowsOf = () => [
  { row: 7, userId: U.icuHead.id },
  { row: 8, userId: U.icuNurse1.id },
  { row: 9, userId: U.icuNurse2.id },
  { row: 10, userId: U.icuNurse3.id },
  { row: 11, userId: U.icuNurse4.id },
  { row: 12, userId: U.transferNurse.id },
  { row: NICU_SECRETARY_ROW, userId: secretaryId },
];
const PEOPLE_ROWS = [7, 8, 9, 10, 11, 12, NICU_SECRETARY_ROW];

beforeEach(async () => {
  head = await as(U.icuHead.id);
  const secretary = await createUser(db, {
    personnelNumber: "07700", // Fictional; the leading zero must survive.
    displayName: "منشی نمونه",
    passwordHash: null,
  });
  secretaryId = secretary.id;
  await addMembership(db, {
    userId: secretary.id,
    departmentId: DEMO_ICU.id,
    role: "SECRETARY",
    startedOn: isoDate("2026-01-01"),
  });
  await db.execute(
    sql`insert into schedule_roster (schedule_id, user_id, role, added_by) values (${DEMO_SCHEDULE.id}, ${secretary.id}, 'SECRETARY', ${U.icuHead.id})`,
  );
});

async function prepared(printArea?: string) {
  const original = await nicuTemplate({
    peopleRows: PEOPLE_ROWS,
    ...(printArea ? { printArea } : {}),
  });
  return prepareTemplatePersonnelColumn(head, {
    departmentId: DEMO_ICU.id,
    content: original,
    sheetName: NICU_SHEET,
    column: NICU_MAPPING.personnelColumn,
    rows: rowsOf(),
  });
}

const upload = async (content: Uint8Array) =>
  ok(
    await uploadExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      expectedTemplateId: null,
      fileName: "nicu.xlsx",
      content,
      mapping: NICU_MAPPING,
    }),
  );

async function exported(scheduleId: string) {
  const result = await exportScheduleToExcel(head, { scheduleId });
  const sheet = (await readWorkbook(result.bytes)).getWorksheet(NICU_SHEET)!;
  const days = (row: number) =>
    Array.from(
      { length: 31 },
      (_, d) => sheet.getCell(row, 13 + d).value ?? null,
    );
  const cell = (address: string) => sheet.getCell(address).value ?? null;
  return { result, sheet, days, cell };
}

const assign = (
  userId: string,
  date: string,
  shift: AssignmentCode,
  scheduleId: string = DEMO_SCHEDULE.id,
) =>
  setAssignment(db, {
    scheduleId,
    userId,
    date: isoDate(date),
    shift,
    updatedBy: U.icuHead.id,
  });

describe("preparing the personnel-number column (D124)", () => {
  it("lists the template rows and the department's people with their recorded numbers", async () => {
    const original = await nicuTemplate({ peopleRows: PEOPLE_ROWS });
    const described = await describeTemplateRows(head, {
      departmentId: DEMO_ICU.id,
      content: original,
      ...NICU_MAPPING,
    });
    expect(described.rows.map((r) => r.row)).toEqual([
      ...PEOPLE_ROWS.slice(0, -1),
      22,
      23,
    ]);
    const byId = new Map(described.personnel.map((p) => [p.userId, p]));
    expect(byId.get(U.icuNurse1.id)?.personnelNumber).toBe(
      U.icuNurse1.personnelNumber,
    );
    expect(byId.get(secretaryId)).toMatchObject({
      role: "SECRETARY",
      personnelNumber: "07700",
    });
    // Former members and other departments are not offered.
    expect(byId.has(U.inactiveNurse.id)).toBe(false);
    expect(byId.has(U.erNurse1.id)).toBe(false);
  });

  it("writes only the system's numbers of the chosen people, and the preview names them", async () => {
    const bytes = await prepared();
    const preview = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: NICU_MAPPING,
      content: bytes,
    });
    expect(preview.errors).toEqual([]);
    expect(preview.valid).toBe(true);
    expect(preview.personnelColumnHidden).toBe(true);
    expect(preview.matches).toEqual([
      {
        cell: "BL7",
        personnelNumber: U.icuHead.personnelNumber,
        displayName: U.icuHead.displayName,
      },
      {
        cell: "BL8",
        personnelNumber: U.icuNurse1.personnelNumber,
        displayName: U.icuNurse1.displayName,
      },
      {
        cell: "BL9",
        personnelNumber: U.icuNurse2.personnelNumber,
        displayName: U.icuNurse2.displayName,
      },
      {
        cell: "BL10",
        personnelNumber: U.icuNurse3.personnelNumber,
        displayName: U.icuNurse3.displayName,
      },
      {
        cell: "BL11",
        personnelNumber: U.icuNurse4.personnelNumber,
        displayName: U.icuNurse4.displayName,
      },
      {
        cell: "BL12",
        personnelNumber: U.transferNurse.personnelNumber,
        displayName: U.transferNurse.displayName,
      },
      { cell: "BL23", personnelNumber: "07700", displayName: "منشی نمونه" },
    ]);
    // Only the print-area notice: day 31 (AQ) is outside it as found.
    expect(preview.warnings.map((w) => w.cell)).toEqual(["AQ6"]);
  });

  it("refuses people outside the department, duplicates and people without a number", async () => {
    const original = await nicuTemplate({ peopleRows: PEOPLE_ROWS });
    const prepare = (rows: { row: number; userId: string }[]) =>
      prepareTemplatePersonnelColumn(head, {
        departmentId: DEMO_ICU.id,
        content: original,
        sheetName: NICU_SHEET,
        column: "BL",
        rows,
      });
    await expect(prepare([{ row: 7, userId: U.erNurse1.id }])).rejects.toThrow(
      ValidationError,
    );
    await expect(
      prepare([
        { row: 7, userId: U.icuNurse1.id },
        { row: 8, userId: U.icuNurse1.id },
      ]),
    ).rejects.toThrow(ValidationError);
    const unnumbered = await createUser(db, {
      email: "unnumbered@excel-export.invalid",
      personnelNumber: null,
      displayName: "بدون شماره",
      passwordHash: null,
    });
    await addMembership(db, {
      userId: unnumbered.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    await expect(prepare([{ row: 7, userId: unnumbered.id }])).rejects.toThrow(
      "شماره پرسنلی ثبت نشده",
    );
    // Another department's Head Nurse cannot use this department's records.
    await expect(
      prepareTemplatePersonnelColumn(await as(U.erHead.id), {
        departmentId: DEMO_ICU.id,
        content: original,
        sheetName: NICU_SHEET,
        column: "BL",
        rows: [{ row: 7, userId: U.icuNurse1.id }],
      }),
    ).rejects.toThrow();
  });

  it("flags a personnel number that belongs to nobody in the department", async () => {
    const bytes = await prepared();
    const preview = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: NICU_MAPPING,
      content: bytes,
    });
    expect(preview.matches.every((m) => m.displayName !== null)).toBe(true);
    // The ER Head Nurse's number in an ICU row would be named as unknown.
    const foreign = await prepareTemplatePersonnelColumn(head, {
      departmentId: DEMO_ICU.id,
      content: await nicuTemplate({ peopleRows: [7] }),
      sheetName: NICU_SHEET,
      column: "BL",
      rows: [{ row: 7, userId: U.icuNurse1.id }],
    });
    await db.execute(
      sql`update department_memberships set ended_on = '2026-09-01' where user_id = ${U.icuNurse1.id}`,
    );
    const after = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: { ...NICU_MAPPING, lastRow: 21, summaryRows: [] },
      content: foreign,
    });
    expect(after.matches).toEqual([
      {
        cell: "BL7",
        personnelNumber: U.icuNurse1.personnelNumber,
        displayName: null,
      },
    ]);
    expect(after.warnings).toContainEqual(
      expect.objectContaining({ cell: "BL7" }),
    );
  });
});

describe("exporting the NICU layout (D124)", () => {
  it("a partial draft: codes, OFF blank, H, ?, the secretary, statistics and summaries", async () => {
    await upload(await prepared());
    // Aban 1405 (30 days) from 2026-10-23; a few decisions only.
    await assign(U.icuNurse1.id, "2026-10-23", "M");
    await assign(U.icuNurse1.id, "2026-10-24", "OFF");
    await assign(U.icuNurse1.id, "2026-10-25", "H");
    await assign(U.icuNurse1.id, "2026-10-26", "ME");
    await assign(secretaryId, "2026-10-23", "M");
    await assign(secretaryId, "2026-10-24", "OFF");
    const { result, days, cell } = await exported(DEMO_SCHEDULE.id);
    expect(result).toMatchObject({ status: "DRAFT", source: "WORKING_COPY" });
    expect(days(8).slice(0, 5)).toEqual(["M", null, "H", "ME", "?"]);
    expect(days(8)[30]).toBeNull(); // Aban has no day 31.
    expect(days(NICU_SECRETARY_ROW).slice(0, 3)).toEqual(["M", null, "?"]);
    expect(
      days(7)
        .slice(0, 30)
        .every((v) => v === "?"),
    ).toBe(true);
    // Rows 13–21 have no person; row 22 is the «منشی» caption: untouched.
    expect(days(15).every((v) => v === null)).toBe(true);
    expect(cell("A22")).toBe("منشی");
    // Statistics: I (required hours) cleared, J/K unknown while days are open.
    for (const row of PEOPLE_ROWS)
      expect([cell(`I${row}`), cell(`J${row}`), cell(`K${row}`)]).toEqual([
        null,
        "?",
        "?",
      ]);
    // Summaries: ? on days with someone undecided; headings 1–30.
    for (const row of [25, 26, 27]) {
      expect(
        days(row)
          .slice(0, 30)
          .every((v) => v === "?"),
      ).toBe(true);
      expect(days(row)[30]).toBeNull();
    }
    expect(days(6).slice(28)).toEqual([29, 30, null]);
  });

  it("a complete schedule: every figure recalculated from the decisions", async () => {
    await upload(await prepared());
    await completeScheduleFixture(db, DEMO_SCHEDULE.id, [
      U.icuHead.id,
      U.icuNurse1.id,
    ]);
    await assign(U.icuNurse2.id, "2026-10-30", "H");
    await assign(secretaryId, "2026-10-31", "N"); // The secretary never counts as coverage.
    const { days, cell } = await exported(DEMO_SCHEDULE.id);

    const assignments = await listAssignments(db, DEMO_SCHEDULE.id);
    const period = {
      start: isoDate(DEMO_SCHEDULE.periodStart),
      end: isoDate(DEMO_SCHEDULE.periodEnd),
    };
    const dayOf = (date: string) =>
      daysBetween(period.start, isoDate(date)) + 1;
    const people = rowsOf();
    for (const { row, userId } of people) {
      const mine = assignments.filter((a) => a.nurseId === userId);
      expect(mine).toHaveLength(30);
      // Day cells: exactly the decisions, OFF blank, no ?.
      expect(days(row).slice(0, 30)).toEqual(
        Array.from({ length: 30 }, (_, i) => {
          const code = mine.find((a) => dayOf(a.date) === i + 1)!.shift;
          return code === "OFF" ? null : code;
        }),
      );
      expect(cell(`K${row}`)).toBe(
        mine.filter((a) => ["M", "E", "N", "ME"].includes(a.shift)).length,
      );
      expect(cell(`J${row}`)).toBe(mine.filter((a) => a.shift === "H").length);
      expect(cell(`I${row}`)).toBeNull();
    }
    expect(cell("J9")).toBeGreaterThanOrEqual(1);
    // Daily coverage of the nurses (not the secretary): ME counts toward M and E.
    const nurses = new Set(
      people.filter((p) => p.userId !== secretaryId).map((p) => p.userId),
    );
    for (const date of periodDays(period)) {
      const codes = assignments
        .filter((a) => a.date === date && nurses.has(a.nurseId))
        .map((a) => a.shift);
      const d = dayOf(date) - 1;
      expect(days(25)[d]).toBe(
        codes.filter((c) => c === "M" || c === "ME").length,
      );
      expect(days(26)[d]).toBe(
        codes.filter((c) => c === "E" || c === "ME").length,
      );
      expect(days(27)[d]).toBe(codes.filter((c) => c === "N").length);
    }
    expect(
      days(25)
        .slice(0, 30)
        .some((v) => (v as number) > 0),
    ).toBe(true);
  });

  it.each([
    [{ year: 1404, month: 12 }, 29],
    [{ year: 1405, month: 9 }, 30],
    [{ year: 1405, month: 1 }, 31],
  ])(
    "a %j month (%i days): headings, days and summaries stop at its end",
    async (month, length) => {
      await upload(await prepared("A1:AQ31"));
      const period = jalaliMonthPeriod(month);
      const created = ok(
        await createSchedule(head, {
          departmentId: DEMO_ICU.id,
          periodStart: period.start,
          periodEnd: period.end,
          label: "ماه آزمایشی",
        }),
      );
      await db.execute(
        sql`insert into schedule_roster (schedule_id, user_id, role, added_by) values (${created.scheduleId}, ${secretaryId}, 'SECRETARY', ${U.icuHead.id}) on conflict do nothing`,
      );
      await completeScheduleFixture(db, created.scheduleId);
      const { days } = await exported(created.scheduleId);
      expect(days(6).filter((v) => v !== null)).toEqual(
        Array.from({ length: length }, (_, i) => i + 1),
      );
      for (const row of [...PEOPLE_ROWS, 25, 26, 27]) {
        expect(
          days(row)
            .slice(length)
            .every((v) => v === null),
        ).toBe(true);
        expect(days(row).slice(0, length)).not.toContain("?");
      }
      expect(
        days(25)
          .slice(0, length)
          .every((v) => typeof v === "number"),
      ).toBe(true);
    },
  );

  it("keeps the stored mapping, statistics included", async () => {
    await upload(await prepared());
    const settings = await getExcelTemplateSettings(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(settings.template!.mapping).toEqual(NICU_MAPPING);
    expect(settings.template!.inspection).toMatchObject({
      valid: true,
      printArea: "A1:AP31",
    });
  });
});
