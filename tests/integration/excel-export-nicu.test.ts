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
import { jalaliExportCalendar as calendar } from "../../src/features/excel-export/calendar";
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
import type { ExcelTemplateMapping } from "../../src/domain/excel-export/template-mapping";
import {
  NICU_CALCULATED_MAPPING,
  NICU_DAY_ROW,
  NICU_FIRST_DAY,
  NICU_MAPPING,
  NICU_SECRETARY_ROW,
  NICU_SHEET,
  NICU_WEEKDAY_ROW,
  nicuTemplate,
} from "../support/nicu-template";
import { setupTestDatabase } from "./support/database";

/**
 * The NICU print layout end to end (D124), on the sanitized equivalent of
 * the hospital's approved workbook and the demo ICU department: the
 * personnel numbers already printed in column B are matched strictly, the
 * template is uploaded and validated, and partial, complete, 29-, 30- and
 * 31-day months are exported with their weekdays, month heading and Fridays.
 * Every figure is recalculated here independently of the export code.
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

/** Template rows of the demo ICU people: Head Nurse first, the secretary on 22. */
const rowsOf = () => [
  { row: 7, userId: U.icuHead.id, number: U.icuHead.personnelNumber },
  { row: 8, userId: U.icuNurse1.id, number: U.icuNurse1.personnelNumber },
  { row: 9, userId: U.icuNurse2.id, number: U.icuNurse2.personnelNumber },
  { row: 10, userId: U.icuNurse3.id, number: U.icuNurse3.personnelNumber },
  { row: 11, userId: U.icuNurse4.id, number: U.icuNurse4.personnelNumber },
  {
    row: 12,
    userId: U.transferNurse.id,
    number: U.transferNurse.personnelNumber,
  },
  { row: NICU_SECRETARY_ROW, userId: secretaryId, number: SECRETARY_NUMBER },
];
const PEOPLE_ROWS = [7, 8, 9, 10, 11, 12, NICU_SECRETARY_ROW];
/** Fictional; the leading zero must survive. */
const SECRETARY_NUMBER = "07700";

beforeEach(async () => {
  head = await as(U.icuHead.id);
  const secretary = await createUser(db, {
    personnelNumber: SECRETARY_NUMBER,
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

/** The department's template: its people's recorded numbers printed in B. */
const departmentTemplate = (printArea?: string) =>
  nicuTemplate({
    peopleRows: PEOPLE_ROWS,
    numbers: new Map(rowsOf().map((r) => [r.row, r.number!])),
    ...(printArea ? { printArea } : {}),
  });

const upload = async (
  content: Uint8Array,
  mapping: ExcelTemplateMapping = NICU_MAPPING,
) =>
  ok(
    await uploadExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      expectedTemplateId: null,
      fileName: "nicu.xlsx",
      content,
      mapping,
    }),
  );

/** The template as uploaded, for what the export must leave alone. */
const savedSheet = async () =>
  (await readWorkbook(await departmentTemplate())).getWorksheet(NICU_SHEET)!;
const savedDays = (
  sheet: Awaited<ReturnType<typeof savedSheet>>,
  row: number,
) =>
  Array.from(
    { length: 31 },
    (_, d) => sheet.getCell(row, NICU_FIRST_DAY + d).value ?? null,
  );

async function exported(scheduleId: string) {
  const result = await exportScheduleToExcel(head, { scheduleId, calendar });
  const sheet = (await readWorkbook(result.bytes)).getWorksheet(NICU_SHEET)!;
  const days = (row: number) =>
    Array.from(
      { length: 31 },
      (_, d) => sheet.getCell(row, NICU_FIRST_DAY + d).value ?? null,
    );
  const cell = (address: string) => sheet.getCell(address).value ?? null;
  /** Days of `row` painted with the holiday fill (theme colour 3). */
  const highlighted = (row: number) =>
    Array.from({ length: 31 }, (_, d) => d + 1).filter(
      (day) =>
        (
          sheet.getCell(row, NICU_FIRST_DAY + day - 1).fill as {
            fgColor?: { theme?: number };
          }
        )?.fgColor?.theme === 3,
    );
  return { result, sheet, days, cell, highlighted };
}

/** Independent of the code under test: weekday initials from the UTC day. */
const INITIAL = ["ی", "د", "س", "چ", "پ", "ج", "ش"];
const utcDay = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const fridays = (dates: readonly string[]) =>
  dates.flatMap((d, i) => (utcDay(d) === 5 ? [i + 1] : []));

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

describe("matching the printed personnel numbers (D124)", () => {
  it("matches column B strictly and names each row from the records", async () => {
    const preview = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: NICU_MAPPING,
      content: await departmentTemplate(),
    });
    expect(preview.errors).toEqual([]);
    expect(preview.valid).toBe(true);
    expect(preview.personnelColumnHidden).toBe(false);
    expect(preview.matches).toEqual(
      rowsOf().map((r) => ({
        cell: `B${r.row}`,
        personnelNumber: r.number,
        displayName:
          r.userId === secretaryId
            ? "منشی نمونه"
            : Object.values(U).find((u) => u.id === r.userId)!.displayName,
      })),
    );
    // Only the notice that the header rows already have the holiday fill.
    expect(preview.warnings).toEqual([
      { message: expect.stringContaining("در ردیف‌های 5، 6") },
    ]);
  });

  it("flags a printed number that belongs to nobody in the department", async () => {
    const content = await nicuTemplate({
      peopleRows: [7, 8],
      numbers: new Map([
        [7, U.icuHead.personnelNumber!],
        [8, U.erNurse1.personnelNumber!],
      ]),
    });
    const preview = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: NICU_MAPPING,
      content,
    });
    expect(preview.matches[1]).toEqual({
      cell: "B8",
      personnelNumber: U.erNurse1.personnelNumber,
      displayName: null,
    });
    expect(preview.warnings).toContainEqual(
      expect.objectContaining({ cell: "B8" }),
    );
  });

  it("refuses an export when a rostered person has no row", async () => {
    await upload(
      await nicuTemplate({
        peopleRows: [7],
        numbers: new Map([[7, U.icuHead.personnelNumber!]]),
      }),
    );
    await expect(
      exportScheduleToExcel(head, { scheduleId: DEMO_SCHEDULE.id, calendar }),
    ).rejects.toThrow(U.icuNurse1.personnelNumber!);
  });
});

describe("the personnel-number preparation tool, for workbooks without numbers", () => {
  const bare = () => nicuTemplate({ peopleRows: PEOPLE_ROWS, numbers: false });

  it("lists the rows and the department's people with their recorded numbers", async () => {
    const described = await describeTemplateRows(head, {
      departmentId: DEMO_ICU.id,
      content: await bare(),
      ...NICU_MAPPING,
    });
    expect(described.rows.map((r) => r.row)).toEqual(PEOPLE_ROWS);
    const byId = new Map(described.personnel.map((p) => [p.userId, p]));
    expect(byId.get(secretaryId)).toMatchObject({
      role: "SECRETARY",
      personnelNumber: SECRETARY_NUMBER,
    });
    expect(byId.has(U.inactiveNurse.id)).toBe(false);
    expect(byId.has(U.erNurse1.id)).toBe(false);
  });

  it("writes only the system's numbers, and refuses outsiders, duplicates and the unnumbered", async () => {
    const original = await bare();
    const prepare = (rows: { row: number; userId: string }[]) =>
      prepareTemplatePersonnelColumn(head, {
        departmentId: DEMO_ICU.id,
        content: original,
        sheetName: NICU_SHEET,
        column: "BL",
        rows,
      });
    const prepared = await prepare(rowsOf());
    const preview = await previewExcelTemplate(head, {
      departmentId: DEMO_ICU.id,
      mapping: { ...NICU_MAPPING, personnelColumn: "BL" },
      content: prepared,
    });
    expect(preview.valid).toBe(true);
    expect(preview.personnelColumnHidden).toBe(true);
    expect(preview.matches.map((m) => m.personnelNumber)).toEqual(
      rowsOf().map((r) => r.number),
    );
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
});

describe("exporting the NICU layout (D124)", () => {
  const period = {
    start: isoDate(DEMO_SCHEDULE.periodStart),
    end: isoDate(DEMO_SCHEDULE.periodEnd),
  };
  const dayOf = (date: string) => daysBetween(period.start, isoDate(date)) + 1;

  it("a partial draft: codes, OFF blank, H, ?, the secretary, statistics, calendar", async () => {
    await upload(await departmentTemplate());
    // Aban 1405 (30 days) from Friday 2026-10-23; a few decisions only.
    await assign(U.icuNurse1.id, "2026-10-23", "M");
    await assign(U.icuNurse1.id, "2026-10-24", "OFF");
    await assign(U.icuNurse1.id, "2026-10-25", "H");
    await assign(U.icuNurse1.id, "2026-10-26", "ME");
    await assign(secretaryId, "2026-10-23", "M");
    await assign(secretaryId, "2026-10-24", "OFF");
    const { result, days, cell, highlighted } = await exported(
      DEMO_SCHEDULE.id,
    );
    expect(result).toMatchObject({ status: "DRAFT", source: "WORKING_COPY" });
    expect(days(8).slice(0, 5)).toEqual(["M", null, "H", "ME", "?"]);
    expect(days(8)[30]).toBeNull(); // Aban has no day 31.
    expect(days(NICU_SECRETARY_ROW).slice(0, 3)).toEqual(["M", null, "?"]);
    expect(
      days(7)
        .slice(0, 30)
        .every((v) => v === "?"),
    ).toBe(true);
    // Rows 13–21 hold nobody: cleared.
    expect(days(15).every((v) => v === null)).toBe(true);
    // Hand-maintained statistics (H–L) and coverage (rows 23–25) are the
    // template's own: never recalculated, never "?", day 31 cleared.
    const saved = await savedSheet();
    for (const row of PEOPLE_ROWS)
      for (const column of ["H", "I", "J", "K", "L"])
        expect(cell(`${column}${row}`), `${column}${row}`).toBe(
          saved.getCell(`${column}${row}`).value ?? null,
        );
    for (const row of [23, 24, 25]) {
      expect(days(row).slice(0, 30)).toEqual(
        savedDays(saved, row).slice(0, 30),
      );
      expect(days(row)[30]).toBeNull();
    }
    // The calendar follows the schedule's own dates.
    const dates = periodDays(period);
    expect(cell("U3")).toBe("آبان\u200cماه 1405");
    expect(days(NICU_DAY_ROW)).toEqual([
      ...Array.from({ length: 30 }, (_, i) => i + 1),
      null,
    ]);
    expect(days(NICU_WEEKDAY_ROW)).toEqual([
      ...dates.map((d) => INITIAL[utcDay(d)]),
      null,
    ]);
    expect(fridays(dates)).toEqual([1, 8, 15, 22, 29]);
    for (const row of [...PEOPLE_ROWS, 15, 23, 24, 25])
      expect(highlighted(row), `row ${row}`).toEqual(fridays(dates));
  });

  it("a complete schedule: shifts exact, manual statistics and coverage untouched", async () => {
    await upload(await departmentTemplate());
    await completeScheduleFixture(db, DEMO_SCHEDULE.id, [
      U.icuHead.id,
      U.icuNurse1.id,
    ]);
    await assign(U.icuNurse2.id, "2026-10-30", "H");
    await assign(U.icuNurse3.id, "2026-10-31", "ME"); // One shift; M and E coverage.
    await assign(secretaryId, "2026-11-01", "N"); // Never nursing coverage.
    const { days, cell } = await exported(DEMO_SCHEDULE.id);
    const saved = await savedSheet();

    const assignments = await listAssignments(db, DEMO_SCHEDULE.id);
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
      // H–L are the hospital's own figures, whatever the schedule says.
      for (const column of ["H", "I", "J", "K", "L"])
        expect(cell(`${column}${row}`), `${column}${row}`).toBe(
          saved.getCell(`${column}${row}`).value ?? null,
        );
    }
    for (const row of [23, 24, 25])
      expect(days(row).slice(0, 30)).toEqual(
        savedDays(saved, row).slice(0, 30),
      );
    expect(days(10)[dayOf("2026-10-31") - 1]).toBe("ME");
  });

  it("a department that maps its statistics still gets them calculated", async () => {
    await upload(await departmentTemplate(), NICU_CALCULATED_MAPPING);
    await completeScheduleFixture(db, DEMO_SCHEDULE.id, [
      U.icuHead.id,
      U.icuNurse1.id,
    ]);
    await assign(U.icuNurse2.id, "2026-10-30", "H");
    await assign(U.icuNurse3.id, "2026-10-31", "ME"); // One shift; M and E coverage.
    await assign(secretaryId, "2026-11-01", "N"); // Never nursing coverage.
    const { days, cell } = await exported(DEMO_SCHEDULE.id);

    const assignments = await listAssignments(db, DEMO_SCHEDULE.id);
    const people = rowsOf();
    for (const { row, userId } of people) {
      const mine = assignments.filter((a) => a.nurseId === userId);
      // L: working shifts, ME once; K: H days; J: cleared.
      expect(cell(`L${row}`)).toBe(
        mine.filter((a) => ["M", "E", "N", "ME"].includes(a.shift)).length,
      );
      expect(cell(`K${row}`)).toBe(mine.filter((a) => a.shift === "H").length);
      expect(cell(`J${row}`)).toBeNull();
    }
    expect(cell("K9")).toBeGreaterThanOrEqual(1);
    // Daily coverage of the nurses (not the secretary): ME toward M and E.
    const nurses = new Set(
      people.filter((p) => p.userId !== secretaryId).map((p) => p.userId),
    );
    for (const date of periodDays(period)) {
      const codes = assignments
        .filter((a) => a.date === date && nurses.has(a.nurseId))
        .map((a) => a.shift);
      const d = dayOf(date) - 1;
      expect(days(23)[d]).toBe(
        codes.filter((c) => c === "M" || c === "ME").length,
      );
      expect(days(24)[d]).toBe(
        codes.filter((c) => c === "E" || c === "ME").length,
      );
      expect(days(25)[d]).toBe(codes.filter((c) => c === "N").length);
    }
  });

  it.each([
    [{ year: 1404, month: 12 }, 29, "اسفند\u200cماه 1404"],
    [{ year: 1405, month: 9 }, 30, "آذر\u200cماه 1405"],
    [{ year: 1405, month: 1 }, 31, "فروردین\u200cماه 1405"],
  ])(
    "a %j month (%i days): headings, weekdays, Fridays and days stop at its end",
    async (month, length, heading) => {
      await upload(await departmentTemplate());
      const monthPeriod = jalaliMonthPeriod(month);
      const created = ok(
        await createSchedule(head, {
          departmentId: DEMO_ICU.id,
          periodStart: monthPeriod.start,
          periodEnd: monthPeriod.end,
          label: "ماه آزمایشی",
        }),
      );
      await db.execute(
        sql`insert into schedule_roster (schedule_id, user_id, role, added_by) values (${created.scheduleId}, ${secretaryId}, 'SECRETARY', ${U.icuHead.id}) on conflict do nothing`,
      );
      await completeScheduleFixture(db, created.scheduleId);
      const { days, cell, highlighted } = await exported(created.scheduleId);
      const dates = periodDays(monthPeriod);
      expect(dates).toHaveLength(length);
      expect(cell("U3")).toBe(heading);
      expect(days(NICU_DAY_ROW).filter((v) => v !== null)).toEqual(
        Array.from({ length }, (_, i) => i + 1),
      );
      expect(days(NICU_WEEKDAY_ROW).slice(0, length)).toEqual(
        dates.map((d) => INITIAL[utcDay(d)]),
      );
      for (const row of [
        NICU_WEEKDAY_ROW,
        NICU_DAY_ROW,
        ...PEOPLE_ROWS,
        23,
        24,
        25,
      ]) {
        expect(
          days(row)
            .slice(length)
            .every((v) => v === null),
        ).toBe(true);
        if (row !== NICU_WEEKDAY_ROW && row !== NICU_DAY_ROW)
          expect(days(row).slice(0, length)).not.toContain("?");
      }
      for (const row of [...PEOPLE_ROWS, 23, 24, 25])
        expect(highlighted(row)).toEqual(fridays(dates));
      // Manual coverage: the month's days as saved, nothing past its end.
      const saved = await savedSheet();
      for (const row of [23, 24, 25])
        expect(days(row).slice(0, length), `row ${row}`).toEqual(
          savedDays(saved, row).slice(0, length),
        );
    },
  );

  it("repeated exports are byte for byte identical", async () => {
    await upload(await departmentTemplate());
    await completeScheduleFixture(db, DEMO_SCHEDULE.id);
    const first = await exportScheduleToExcel(head, {
      scheduleId: DEMO_SCHEDULE.id,
      calendar,
    });
    const second = await exportScheduleToExcel(head, {
      scheduleId: DEMO_SCHEDULE.id,
      calendar,
    });
    expect(second.bytes).toEqual(first.bytes);
  });

  it("keeps the stored mapping, calendar and holiday fill included", async () => {
    await upload(await departmentTemplate());
    const settings = await getExcelTemplateSettings(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(settings.template!.mapping).toEqual(NICU_MAPPING);
    expect(settings.template!.inspection).toMatchObject({
      valid: true,
      printArea: "A1:AS31",
    });
  });
});
