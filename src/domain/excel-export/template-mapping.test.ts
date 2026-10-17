import { describe, expect, it } from "vitest";

import { addDays, isoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import type { AssignmentCode } from "../shifts/shift-type";
import {
  EXCEL_EXPORT_VALUES,
  EXCEL_UNDECIDED_VALUE,
  cellAddress,
  columnIndex,
  columnLetters,
  exportDayValues,
  exportHolidayColumns,
  exportPeriodRow,
  parseCellAddress,
  requireTemplateMapping,
  resolveTemplateMapping,
  storedTemplateMapping,
  type ExcelTemplateMapping,
  type PersonStatistic,
} from "./template-mapping";

const mapping: ExcelTemplateMapping = {
  sheetName: " Sheet1 ",
  personnelColumn: "b",
  firstRow: 7,
  lastRow: 40,
  firstDayColumn: "m",
};

describe("column letters", () => {
  it.each([
    ["A", 1],
    ["Z", 26],
    ["AA", 27],
    ["AQ", 43],
    ["XFD", 16_384],
  ])("%s is column %i and back", (letters, index) => {
    expect(columnIndex(letters)).toBe(index);
    expect(columnLetters(index)).toBe(letters);
  });

  it.each(["", "1", "A1", "XFE", "ZZZZ", "Ä"])("rejects %j", (value) => {
    expect(columnIndex(value)).toBeNull();
  });

  it.each([0, 16_385, 1.5])("refuses index %d", (index) => {
    expect(() => columnLetters(index)).toThrow(RangeError);
  });

  it("builds addresses", () => {
    expect(cellAddress(13, 7)).toBe("M7");
  });
});

describe("resolveTemplateMapping", () => {
  it("normalizes letters and the sheet name and computes the 31 day columns", () => {
    const result = resolveTemplateMapping(mapping);
    expect(result).toEqual({
      ok: true,
      value: {
        sheetName: "Sheet1",
        personnelColumn: "B",
        firstRow: 7,
        lastRow: 40,
        firstDayColumn: "M",
        personnelColumnIndex: 2,
        firstDayColumnIndex: 13,
        lastDayColumnIndex: 43,
        dayHeaderRow: null,
        statisticColumns: [],
        summaryRows: [],
        weekdayRow: null,
        weekdayFormat: "LONG",
        monthHeadingCell: null,
        holidayFillCell: null,
        normalFillColumn: null,
        monthHeading: null,
        holidayFill: null,
      },
    });
  });

  /**
   * The NICU print layout (D124): numbers in B, totals in J–L, days N–AR,
   * weekdays on row 5, day numbers on row 6, summaries under the people.
   */
  const nicu: ExcelTemplateMapping = {
    sheetName: "Sheet2",
    personnelColumn: "B",
    firstRow: 7,
    lastRow: 22,
    firstDayColumn: "N",
    dayHeaderRow: 6,
    statisticColumns: [
      { column: "j", statistic: "CLEAR" },
      { column: "K", statistic: "LEAVE_DAYS" },
      { column: "L", statistic: "SHIFT_COUNT" },
    ],
    summaryRows: [
      { row: 21, statistic: "CLEAR" },
      { row: 23, statistic: "COVERAGE_M" },
    ],
    weekdayRow: 5,
    weekdayFormat: "NARROW",
    monthHeadingCell: "u3",
    holidayFillCell: "p7",
    normalFillColumn: "o",
  };

  it("resolves statistics, summaries, calendar rows, heading and fills", () => {
    const resolved = requireTemplateMapping(nicu);
    expect(resolved.lastDayColumnIndex).toBe(columnIndex("AR"));
    expect(resolved.dayHeaderRow).toBe(6);
    expect(resolved.statisticColumns).toEqual([
      { column: "J", statistic: "CLEAR", columnIndex: 10 },
      { column: "K", statistic: "LEAVE_DAYS", columnIndex: 11 },
      { column: "L", statistic: "SHIFT_COUNT", columnIndex: 12 },
    ]);
    // A summary row may sit inside the personnel block (row 21).
    expect(resolved.summaryRows.map((r) => r.row)).toEqual([21, 23]);
    expect(resolved.weekdayRow).toBe(5);
    expect(resolved.weekdayFormat).toBe("NARROW");
    expect(resolved.monthHeading).toEqual({ cell: "U3", column: 21, row: 3 });
    expect(resolved.holidayFill).toEqual({
      holidayCell: { cell: "P7", column: 16, row: 7 },
      normalColumn: "O",
      normalColumnIndex: 15,
    });
    expect(storedTemplateMapping(resolved)).toEqual({
      ...nicu,
      statisticColumns: [
        { column: "J", statistic: "CLEAR" },
        { column: "K", statistic: "LEAVE_DAYS" },
        { column: "L", statistic: "SHIFT_COUNT" },
      ],
      monthHeadingCell: "U3",
      holidayFillCell: "P7",
      normalFillColumn: "O",
    });
  });

  it("resolves a resolved mapping to the same mapping (the export re-checks it)", () => {
    const resolved = requireTemplateMapping(nicu);
    expect(requireTemplateMapping(resolved)).toEqual(resolved);
  });

  it("defaults the weekday format and leaves the calendar features off", () => {
    const resolved = requireTemplateMapping(mapping);
    expect(storedTemplateMapping(resolved)).toMatchObject({
      weekdayRow: null,
      weekdayFormat: "LONG",
      monthHeadingCell: null,
      holidayFillCell: null,
      normalFillColumn: null,
    });
    expect(
      requireTemplateMapping({
        ...mapping,
        monthHeadingCell: "",
        holidayFillCell: " ",
        normalFillColumn: null,
      }).holidayFill,
    ).toBeNull();
  });

  it.each<[Partial<ExcelTemplateMapping>, keyof ExcelTemplateMapping]>([
    [{ dayHeaderRow: 0 }, "dayHeaderRow"],
    [{ dayHeaderRow: 7 }, "dayHeaderRow"],
    [{ weekdayRow: 0 }, "weekdayRow"],
    [{ weekdayRow: 8 }, "weekdayRow"],
    [{ weekdayRow: 6 }, "weekdayRow"],
    [{ weekdayFormat: "SHORT" as never }, "weekdayFormat"],
    [{ summaryRows: [{ row: 5, statistic: "COVERAGE_M" }] }, "summaryRows"],
    [{ monthHeadingCell: "U" }, "monthHeadingCell"],
    [{ monthHeadingCell: "U0" }, "monthHeadingCell"],
    [{ monthHeadingCell: "C9" }, "monthHeadingCell"],
    [{ monthHeadingCell: "P6" }, "monthHeadingCell"],
    [{ monthHeadingCell: "P5" }, "monthHeadingCell"],
    [{ monthHeadingCell: "P23" }, "monthHeadingCell"],
    [{ holidayFillCell: null }, "holidayFillCell"],
    [{ holidayFillCell: "P" }, "holidayFillCell"],
    [{ normalFillColumn: null }, "normalFillColumn"],
    [{ normalFillColumn: "M" }, "normalFillColumn"],
    [{ normalFillColumn: "AS" }, "normalFillColumn"],
    [{ normalFillColumn: "7" }, "normalFillColumn"],
    [
      { statisticColumns: [{ column: "1", statistic: "CLEAR" }] },
      "statisticColumns",
    ],
    [
      {
        statisticColumns: [
          { column: "K", statistic: "HOURS" as PersonStatistic },
        ],
      },
      "statisticColumns",
    ],
    [
      { statisticColumns: [{ column: "B", statistic: "CLEAR" }] },
      "statisticColumns",
    ],
    [
      { statisticColumns: [{ column: "AR", statistic: "CLEAR" }] },
      "statisticColumns",
    ],
    [
      {
        statisticColumns: [
          { column: "K", statistic: "CLEAR" },
          { column: "k", statistic: "SHIFT_COUNT" },
        ],
      },
      "statisticColumns",
    ],
    [
      {
        statisticColumns: Array.from({ length: 9 }, (_, i) => ({
          column: columnLetters(i + 1),
          statistic: "CLEAR" as const,
        })),
      },
      "statisticColumns",
    ],
    [{ summaryRows: [{ row: 0, statistic: "CLEAR" }] }, "summaryRows"],
    [{ summaryRows: [{ row: 6, statistic: "COVERAGE_N" }] }, "summaryRows"],
    [
      {
        summaryRows: [
          { row: 25, statistic: "COVERAGE_M" },
          { row: 25, statistic: "COVERAGE_E" },
        ],
      },
      "summaryRows",
    ],
    [
      {
        summaryRows: Array.from({ length: 9 }, (_, i) => ({
          row: 30 + i,
          statistic: "CLEAR" as const,
        })),
      },
      "summaryRows",
    ],
  ])("rejects %j on %s", (patch, field) => {
    const result = resolveTemplateMapping({ ...nicu, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[field]).toEqual(expect.any(String));
  });

  it("checks statistic columns even when the first day column is invalid", () => {
    const result = resolveTemplateMapping({
      ...nicu,
      firstDayColumn: "?",
      statisticColumns: [{ column: "K", statistic: "SHIFT_COUNT" }],
    });
    expect(result.ok ? null : result.error.statisticColumns).toBeUndefined();
  });

  it("allows the personnel column after the day block", () => {
    expect(
      resolveTemplateMapping({ ...mapping, personnelColumn: "AR" }).ok,
    ).toBe(true);
  });

  it.each<[Partial<ExcelTemplateMapping>, keyof ExcelTemplateMapping]>([
    [{ sheetName: "" }, "sheetName"],
    [{ sheetName: "a".repeat(32) }, "sheetName"],
    [{ sheetName: "bad/name" }, "sheetName"],
    [{ personnelColumn: "7" }, "personnelColumn"],
    [{ personnelColumn: "N" }, "personnelColumn"],
    [{ personnelColumn: "AQ" }, "personnelColumn"],
    [{ firstDayColumn: "" }, "firstDayColumn"],
    [{ firstDayColumn: "XFA" }, "firstDayColumn"],
    [{ firstRow: 0 }, "firstRow"],
    [{ firstRow: 2.5 }, "firstRow"],
    [{ lastRow: 1_048_577 }, "lastRow"],
    [{ lastRow: 6 }, "lastRow"],
    [{ firstRow: 1, lastRow: 501 }, "lastRow"],
  ])("rejects %j on %s", (patch, field) => {
    const result = resolveTemplateMapping({ ...mapping, ...patch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[field]).toEqual(expect.any(String));
  });

  it("keeps the last row valid on its own when the first row is invalid", () => {
    const result = resolveTemplateMapping({ ...mapping, firstRow: -1 });
    expect(result.ok ? null : result.error.lastRow).toBeUndefined();
  });

  it("requireTemplateMapping throws the first message as a validation error", () => {
    expect(requireTemplateMapping(mapping).firstDayColumnIndex).toBe(13);
    expect(() =>
      requireTemplateMapping({ ...mapping, personnelColumn: "?" }),
    ).toThrow(ValidationError);
  });
});

describe("exportDayValues", () => {
  const decisions = new Map<number, AssignmentCode>([
    [1, "M"],
    [2, "OFF"],
    [3, "H"],
    [30, "N"],
    [31, "ME"],
  ]);

  it("writes shifts and H, OFF as a blank and an undecided day as ?", () => {
    const values = exportDayValues(31, decisions);
    expect(values).toHaveLength(31);
    expect(values.slice(0, 4)).toEqual(["M", null, "H", "?"]);
    expect(values.slice(29)).toEqual(["N", "ME"]);
    // Never the same cell: an undecided day is not printed as rest.
    expect(EXCEL_UNDECIDED_VALUE).not.toBe(EXCEL_EXPORT_VALUES.OFF);
  });

  it.each([29, 30])("blanks days after a %i-day month", (days) => {
    const values = exportDayValues(days, decisions);
    expect(values).toHaveLength(31);
    expect(values.slice(days).every((v) => v === null)).toBe(true);
    expect(values[days - 2]).toBe("?");
  });

  it.each([0, 32, 1.5])("refuses %d days", (days) => {
    expect(() => exportDayValues(days, decisions)).toThrow(ValidationError);
    expect(() => exportPeriodRow(days, (i) => i + 1)).toThrow(ValidationError);
  });

  it("maps the approved conventions", () => {
    expect(EXCEL_EXPORT_VALUES).toEqual({
      M: "M",
      E: "E",
      N: "N",
      ME: "ME",
      OFF: null,
      H: "H",
    });
  });

  it.each([29, 30, 31])("fills a calendar row of a %i-day month", (days) => {
    const values = exportPeriodRow(days, (i) => i + 1);
    expect(values).toHaveLength(31);
    expect(values.slice(0, days)).toEqual(
      Array.from({ length: days }, (_, i) => i + 1),
    );
    expect(values.slice(days).every((v) => v === null)).toBe(true);
  });

  it("highlights the period's Fridays only, never a day past its end", () => {
    // Mehr 1405 starts on Wednesday 2026-09-23: Fridays are days 3, 10, 17, 24.
    const mehr = Array.from({ length: 30 }, (_, i) =>
      addDays(isoDate("2026-09-23"), i),
    );
    const flags = exportHolidayColumns(mehr);
    expect(flags).toHaveLength(31);
    expect(flags.flatMap((f, i) => (f ? [i + 1] : []))).toEqual([
      3, 10, 17, 24,
    ]);
    // An official holiday shares the presentation.
    const withOfficial = exportHolidayColumns(mehr, new Set([mehr[0]!]));
    expect(withOfficial.flatMap((f, i) => (f ? [i + 1] : []))).toEqual([
      1, 3, 10, 17, 24,
    ]);
    expect(() => exportHolidayColumns([])).toThrow(ValidationError);
  });

  it("parses single cell addresses", () => {
    expect(parseCellAddress(" u3 ")).toEqual({ column: 21, row: 3 });
    expect(parseCellAddress("XFD1048576")).toEqual({
      column: 16_384,
      row: 1_048_576,
    });
    for (const bad of ["", "U", "3", "U0", "A1:B2", "XFE1", "A1048577"])
      expect(parseCellAddress(bad)).toBeNull();
  });
});
