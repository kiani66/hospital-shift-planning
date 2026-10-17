import { describe, expect, it } from "vitest";

import { ValidationError } from "../shared/errors";
import type { AssignmentCode } from "../shifts/shift-type";
import {
  EXCEL_EXPORT_VALUES,
  EXCEL_UNDECIDED_VALUE,
  cellAddress,
  columnIndex,
  columnLetters,
  exportDayHeaderValues,
  exportDayValues,
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
      },
    });
  });

  /** The NICU print layout (D124): totals in I–K, summaries under the people. */
  const nicu: ExcelTemplateMapping = {
    sheetName: "Sheet2",
    personnelColumn: "BL",
    firstRow: 7,
    lastRow: 23,
    firstDayColumn: "M",
    dayHeaderRow: 6,
    statisticColumns: [
      { column: "i", statistic: "CLEAR" },
      { column: "J", statistic: "LEAVE_DAYS" },
      { column: "K", statistic: "SHIFT_COUNT" },
    ],
    summaryRows: [
      { row: 22, statistic: "CLEAR" },
      { row: 25, statistic: "COVERAGE_M" },
    ],
  };

  it("resolves statistic columns, summary rows and the heading row", () => {
    const resolved = requireTemplateMapping(nicu);
    expect(resolved.lastDayColumnIndex).toBe(columnIndex("AQ"));
    expect(resolved.dayHeaderRow).toBe(6);
    expect(resolved.statisticColumns).toEqual([
      { column: "I", statistic: "CLEAR", columnIndex: 9 },
      { column: "J", statistic: "LEAVE_DAYS", columnIndex: 10 },
      { column: "K", statistic: "SHIFT_COUNT", columnIndex: 11 },
    ]);
    // A summary row may sit inside the personnel block (row 22).
    expect(resolved.summaryRows.map((r) => r.row)).toEqual([22, 25]);
    expect(storedTemplateMapping(resolved)).toEqual({
      ...nicu,
      statisticColumns: [
        { column: "I", statistic: "CLEAR" },
        { column: "J", statistic: "LEAVE_DAYS" },
        { column: "K", statistic: "SHIFT_COUNT" },
      ],
    });
  });

  it.each<[Partial<ExcelTemplateMapping>, keyof ExcelTemplateMapping]>([
    [{ dayHeaderRow: 0 }, "dayHeaderRow"],
    [{ dayHeaderRow: 7 }, "dayHeaderRow"],
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
      { statisticColumns: [{ column: "BL", statistic: "CLEAR" }] },
      "statisticColumns",
    ],
    [
      { statisticColumns: [{ column: "AQ", statistic: "CLEAR" }] },
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
    expect(() => exportDayHeaderValues(days)).toThrow(ValidationError);
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

  it.each([29, 30, 31])("numbers the headings of a %i-day month", (days) => {
    const values = exportDayHeaderValues(days);
    expect(values).toHaveLength(31);
    expect(values.filter((v) => v !== null)).toEqual(
      Array.from({ length: days }, (_, i) => i + 1),
    );
  });
});
