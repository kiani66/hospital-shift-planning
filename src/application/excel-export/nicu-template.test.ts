import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";

import {
  exportDayHeaderValues,
  exportDayValues,
  type ExportCellValue,
} from "../../domain/excel-export/template-mapping";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import { ValidationError } from "../../domain/shared/errors";
import {
  patchXlsx,
  readWorkbook,
  sheetPart,
} from "../../../tests/support/excel-templates";
import {
  NICU_MAPPING,
  NICU_PERSONNEL_ROWS,
  NICU_SECRETARY_ROW,
  NICU_SHEET,
  nicuTemplate,
} from "../../../tests/support/nicu-template";
import {
  inspectExcelTemplate,
  populateExcelTemplate,
  templateRowLabels,
  writePersonnelColumn,
} from "./template-workbook";

/**
 * The sanitized NICU print workbook end to end (D124): the personnel-number
 * column is added from the system's numbers, the prepared file validates
 * against the NICU mapping, and exports keep the print layout.
 */

const ROWS = [...NICU_PERSONNEL_ROWS, NICU_SECRETARY_ROW];
/** Fictional numbers, as text with leading zeros. */
const NUMBERS = new Map(ROWS.map((row, i) => [row, `00${7100 + i}`]));
const numberOf = (row: number) => NUMBERS.get(row)!;

let original: Uint8Array;
let prepared: Uint8Array;

beforeAll(async () => {
  original = await nicuTemplate();
  prepared = writePersonnelColumn(original, {
    sheetName: NICU_SHEET,
    column: "BL",
    numbers: NUMBERS,
  });
});

const sheetXml = (bytes: Uint8Array) =>
  strFromU8(unzipSync(bytes)[sheetPart(bytes, NICU_SHEET)]!);

describe("the NICU workbook as received", () => {
  it("has no personnel numbers, so it cannot be activated as is", () => {
    const inspection = inspectExcelTemplate(original, NICU_MAPPING);
    expect(inspection.valid).toBe(false);
    // Last month's codes sit in rows that have no personnel number yet.
    expect(inspection.errors[0]).toMatchObject({
      cell: "M7",
      message: expect.stringContaining("شماره پرسنلی ندارد"),
    });
    expect(inspection.personnel).toEqual([]);
  });

  it("lists each row's printed text for choosing its person (never matched by name)", () => {
    const labels = templateRowLabels(original, NICU_MAPPING);
    expect(labels.map((l) => l.row)).toEqual([...NICU_PERSONNEL_ROWS, 22, 23]);
    expect(labels[0]!.label).toContain("نام1 · خانوادگی نمونه 1 · سرپرستار");
    expect(labels.find((l) => l.row === 22)!.label).toBe("منشی");
    // Nothing from the day columns.
    expect(labels.every((l) => !/\b(ME|N)\b/.test(l.label))).toBe(true);
  });
});

describe("writePersonnelColumn", () => {
  it("writes the numbers as text in a hidden column without moving anything", async () => {
    const inspection = inspectExcelTemplate(prepared, NICU_MAPPING);
    expect(inspection.errors).toEqual([]);
    expect(inspection.valid).toBe(true);
    expect(inspection.personnel.map((p) => [p.row, p.personnelNumber])).toEqual(
      ROWS.map((row) => [row, numberOf(row)]),
    );
    expect(inspection.personnelColumnHidden).toBe(true);

    const before = unzipSync(original);
    const after = unzipSync(prepared);
    const part = sheetPart(original, NICU_SHEET);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const name of Object.keys(before))
      if (name !== part) expect(after[name], name).toEqual(before[name]);

    // Only the BL cells, the hidden <col> and the dimension differ.
    const strip = (xml: string) =>
      xml
        .replace(/<c r="BL\d+"[^>]*>.*?<\/c>/g, "")
        .replace(/<col min="64" max="64"[^>]*\/>/, "")
        .replace(/<dimension ref="[^"]*"\/>/, "")
        .replace(/<row r="(\d+)"[^>]*>/g, '<row r="$1">');
    expect(strip(sheetXml(prepared))).toBe(strip(sheetXml(original)));
    expect(sheetXml(prepared)).toContain('<dimension ref="A1:BL128"/>');
    expect(sheetXml(prepared)).toMatch(
      /<col min="64" max="64"[^>]* hidden="1"\/>/,
    );

    const sheet = (await readWorkbook(prepared)).getWorksheet(NICU_SHEET)!;
    expect(sheet.getCell("BL7").value).toBe("007100");
    expect(sheet.getColumn("BL").hidden).toBe(true);
  });

  it("splits a <col> range that spans the column", () => {
    const part = sheetPart(original, NICU_SHEET);
    const xml = sheetXml(original).replace(
      /<cols>[\s\S]*?<\/cols>/,
      '<cols><col min="44" max="46" width="9" style="3" customWidth="1"/></cols>',
    );
    const bytes = writePersonnelColumn(patchXlsx(original, { [part]: xml }), {
      sheetName: NICU_SHEET,
      column: "AS",
      numbers: new Map([[7, "1"]]),
    });
    expect(sheetXml(bytes)).toContain(
      '<cols><col min="44" max="44" width="9" style="3" customWidth="1"/><col min="45" max="45" width="9" style="3" customWidth="1" hidden="1"/><col min="46" max="46" width="9" style="3" customWidth="1"/></cols>',
    );
  });

  it("adds <cols> when the sheet has none", () => {
    const part = sheetPart(original, NICU_SHEET);
    const xml = sheetXml(original).replace(/<cols>[\s\S]*?<\/cols>/, "");
    const bytes = writePersonnelColumn(patchXlsx(original, { [part]: xml }), {
      sheetName: NICU_SHEET,
      column: "BL",
      numbers: new Map([[7, "1"]]),
    });
    expect(sheetXml(bytes)).toMatch(
      /<cols><col min="64" max="64" width="[\d.]+" customWidth="1" hidden="1"\/><\/cols><sheetData>/,
    );
  });

  it.each([
    ["C", "خالی نیست"], // It holds the last names.
    ["AQ", "ادغام"], // Empty, but crossed by the merge added below.
  ])("refuses column %s (%s)", (column, message) => {
    const part = sheetPart(original, NICU_SHEET);
    const xml = sheetXml(original).replace(
      "</mergeCells>",
      '<mergeCell ref="AP40:AR40"/></mergeCells>',
    );
    expect(() =>
      writePersonnelColumn(patchXlsx(original, { [part]: xml }), {
        sheetName: NICU_SHEET,
        column,
        numbers: new Map([[7, "1"]]),
      }),
    ).toThrow(message);
  });

  it("refuses an unknown sheet, a bad column and no rows", () => {
    const write = (sheetName: string, column: string, rows = 1) =>
      writePersonnelColumn(original, {
        sheetName,
        column,
        numbers: new Map(rows ? [[7, "1"]] : []),
      });
    expect(() => write("Sheet9", "BL")).toThrow(ValidationError);
    expect(() => write(NICU_SHEET, "7")).toThrow(ValidationError);
    expect(() => write(NICU_SHEET, "BL", 0)).toThrow(ValidationError);
  });
});

describe("validation of the prepared NICU template", () => {
  it("warns that day 31 (AQ) is outside the print area as found", () => {
    const inspection = inspectExcelTemplate(prepared, NICU_MAPPING);
    expect(inspection.printArea).toBe("A1:AP31");
    expect(inspection.warnings).toEqual([
      expect.objectContaining({
        cell: "AQ6",
        message: expect.stringContaining("روزهای 31"),
      }),
    ]);
  });

  it("has no print warning once the print area includes AQ", async () => {
    const wide = writePersonnelColumn(
      await nicuTemplate({ printArea: "A1:AQ31" }),
      { sheetName: NICU_SHEET, column: "BL", numbers: NUMBERS },
    );
    expect(inspectExcelTemplate(wide, NICU_MAPPING).warnings).toEqual([]);
  });

  it("checks every mapped statistic, summary and heading cell", () => {
    const part = sheetPart(prepared, NICU_SHEET);
    const xml = sheetXml(prepared)
      // A formula in a statistic cell, a merge over a summary row.
      .replace(
        /<c r="K9"([^>]*?)(?:\/>|>.*?<\/c>)/,
        '<c r="K9"$1><f>SUM(M9:AP9)</f><v>3</v></c>',
      )
      .replace("</mergeCells>", '<mergeCell ref="N26:O26"/></mergeCells>');
    const inspection = inspectExcelTemplate(
      patchXlsx(prepared, { [part]: xml }),
      NICU_MAPPING,
    );
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((e) => e.cell)).toEqual(["K9", "N26:O26"]);
  });

  it("refuses a summary row that holds a personnel number", () => {
    const inspection = inspectExcelTemplate(prepared, {
      ...NICU_MAPPING,
      summaryRows: [{ row: 8, statistic: "COVERAGE_M" }],
    });
    expect(inspection.errors).toEqual([
      expect.objectContaining({ cell: "BL8" }),
    ]);
  });
});

/** A month of decisions: index 0 is day 1; null is undecided. */
const plan = (codes: readonly (AssignmentCode | null)[]) =>
  new Map(
    codes.flatMap((code, i) => (code === null ? [] : [[i + 1, code] as const])),
  );

function exportMonth(
  dayCount: number,
  people: ReadonlyMap<number, ReadonlyMap<number, AssignmentCode>>,
  statistics: ReadonlyMap<number, Record<string, ExportCellValue>> = new Map(),
  summaries: ReadonlyMap<number, ExportCellValue[]> = new Map(),
) {
  return populateExcelTemplate(
    prepared,
    NICU_MAPPING,
    new Map(
      [...people].map(([row, days]) => [
        numberOf(row),
        exportDayValues(dayCount, days),
      ]),
    ),
    {
      statistics: new Map(
        [...statistics].map(([row, values]) => [
          numberOf(row),
          new Map(Object.entries(values)),
        ]),
      ),
      summaries,
      dayHeader: exportDayHeaderValues(dayCount),
    },
  );
}

describe("exporting into the NICU template", () => {
  const full = plan(
    Array.from(
      { length: 31 },
      (_, i) => (["M", "E", "N", "OFF", "ME", "H"] as const)[i % 6]!,
    ),
  );

  it("writes M/E/N/ME/H, OFF blank, undecided ?, the secretary, and the statistics", async () => {
    const partial = plan(["M", null, "OFF", "H", null]);
    const people = new Map(ROWS.map((row) => [row, full]));
    people.set(8, partial);
    const bytes = exportMonth(
      30,
      people,
      new Map([
        [7, { J: 5, K: 20 }],
        [8, { J: "?", K: "?" }],
      ]),
      new Map([
        [25, Array.from({ length: 31 }, (_, i) => (i < 30 ? i % 4 : null))],
      ]),
    );
    const sheet = (await readWorkbook(bytes)).getWorksheet(NICU_SHEET)!;
    const row = (r: number) =>
      Array.from({ length: 31 }, (_, i) => sheet.getCell(r, 13 + i).value);
    expect(row(7).slice(0, 7)).toEqual(["M", "E", "N", null, "ME", "H", "M"]);
    expect(row(7)[30]).toBeNull(); // AQ: Mehr has 30 days.
    expect(row(8).slice(0, 6)).toEqual(["M", "?", null, "H", "?", "?"]);
    expect(
      row(8)
        .slice(5, 30)
        .every((v) => v === "?"),
    ).toBe(true);
    expect(row(NICU_SECRETARY_ROW).slice(0, 3)).toEqual(["M", "E", "N"]);
    // Row 22 (the «منشی» caption) is not touched.
    expect(row(22).every((v) => v === null)).toBe(true);
    expect(sheet.getCell("A22").value).toBe("منشی");

    // I (required hours) cleared, J/K recalculated, ? where unknown.
    expect(
      [7, 8, 9].map((r) =>
        ["I", "J", "K"].map((c) => sheet.getCell(`${c}${r}`).value),
      ),
    ).toEqual([
      [null, 5, 20],
      [null, "?", "?"],
      [null, null, null], // No statistic given: never last month's figure.
    ]);
    // Summary rows: given values, otherwise cleared; headings 1–30.
    expect(row(25).slice(0, 5)).toEqual([0, 1, 2, 3, 0]);
    expect(row(26).every((v) => v === null)).toBe(true);
    expect(row(6).slice(28)).toEqual([29, 30, null]);
  });

  it.each([
    [29, [28, 29, null, null]],
    [30, [28, 29, 30, null]],
    [31, [28, 29, 30, 31]],
  ] as const)(
    "a %i-day month fills exactly its days",
    async (dayCount, headings) => {
      const bytes = exportMonth(dayCount, new Map(ROWS.map((r) => [r, full])));
      const sheet = (await readWorkbook(bytes)).getWorksheet(NICU_SHEET)!;
      expect(
        [27, 28, 29, 30].map((i) => sheet.getCell(6, 13 + i).value),
      ).toEqual(headings);
      const last = Array.from(
        { length: 31 },
        (_, i) => sheet.getCell(7, 13 + i).value,
      );
      expect(last.slice(dayCount).every((v) => v === null)).toBe(true);
      expect(last[dayCount - 1]).toBe(
        ["M", "E", "N", null, "ME", "H"][(dayCount - 1) % 6],
      );
    },
  );

  it("keeps the print layout: merges, print setup, widths, heights, styles, signatures", async () => {
    const bytes = exportMonth(31, new Map(ROWS.map((r) => [r, full])));
    const before = (await readWorkbook(prepared)).getWorksheet(NICU_SHEET)!;
    const after = (await readWorkbook(bytes)).getWorksheet(NICU_SHEET)!;
    expect(after.pageSetup).toEqual(before.pageSetup);
    expect(after.headerFooter).toEqual(before.headerFooter);
    expect(after.views).toEqual(before.views);
    expect(Object.keys(after.model.merges ?? {}).sort()).toEqual(
      Object.keys(before.model.merges ?? {}).sort(),
    );
    expect(after.model.merges).toEqual(before.model.merges);
    for (const c of [2, 3, 13, 43, 64]) {
      expect(after.getColumn(c).width).toBe(before.getColumn(c).width);
      expect(after.getColumn(c).hidden).toBe(before.getColumn(c).hidden);
    }
    for (const r of [1, 6, 7, 23, 30])
      expect(after.getRow(r).height).toBe(before.getRow(r).height);
    for (const address of ["M7", "AQ7", "K7", "N25", "AQ6"]) {
      expect(after.getCell(address).style).toEqual(
        before.getCell(address).style,
      );
    }
    for (const address of [
      "M1",
      "T3",
      "AL3",
      "C30",
      "T30",
      "AH30",
      "B7",
      "C23",
      "D23",
    ])
      expect(after.getCell(address).value).toEqual(
        before.getCell(address).value,
      );

    // Every part but the worksheet is byte for byte the prepared template's.
    const parts = unzipSync(bytes);
    const source = unzipSync(prepared);
    const part = sheetPart(prepared, NICU_SHEET);
    for (const name of Object.keys(source))
      if (name !== part) expect(parts[name], name).toEqual(source[name]);
  });

  it("clears a template row whose person is not exported", async () => {
    const people = new Map(ROWS.filter((r) => r !== 21).map((r) => [r, full]));
    const sheet = (await readWorkbook(exportMonth(30, people))).getWorksheet(
      NICU_SHEET,
    )!;
    expect(
      Array.from(
        { length: 31 },
        (_, i) => sheet.getCell(21, 13 + i).value,
      ).every((v) => v === null),
    ).toBe(true);
    expect(["I21", "J21", "K21"].map((a) => sheet.getCell(a).value)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("accepts last month's export, with its ?, as a template", () => {
    const bytes = exportMonth(
      30,
      new Map(ROWS.map((r) => [r, plan(["M", null, "H"])])),
    );
    expect(inspectExcelTemplate(bytes, NICU_MAPPING).errors).toEqual([]);
  });

  it("creates a mapped summary row the sheet does not have yet, in row order", async () => {
    const bytes = populateExcelTemplate(
      prepared,
      { ...NICU_MAPPING, summaryRows: [{ row: 28, statistic: "COVERAGE_N" }] },
      new Map(),
      { summaries: new Map([[28, Array<ExportCellValue>(31).fill(2)]]) },
    );
    const xml = sheetXml(bytes);
    expect(xml.indexOf('<row r="28">')).toBeGreaterThan(
      xml.indexOf('<row r="27"'),
    );
    expect(xml.indexOf('<row r="28">')).toBeLessThan(
      xml.indexOf('<row r="30"'),
    );
    const sheet = (await readWorkbook(bytes)).getWorksheet(NICU_SHEET)!;
    expect(sheet.getCell("M28").value).toBe(2);
    expect(sheet.getCell("AQ28").value).toBe(2);
  });
});
