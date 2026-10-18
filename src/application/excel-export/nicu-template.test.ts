import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  dailyStatistic,
  personStatistic,
} from "../../domain/excel-export/statistics";
import {
  columnLetters,
  exportDayValues,
  exportHolidayColumns,
  exportPeriodRow,
  type ExcelTemplateMapping,
  type ExportCellValue,
} from "../../domain/excel-export/template-mapping";
import {
  addDays,
  dayOfWeek,
  isoDate,
  type IsoDate,
} from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import {
  patchXlsx,
  readWorkbook,
  sheetPart,
} from "../../../tests/support/excel-templates";
import {
  NICU_CALCULATED_MAPPING,
  NICU_DAY_ROW,
  NICU_FIRST_DAY,
  NICU_MAPPING,
  NICU_PERSONNEL_ROWS,
  NICU_SAVED_FRIDAYS,
  NICU_SECRETARY_ROW,
  NICU_SHEET,
  NICU_SUMMARY_ROWS,
  NICU_WEEKDAY_ROW,
  nicuNumber,
  nicuTemplate,
} from "../../../tests/support/nicu-template";
import {
  inspectExcelTemplate,
  populateExcelTemplate,
  templateRowLabels,
  writePersonnelColumn,
} from "./template-workbook";

/**
 * The sanitized NICU print workbook end to end (D124), built to the hospital
 * file's verified structure: personnel numbers in B, days in N–AR, weekdays
 * on row 5, day numbers on row 6, statistics in J–L, coverage on rows 23–25,
 * Mehr 1405's Fridays highlighted. The calendar values here come from ISO
 * dates; the Jalali adapter itself is tested in `features/excel-export`.
 */

let template: Uint8Array;
beforeAll(async () => {
  template = await nicuTemplate();
});

const sheetXml = (bytes: Uint8Array) =>
  strFromU8(unzipSync(bytes)[sheetPart(bytes, NICU_SHEET)]!);

/** Whole Jalali months by their first ISO day (verified with ICU). */
const MONTHS = {
  esfand1404: { start: isoDate("2026-02-20"), days: 29 },
  farvardin1405: { start: isoDate("2026-03-21"), days: 31 },
  mehr1405: { start: isoDate("2026-09-23"), days: 30 },
  aban1405: { start: isoDate("2026-10-23"), days: 30 },
  ordibehesht1406: { start: isoDate("2027-04-21"), days: 31 },
} as const;
type Month = (typeof MONTHS)[keyof typeof MONTHS];

/** Persian weekday initials by `dayOfWeek` (0 = Sunday). */
const INITIAL = ["ی", "د", "س", "چ", "پ", "ج", "ش"];
const datesOf = (month: Month): IsoDate[] =>
  Array.from({ length: month.days }, (_, i) => addDays(month.start, i));
const fridaysOf = (month: Month) =>
  datesOf(month).flatMap((d, i) => (dayOfWeek(d) === 5 ? [i + 1] : []));

/** A month of decisions: index 0 is day 1; null is undecided. */
const plan = (codes: readonly (AssignmentCode | null)[]) =>
  new Map(
    codes.flatMap((code, i) => (code === null ? [] : [[i + 1, code] as const])),
  );
const CYCLE = ["M", "E", "N", "OFF", "ME", "H"] as const;
const full = plan(Array.from({ length: 31 }, (_, i) => CYCLE[i % 6]!));

/** What the export use case writes, from decisions by template row. */
function exportMonth(
  month: Month,
  people: ReadonlyMap<number, ReadonlyMap<number, AssignmentCode>> = new Map(
    NICU_PERSONNEL_ROWS.map((row) => [row, full]),
  ),
  options: { bytes?: Uint8Array; mapping?: ExcelTemplateMapping } = {},
) {
  const mapping = options.mapping ?? NICU_MAPPING;
  const dates = datesOf(month);
  const n = month.days;
  const staffing = [...people]
    .filter(([row]) => row !== NICU_SECRETARY_ROW)
    .map(([, days]) => days);
  return populateExcelTemplate(
    options.bytes ?? template,
    mapping,
    new Map(
      [...people].map(([row, days]) => [
        nicuNumber(row),
        exportDayValues(n, days),
      ]),
    ),
    {
      statistics: new Map(
        [...people].map(([row, days]) => [
          nicuNumber(row),
          new Map(
            (mapping.statisticColumns ?? []).map((c) => [
              c.column,
              personStatistic(c.statistic, n, days),
            ]),
          ),
        ]),
      ),
      summaries: new Map(
        (mapping.summaryRows ?? []).map((s) => [
          s.row,
          dailyStatistic(s.statistic, n, staffing),
        ]),
      ),
      dayHeader: exportPeriodRow(n, (i) => i + 1),
      weekdays: exportPeriodRow(n, (i) => INITIAL[dayOfWeek(dates[i]!)]!),
      monthHeading: "ماه آزمایشی 1405",
      holidays: exportHolidayColumns(dates),
    },
  );
}

const read = async (bytes: Uint8Array) =>
  (await readWorkbook(bytes)).getWorksheet(NICU_SHEET)!;
type Sheet = Awaited<ReturnType<typeof read>>;
const days = (sheet: Sheet, row: number) =>
  Array.from(
    { length: 31 },
    (_, i) => sheet.getCell(row, NICU_FIRST_DAY + i).value ?? null,
  );
/** The theme colour of a cell's fill: 3 is the holiday fill, 0 white. */
const fillTheme = (sheet: Sheet, row: number, column: number) =>
  (
    (sheet.getCell(row, column).fill as { fgColor?: { theme?: number } })
      ?.fgColor ?? {}
  ).theme;
/** The days of `row` painted with the holiday fill. */
const highlighted = (sheet: Sheet, row: number) =>
  Array.from({ length: 31 }, (_, i) => i + 1).filter(
    (day) => fillTheme(sheet, row, NICU_FIRST_DAY + day - 1) === 3,
  );
const BODY_ROWS = [...NICU_PERSONNEL_ROWS, ...NICU_SUMMARY_ROWS];

describe("the NICU template as approved", () => {
  it("validates with personnel matched strictly from column B", () => {
    const inspection = inspectExcelTemplate(template, NICU_MAPPING);
    expect(inspection.errors).toEqual([]);
    expect(inspection.valid).toBe(true);
    expect(
      inspection.personnel.map((p) => [p.cell, p.personnelNumber]),
    ).toEqual(NICU_PERSONNEL_ROWS.map((row) => [`B${row}`, nicuNumber(row)]));
    expect(inspection.personnelColumnHidden).toBe(false);
    expect(inspection.dayRange).toBe("N7:AR22");
    // Day 31 (AR) is inside A1:AS31: the only notice is about the header fill.
    expect(inspection.printArea).toBe("A1:AS31");
    expect(inspection.warnings).toEqual([
      {
        message: expect.stringContaining("در ردیف‌های 5، 6 رنگ روز عادی"),
      },
    ]);
  });

  it("warns that day 31 does not print when the print area stops at AQ", async () => {
    const narrow = await nicuTemplate({ printArea: "A1:AQ31" });
    const inspection = inspectExcelTemplate(narrow, NICU_MAPPING);
    expect(inspection.valid).toBe(true);
    expect(inspection.warnings).toContainEqual({
      cell: "AR6",
      message: expect.stringContaining("روزهای 31"),
    });
  });

  it("warns that the saved month's Fridays stay put without a holiday fill", () => {
    const inspection = inspectExcelTemplate(template, {
      ...NICU_MAPPING,
      holidayFillCell: null,
      normalFillColumn: null,
    });
    expect(inspection.valid).toBe(true);
    expect(inspection.warnings).toEqual([
      {
        cell: "P7",
        message: expect.stringContaining("P، W، AD، AK"),
      },
    ]);
  });

  const patched = (edit: (xml: string) => string) =>
    patchXlsx(template, {
      [sheetPart(template, NICU_SHEET)]: edit(sheetXml(template)),
    });
  const withMerge = (ref: string) => (xml: string) =>
    xml.includes("<mergeCells")
      ? xml.replace("</mergeCells>", `<mergeCell ref="${ref}"/></mergeCells>`)
      : xml.replace(
          "</sheetData>",
          `</sheetData><mergeCells count="1"><mergeCell ref="${ref}"/></mergeCells>`,
        );
  const cellValue = (address: string, inner: string) => (xml: string) =>
    xml.replace(
      new RegExp(`<c r="${address}"([^>]*?)(?:/>|>.*?</c>)`),
      `<c r="${address}"$1${inner}`,
    );

  it.each<
    [string, (xml: string) => string, Partial<ExcelTemplateMapping>, string]
  >([
    [
      "a formula in a statistic cell the mapping writes",
      cellValue("L9", "><f>SUM(N9:AR9)</f><v>3</v></c>"),
      { statisticColumns: NICU_CALCULATED_MAPPING.statisticColumns },
      "L9",
    ],
    [
      "hospital text in a manual coverage row",
      cellValue("S24", ' t="inlineStr"><is><t>abc</t></is></c>'),
      {},
      "S24",
    ],
    [
      "a formula in a manual coverage row",
      cellValue("S25", "><f>SUM(N23:N24)</f><v>3</v></c>"),
      {},
      "S25",
    ],
    ["a merge over a summary row", withMerge("N24:O24"), {}, "N24:O24"],
    ["a merge over the weekday row", withMerge("Q5:R5"), {}, "Q5:R5"],
    [
      "a formula in the weekday row",
      cellValue("S5", "><f>TODAY()</f><v>1</v></c>"),
      {},
      "S5",
    ],
    [
      "a number in the weekday row",
      cellValue("S5", ' t="inlineStr"><is><t>12</t></is></c>'),
      {},
      "S5",
    ],
    [
      "text in the day-number row",
      cellValue("S6", ' t="inlineStr"><is><t>روز</t></is></c>'),
      {},
      "S6",
    ],
    [
      "a signature as the month heading",
      (x) => x,
      { monthHeadingCell: "V28" },
      "V28",
    ],
    [
      "the hospital title as the month heading",
      (x) => x,
      { monthHeadingCell: "X1" },
      "X1",
    ],
    [
      "the contract column (text) as a statistic",
      (x) => x,
      { statisticColumns: [{ column: "M", statistic: "CLEAR" }] },
      "M7",
    ],
    [
      "a holiday fill cell without a fill",
      (x) => x,
      { holidayFillCell: "A1" },
      "A1",
    ],
    [
      "a normal column that is itself a Friday",
      (x) => x,
      { normalFillColumn: "P" },
      "P7",
    ],
  ])("rejects %s", (_, edit, patch, cell) => {
    const inspection = inspectExcelTemplate(patched(edit), {
      ...NICU_MAPPING,
      ...patch,
    });
    expect(inspection.valid).toBe(false);
    expect(inspection.errors[0]).toMatchObject({ cell });
  });

  it("allows a month heading at the top-left of a merge, never inside one", () => {
    const anchored = patched(withMerge("U3:AA3"));
    expect(inspectExcelTemplate(anchored, NICU_MAPPING).errors).toEqual([]);
    const inside = patched(withMerge("T3:AA3"));
    expect(inspectExcelTemplate(inside, NICU_MAPPING).errors).toEqual([
      expect.objectContaining({ cell: "T3:AA3" }),
    ]);
  });

  it("refuses a summary row that holds a personnel number", () => {
    const inspection = inspectExcelTemplate(template, {
      ...NICU_MAPPING,
      summaryRows: [{ row: 8, statistic: "COVERAGE_M" }],
    });
    expect(inspection.errors).toEqual([
      expect.objectContaining({ cell: "B8" }),
    ]);
  });
});

describe("exporting into the NICU template", () => {
  it("writes M/E/N/ME/H, OFF blank, undecided ?, the secretary and the statistics", async () => {
    const people = new Map(NICU_PERSONNEL_ROWS.map((row) => [row, full]));
    people.set(8, plan(["ME", null, "OFF", "H", "ME"]));
    const sheet = await read(exportMonth(MONTHS.mehr1405, people));
    expect(days(sheet, 7).slice(0, 7)).toEqual([
      "M",
      "E",
      "N",
      null,
      "ME",
      "H",
      "M",
    ]);
    expect(days(sheet, 7)[30]).toBeNull(); // Mehr has 30 days.
    expect(days(sheet, 8).slice(0, 6)).toEqual([
      "ME",
      "?",
      null,
      "H",
      "ME",
      "?",
    ]);
    expect(days(sheet, NICU_SECRETARY_ROW).slice(0, 3)).toEqual([
      "M",
      "E",
      "N",
    ]);
    // The hand-maintained statistics (H–L) are exactly the template's.
    const before = await read(template);
    for (const row of NICU_PERSONNEL_ROWS)
      for (const column of ["H", "I", "J", "K", "L", "M"])
        expect(
          sheet.getCell(`${column}${row}`).value,
          `${column}${row}`,
        ).toEqual(before.getCell(`${column}${row}`).value);
    // So are the manual coverage rows, on the month's days.
    for (const row of NICU_SUMMARY_ROWS)
      expect(days(sheet, row).slice(0, 29)).toEqual(
        days(before, row).slice(0, 29),
      );
  });

  it("calculates the statistics and coverage when a department maps them (generic capability)", async () => {
    const people = new Map(NICU_PERSONNEL_ROWS.map((row) => [row, full]));
    people.set(8, plan(["ME", null, "OFF", "H", "ME"]));
    const sheet = await read(
      exportMonth(MONTHS.mehr1405, people, {
        mapping: NICU_CALCULATED_MAPPING,
      }),
    );
    // J (contractual hours) cleared; K leave days; L shifts with ME counted once.
    const fullMonth = Array.from({ length: 30 }, (_, i) => CYCLE[i % 6]!);
    expect(
      ["J7", "K7", "L7"].map((a) => sheet.getCell(a).value ?? null),
    ).toEqual([
      null,
      fullMonth.filter((c) => c === "H").length,
      fullMonth.filter((c) => c !== "OFF" && c !== "H").length,
    ]);
    expect(sheet.getCell("L7").value).toBe(20); // 5 each of M, E, N, ME.
    expect(
      ["J8", "K8", "L8"].map((a) => sheet.getCell(a).value ?? null),
    ).toEqual([null, "?", "?"]);
    // Coverage rows: ? while someone counted is undecided, ME toward M and E.
    expect(days(sheet, 23)[1]).toBe("?");
    expect(days(sheet, 23)[0]).toBe(15); // Fourteen nurses on M plus one ME.
    expect(days(sheet, 24)[0]).toBe(1); // The ME.
    expect(days(sheet, 25)[30]).toBeNull();
    // Statistics the mapping does not name (H, I, M) are still untouched.
    const before = await read(template);
    for (const column of ["H", "I", "M"])
      expect(sheet.getCell(`${column}7`).value).toEqual(
        before.getCell(`${column}7`).value,
      );
  });

  it.each([
    ["Esfand 1404 (29 days)", MONTHS.esfand1404],
    ["Mehr 1405 (30 days)", MONTHS.mehr1405],
    ["Farvardin 1405 (31 days)", MONTHS.farvardin1405],
  ] as const)(
    "%s: manual coverage keeps the month's days and clears the rest",
    async (_, month) => {
      const before = await read(template);
      const sheet = await read(exportMonth(month));
      for (const row of NICU_SUMMARY_ROWS) {
        const was = days(before, row);
        const now = days(sheet, row);
        expect(now.slice(0, month.days), `row ${row}`).toEqual(
          was.slice(0, month.days),
        );
        expect(now.slice(month.days), `row ${row}`).toEqual(
          Array(31 - month.days).fill(null),
        );
      }
      // The saved day 31 («3») is gone from a shorter month, kept in a 31-day one.
      expect(sheet.getCell("AR23").value ?? null).toBe(
        month.days === 31 ? (before.getCell("AR23").value ?? null) : null,
      );
    },
  );

  it("changes only the style of a manual cell: its value and type bytes stay", () => {
    const cellOf = (xml: string, ref: string) =>
      new RegExp(`<c r="${ref}"[^>]*?(?:/>|>.*?</c>)`).exec(xml)![0];
    const body = (cell: string) => cell.replace(/\ss="\d+"/, "");
    const exported = sheetXml(exportMonth(MONTHS.aban1405));
    const saved = sheetXml(template);
    const style = (cell: string) => /\ss="(\d+)"/.exec(cell)?.[1];
    let restyled = 0;
    for (const row of NICU_SUMMARY_ROWS)
      for (let day = 1; day <= 29; day++) {
        const ref = `${columnLetters(NICU_FIRST_DAY + day - 1)}${row}`;
        const [before, after] = [cellOf(saved, ref), cellOf(exported, ref)];
        expect(body(after), ref).toBe(body(before));
        if (style(after) !== style(before)) restyled++;
      }
    // Aban's Fridays (1, 8, 15, 22, 29) differ from Mehr's (3, 10, 17, 24).
    expect(restyled).toBe(NICU_SUMMARY_ROWS.length * 9);
  });

  it("never empties a manual row for which no values were supplied", async () => {
    const bytes = populateExcelTemplate(template, NICU_MAPPING, new Map());
    const before = await read(template);
    const sheet = await read(bytes);
    for (const row of NICU_SUMMARY_ROWS)
      expect(days(sheet, row)).toEqual(days(before, row));
  });

  it.each([
    ["Esfand 1404", MONTHS.esfand1404, "ج ش ی د س چ پ"],
    ["Mehr 1405", MONTHS.mehr1405, "چ پ ج ش ی د س"],
    ["Farvardin 1405", MONTHS.farvardin1405, "ش ی د س چ پ ج"],
  ] as const)(
    "%s: day numbers, weekdays and heading stop at the month's end",
    async (_, month, firstWeek) => {
      const sheet = await read(exportMonth(month));
      expect(sheet.getCell("U3").value).toBe("ماه آزمایشی 1405");
      expect(days(sheet, NICU_DAY_ROW).filter((v) => v !== null)).toEqual(
        Array.from({ length: month.days }, (_, i) => i + 1),
      );
      expect(days(sheet, NICU_WEEKDAY_ROW).slice(0, 7).join(" ")).toBe(
        firstWeek,
      );
      for (const row of [NICU_WEEKDAY_ROW, NICU_DAY_ROW, ...BODY_ROWS]) {
        expect(days(sheet, row).slice(month.days), `row ${row}`).toEqual(
          Array(31 - month.days).fill(null),
        );
        // Generated rows fill the month's last day; the hand-maintained
        // coverage rows keep whatever the hospital typed (day 30 is empty in
        // the hospital's file).
        if (!(NICU_SUMMARY_ROWS as readonly number[]).includes(row))
          expect(days(sheet, row)[month.days - 1], `row ${row}`).not.toBeNull();
      }
      // The template's day 31 heading and its stale day-31 counts are gone.
      if (month.days < 31) expect(sheet.getCell("AR6").value).toBeNull();
    },
  );

  it.each([
    ["Mehr 1405 (the saved month)", MONTHS.mehr1405],
    ["Aban 1405", MONTHS.aban1405],
    ["Esfand 1404", MONTHS.esfand1404],
    ["Ordibehesht 1406 (Friday the 31st)", MONTHS.ordibehesht1406],
  ] as const)(
    "%s: exactly its Fridays get the holiday fill",
    async (_, month) => {
      const sheet = await read(exportMonth(month));
      const fridays = fridaysOf(month);
      for (const row of BODY_ROWS)
        expect(highlighted(sheet, row), `row ${row}`).toEqual(fridays);
      // The weekday is Friday wherever the fill is.
      for (const day of fridays)
        expect(days(sheet, NICU_WEEKDAY_ROW)[day - 1]).toBe("ج");
      // The header rows have the holiday fill on every day in this template.
      for (const row of [NICU_WEEKDAY_ROW, NICU_DAY_ROW])
        expect(highlighted(sheet, row)).toHaveLength(31);
    },
  );

  it("never carries the saved month's Fridays into another month", async () => {
    const sheet = await read(exportMonth(MONTHS.aban1405));
    expect(fridaysOf(MONTHS.aban1405)).toEqual([1, 8, 15, 22, 29]);
    for (const day of NICU_SAVED_FRIDAYS)
      for (const row of BODY_ROWS)
        expect(fillTheme(sheet, row, NICU_FIRST_DAY + day - 1)).toBe(0);
    // A 29-day month: day 30 and 31 columns get the normal fill too.
    const esfand = await read(exportMonth(MONTHS.esfand1404));
    expect(highlighted(esfand, 7)).toEqual([1, 8, 15, 22, 29]);
  });

  it("changes only fills: borders, fonts, alignment and every other part stay", async () => {
    const before = await read(template);
    for (const month of [MONTHS.aban1405, MONTHS.esfand1404]) {
      const bytes = exportMonth(month);
      const after = await read(bytes);
      for (const row of [NICU_WEEKDAY_ROW, NICU_DAY_ROW, ...BODY_ROWS])
        for (let day = 1; day <= 31; day++) {
          const a = after.getCell(row, NICU_FIRST_DAY + day - 1);
          const b = before.getCell(row, NICU_FIRST_DAY + day - 1);
          const where = `${columnLetters(NICU_FIRST_DAY + day - 1)}${row}`;
          expect(a.border, where).toEqual(b.border);
          expect(a.font, where).toEqual(b.font);
          expect(a.alignment, where).toEqual(b.alignment);
          expect(a.numFmt, where).toEqual(b.numFmt);
        }
      // Only the worksheet and, for new fill combinations, styles.xml change.
      const parts = unzipSync(bytes);
      const source = unzipSync(template);
      const changed = Object.keys(source).filter(
        (name) => strFromU8(parts[name]!) !== strFromU8(source[name]!),
      );
      expect(changed.filter((n) => n !== "xl/styles.xml")).toEqual([
        sheetPart(template, NICU_SHEET),
      ]);
      // styles.xml: formats are only appended to <cellXfs>.
      if (changed.includes("xl/styles.xml")) {
        const strip = (xml: string) =>
          xml.replace(
            /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/,
            (_m, inner: string) =>
              inner.slice(
                0,
                strFromU8(source["xl/styles.xml"]!).match(
                  /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/,
                )![1]!.length,
              ),
          );
        expect(strip(strFromU8(parts["xl/styles.xml"]!))).toBe(
          strip(strFromU8(source["xl/styles.xml"]!)),
        );
      }
    }
  });

  it("reproduces the saved month's own styles exactly (styles.xml untouched)", () => {
    const parts = unzipSync(exportMonth(MONTHS.mehr1405));
    expect(parts["xl/styles.xml"]).toEqual(
      unzipSync(template)["xl/styles.xml"],
    );
  });

  it("keeps the print layout, titles, notes, signatures and stray cells", async () => {
    const bytes = exportMonth(MONTHS.farvardin1405);
    const before = await read(template);
    const after = await read(bytes);
    expect(after.pageSetup).toEqual(before.pageSetup);
    expect(after.views).toEqual(before.views);
    expect(sheetXml(bytes)).toContain(
      '<colBreaks count="1" manualBreakCount="1"><brk id="51" max="1048575" man="1"/></colBreaks>',
    );
    for (const c of [
      1,
      2,
      3,
      NICU_FIRST_DAY,
      NICU_FIRST_DAY + 30,
      47,
      49,
      50,
    ]) {
      expect(after.getColumn(c).width).toBe(before.getColumn(c).width);
      expect(after.getColumn(c).hidden).toBe(before.getColumn(c).hidden);
    }
    for (const r of [1, 3, 5, 6, 7, 22, 25])
      expect(after.getRow(r).height).toBe(before.getRow(r).height);
    for (const address of [
      "X1",
      "A2",
      "A3",
      "N3",
      "AM3",
      "C24",
      "C25",
      "C26",
      "F26",
      "G26",
      "C27",
      "F27",
      "N27",
      "G29",
      "V28",
      "AD28",
      "AK28",
      "AZ23",
      "BA42",
      "A7",
      "B7",
      "C7",
      "D7",
      "E22",
      "H7",
      "I7",
      "J7",
      "K7",
      "L7",
      "L22",
      "M7",
    ])
      expect(after.getCell(address).value, address).toEqual(
        before.getCell(address).value,
      );
  });

  it("is deterministic: the same month exported twice is byte for byte equal", () => {
    expect(exportMonth(MONTHS.aban1405)).toEqual(exportMonth(MONTHS.aban1405));
  });

  it("clears a template row whose person is not exported", async () => {
    const people = new Map(
      NICU_PERSONNEL_ROWS.filter((r) => r !== 21).map((r) => [r, full]),
    );
    const sheet = await read(exportMonth(MONTHS.mehr1405, people));
    expect(days(sheet, 21).every((v) => v === null)).toBe(true);
    // The hand-maintained statistics of that row stay as the template has them.
    const before = await read(template);
    expect(
      ["H21", "I21", "J21", "K21", "L21"].map((a) => sheet.getCell(a).value),
    ).toEqual(
      ["H21", "I21", "J21", "K21", "L21"].map((a) => before.getCell(a).value),
    );
    // Its cells still follow the month's Fridays.
    expect(highlighted(sheet, 21)).toEqual(fridaysOf(MONTHS.mehr1405));
  });

  it("accepts last month's export as a template only while its holiday cell is highlighted", () => {
    const bytes = exportMonth(
      MONTHS.mehr1405,
      new Map(NICU_PERSONNEL_ROWS.map((r) => [r, plan(["M", null, "H"])])),
    );
    expect(inspectExcelTemplate(bytes, NICU_MAPPING).errors).toEqual([]);
    // The holiday fill cell must hold the holiday fill in the uploaded file:
    // in Aban's export P7 (day 3) is a working day.
    const aban = exportMonth(MONTHS.aban1405);
    expect(inspectExcelTemplate(aban, NICU_MAPPING).errors).toEqual([
      expect.objectContaining({ cell: "P7" }),
    ]);
  });

  it("repaints the table's empty rows, never an unformatted one", async () => {
    const few = await nicuTemplate({ peopleRows: [7, 8, NICU_SECRETARY_ROW] });
    const part = sheetPart(few, NICU_SHEET);
    // Row 21 removed altogether: nothing may be painted where nothing was.
    const bytes = patchXlsx(few, {
      [part]: sheetXml(few).replace(/<row r="21"[\s\S]*?<\/row>/, ""),
    });
    const people = new Map(
      [7, 8, NICU_SECRETARY_ROW].map((row) => [row, full] as const),
    );
    const exported = exportMonth(MONTHS.aban1405, people, { bytes });
    expect(sheetXml(exported)).not.toContain('<row r="21"');
    const sheet = await read(exported);
    for (const row of [9, 15, 20])
      expect(highlighted(sheet, row), `row ${row}`).toEqual(
        fridaysOf(MONTHS.aban1405),
      );
    expect(days(sheet, 15).every((v) => v === null)).toBe(true);
  });

  it("leaves fills alone when the mapping has no holiday fill", async () => {
    const mapping = {
      ...NICU_MAPPING,
      holidayFillCell: null,
      normalFillColumn: null,
    };
    const sheet = await read(
      exportMonth(MONTHS.aban1405, undefined, { mapping }),
    );
    expect(highlighted(sheet, 7)).toEqual([...NICU_SAVED_FRIDAYS]);
  });

  it("refuses holiday flags that are not 31 days", () => {
    expect(() =>
      populateExcelTemplate(template, NICU_MAPPING, new Map(), {
        holidays: [true],
      }),
    ).toThrow(RangeError);
  });

  it("creates a mapped summary row the sheet does not have yet, in row order", async () => {
    const bytes = populateExcelTemplate(
      template,
      { ...NICU_MAPPING, summaryRows: [{ row: 30, statistic: "COVERAGE_N" }] },
      new Map(),
      { summaries: new Map([[30, Array<ExportCellValue>(31).fill(2)]]) },
    );
    const xml = sheetXml(bytes);
    expect(xml.indexOf('<row r="30">')).toBeGreaterThan(
      xml.indexOf('<row r="29"'),
    );
    expect(xml.indexOf('<row r="30">')).toBeLessThan(
      xml.indexOf('<row r="42"'),
    );
    const sheet = await read(bytes);
    expect(sheet.getCell("N30").value).toBe(2);
    expect(sheet.getCell("AR30").value).toBe(2);
  });
});

/** DOS date/time of every central-directory entry of a ZIP. */
function entryTimes(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const times: { time: number; date: number }[] = [];
  for (let at = 0; at + 46 <= bytes.length; at++)
    if (view.getUint32(at, true) === 0x02014b50)
      times.push({
        time: view.getUint16(at + 12, true),
        date: view.getUint16(at + 14, true),
      });
  return times;
}

describe("deterministic output", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("identical inputs give byte-identical files, whatever the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-05-05T10:00:01Z"));
    const first = exportMonth(MONTHS.aban1405);
    vi.setSystemTime(new Date("2031-11-30T23:59:58Z"));
    const second = exportMonth(MONTHS.aban1405);
    expect(second).toEqual(first);
  });

  it("every entry carries the fixed ZIP epoch, in any server timezone", () => {
    const bytes = new Map<string, Uint8Array>();
    for (const tz of [
      "UTC",
      "Asia/Tehran",
      "Pacific/Kiritimati",
      "America/Adak",
    ]) {
      process.env.TZ = tz;
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2030-06-15T12:34:56Z"));
      bytes.set(tz, exportMonth(MONTHS.mehr1405));
      vi.useRealTimers();
    }
    const [reference, ...others] = [...bytes.values()];
    for (const other of others) expect(other).toEqual(reference);
    const times = entryTimes(reference!);
    expect(times.length).toBe(Object.keys(unzipSync(reference!)).length);
    // 1980-01-01 00:00:00: date (0 << 9) | (1 << 5) | 1.
    for (const t of times) expect(t).toEqual({ time: 0, date: 0x21 });
  });

  it("also holds for the personnel-column preparation tool", async () => {
    const bare = await nicuTemplate({ numbers: false });
    const prepare = () =>
      writePersonnelColumn(bare, {
        sheetName: NICU_SHEET,
        column: "BL",
        numbers: new Map([[7, "1"]]),
      });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const first = prepare();
    vi.setSystemTime(new Date("2032-02-02T08:09:10Z"));
    expect(prepare()).toEqual(first);
  });
});

describe("a workbook without personnel numbers (preparation tool)", () => {
  let bare: Uint8Array;
  beforeAll(async () => {
    bare = await nicuTemplate({ numbers: false });
  });
  const numbers = new Map(
    NICU_PERSONNEL_ROWS.map((row) => [row, nicuNumber(row)]),
  );
  const BL = { ...NICU_MAPPING, personnelColumn: "BL" };

  it("cannot be activated as is", () => {
    const inspection = inspectExcelTemplate(bare, NICU_MAPPING);
    expect(inspection.valid).toBe(false);
    expect(inspection.personnel).toEqual([]);
  });

  it("lists each row's printed text for choosing its person (never matched by name)", () => {
    const labels = templateRowLabels(bare, NICU_MAPPING);
    expect(labels.map((l) => l.row)).toEqual([...NICU_PERSONNEL_ROWS]);
    expect(labels[0]!.label).toContain("نام1 · خانوادگی1 · سرپرستار");
  });

  it("writes the numbers as text in a hidden column without moving anything", async () => {
    const prepared = writePersonnelColumn(bare, {
      sheetName: NICU_SHEET,
      column: "BL",
      numbers,
    });
    const inspection = inspectExcelTemplate(prepared, BL);
    expect(inspection.errors).toEqual([]);
    expect(inspection.personnelColumnHidden).toBe(true);
    const before = unzipSync(bare);
    const after = unzipSync(prepared);
    const part = sheetPart(bare, NICU_SHEET);
    for (const name of Object.keys(before))
      if (name !== part) expect(after[name], name).toEqual(before[name]);
    const strip = (xml: string) =>
      xml
        .replace(/<c r="BL\d+"[^>]*>.*?<\/c>/g, "")
        .replace(/<col min="64" max="64"[^>]*\/>/, "")
        .replace(/<dimension ref="[^"]*"\/>/, "")
        .replace(/<row r="(\d+)"[^>]*>/g, '<row r="$1">');
    expect(strip(sheetXml(prepared))).toBe(strip(sheetXml(bare)));
    const sheet = await read(prepared);
    expect(sheet.getCell("BL22").value).toBe("07022");
    expect(sheet.getColumn("BL").hidden).toBe(true);
  });

  it("splits a <col> range that spans the column", () => {
    const part = sheetPart(bare, NICU_SHEET);
    const xml = sheetXml(bare).replace(
      /<cols>[\s\S]*?<\/cols>/,
      '<cols><col min="54" max="56" width="9" style="3" customWidth="1"/></cols>',
    );
    const bytes = writePersonnelColumn(patchXlsx(bare, { [part]: xml }), {
      sheetName: NICU_SHEET,
      column: "BC",
      numbers: new Map([[7, "1"]]),
    });
    expect(sheetXml(bytes)).toContain(
      '<cols><col min="54" max="54" width="9" style="3" customWidth="1"/><col min="55" max="55" width="9" style="3" customWidth="1" hidden="1"/><col min="56" max="56" width="9" style="3" customWidth="1"/></cols>',
    );
  });

  it("adds <cols> when the sheet has none", () => {
    const part = sheetPart(bare, NICU_SHEET);
    const xml = sheetXml(bare).replace(/<cols>[\s\S]*?<\/cols>/, "");
    const bytes = writePersonnelColumn(patchXlsx(bare, { [part]: xml }), {
      sheetName: NICU_SHEET,
      column: "BL",
      numbers: new Map([[7, "1"]]),
    });
    expect(sheetXml(bytes)).toMatch(
      /<cols><col min="64" max="64" width="[\d.]+" customWidth="1" hidden="1"\/><\/cols><sheetData>/,
    );
  });

  it.each([
    ["C", "خالی نیست"], // It holds the first names.
    ["BE", "ادغام"], // Empty, but crossed by the merge added below.
  ])("refuses column %s (%s)", (column, message) => {
    const part = sheetPart(bare, NICU_SHEET);
    const xml = sheetXml(bare).replace(
      "</sheetData>",
      '</sheetData><mergeCells count="1"><mergeCell ref="BD40:BF40"/></mergeCells>',
    );
    expect(() =>
      writePersonnelColumn(patchXlsx(bare, { [part]: xml }), {
        sheetName: NICU_SHEET,
        column,
        numbers: new Map([[7, "1"]]),
      }),
    ).toThrow(message);
  });

  it("refuses an unknown sheet, a bad column and no rows", () => {
    const write = (sheetName: string, column: string, rows = 1) =>
      writePersonnelColumn(bare, {
        sheetName,
        column,
        numbers: new Map(rows ? [[7, "1"]] : []),
      });
    expect(() => write("Sheet9", "BL")).toThrow(ValidationError);
    expect(() => write(NICU_SHEET, "7")).toThrow(ValidationError);
    expect(() => write(NICU_SHEET, "BL", 0)).toThrow(ValidationError);
  });
});
