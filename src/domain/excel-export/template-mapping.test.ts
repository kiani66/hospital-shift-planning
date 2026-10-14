import { describe, expect, it } from "vitest";

import { ValidationError } from "../shared/errors";
import type { AssignmentCode } from "../shifts/shift-type";
import {
  EXCEL_EXPORT_VALUES,
  cellAddress,
  columnIndex,
  columnLetters,
  exportDayValues,
  requireTemplateMapping,
  resolveTemplateMapping,
  type ExcelTemplateMapping,
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
      },
    });
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

  it("writes the project's codes and leaves undecided days blank", () => {
    const values = exportDayValues(31, decisions);
    expect(values).toHaveLength(31);
    expect(values.slice(0, 4)).toEqual(["M", "OFF", "H", null]);
    expect(values.slice(29)).toEqual(["N", "ME"]);
  });

  it.each([29, 30])("blanks days after a %i-day month", (days) => {
    const values = exportDayValues(days, decisions);
    expect(values).toHaveLength(31);
    expect(values.slice(days).every((v) => v === null)).toBe(true);
  });

  it.each([0, 32, 1.5])("refuses %d days", (days) => {
    expect(() => exportDayValues(days, decisions)).toThrow(ValidationError);
  });

  it("maps every assignment code to itself", () => {
    for (const [code, value] of Object.entries(EXCEL_EXPORT_VALUES))
      expect(value).toBe(code);
  });
});
