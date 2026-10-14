import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { ValidationError } from "../../domain/shared/errors";
import {
  DEFAULT_MAPPING,
  patchXlsx,
  readWorkbook,
  sheetPart,
  syntheticTemplate,
} from "../../../tests/support/excel-templates";
import {
  EXCEL_TEMPLATE_LIMITS,
  inspectExcelTemplate,
  populateExcelTemplate,
} from "./template-workbook";

const days = (codes: Record<number, string>) =>
  Array.from({ length: 31 }, (_, i) => codes[i + 1] ?? null);

const DAY_RE = (row: number) =>
  new RegExp(`<c r="(?:[F-Z]|A[A-J])${row}"[^>]*?(?:/>|>.*?</c>)`, "g");

describe("inspectExcelTemplate", () => {
  it("reads personnel numbers from the mapped column, in sheet order", async () => {
    const inspection = inspectExcelTemplate(
      await syntheticTemplate(),
      DEFAULT_MAPPING,
    );
    expect(inspection.valid).toBe(true);
    expect(inspection.errors).toEqual([]);
    expect(
      inspection.personnel.map((p) => [p.cell, p.personnelNumber]),
    ).toEqual([
      ["B7", "1003"],
      ["B8", "0042"], // Leading zeros survive in text cells.
      ["B11", "1001"],
      ["B12", "1002"], // A numeric cell within Excel's exact precision.
      ["B13", "1009"],
    ]);
    expect(inspection.personnelRange).toBe("B7:B14");
    expect(inspection.dayRange).toBe("F7:AJ14");
    expect(inspection.personnelColumnHidden).toBe(true);
    expect(inspection.sheetNames).toEqual(["برنامه ماهانه"]);
  });

  it("uses the configured sheet and columns, wherever they are", async () => {
    const bytes = await syntheticTemplate({
      sheetName: "Sheet2",
      otherSheets: ["Sheet1"],
      personnelColumn: 40, // After the day block (AN).
      firstDayColumn: 5, // E … AI
      hidePersonnelColumn: false,
      totals: false,
    });
    const inspection = inspectExcelTemplate(bytes, {
      sheetName: "Sheet2",
      personnelColumn: "an",
      firstRow: 7,
      lastRow: 13,
      firstDayColumn: "e",
    });
    expect(inspection.valid).toBe(true);
    expect(inspection.personnel).toHaveLength(5);
    expect(inspection.personnelColumnHidden).toBe(false);
    expect(inspection.sheetNames).toEqual(["Sheet1", "Sheet2"]);
    // The same file read with the default coordinates finds nobody there.
    expect(
      inspectExcelTemplate(bytes, { ...DEFAULT_MAPPING, sheetName: "Sheet1" })
        .errors[0]?.message,
    ).toContain("هیچ شماره پرسنلی");
  });

  it("ignores decoration and reports text that is not a personnel number", async () => {
    const inspection = inspectExcelTemplate(
      await syntheticTemplate({ extraCells: [["B9", "پرستاران"]] }),
      DEFAULT_MAPPING,
    );
    expect(inspection.valid).toBe(true);
    expect(inspection.warnings).toEqual([
      expect.objectContaining({ cell: "B9" }),
    ]);
  });

  it("accepts persian digits as text", async () => {
    const inspection = inspectExcelTemplate(
      await syntheticTemplate({ extraCells: [["B14", "۲۰۰۵"]] }),
      DEFAULT_MAPPING,
    );
    expect(inspection.personnel.at(-1)?.personnelNumber).toBe("2005");
  });

  it("names the available sheets when the configured one is missing", async () => {
    const inspection = inspectExcelTemplate(await syntheticTemplate(), {
      ...DEFAULT_MAPPING,
      sheetName: "Sheet1",
    });
    expect(inspection.valid).toBe(false);
    expect(inspection.errors[0]!.message).toContain("برنامه ماهانه");
  });

  it("returns mapping errors without reading cells", async () => {
    const inspection = inspectExcelTemplate(await syntheticTemplate(), {
      ...DEFAULT_MAPPING,
      personnelColumn: "G",
    });
    expect(inspection.valid).toBe(false);
    expect(inspection.mapping).toBeNull();
  });

  it.each<[string, Parameters<typeof syntheticTemplate>[0], string]>([
    ["duplicate personnel numbers", { extraCells: [["B14", "1001"]] }, "B14"],
    [
      "a formula in a day cell",
      { extraCells: [["H8", { formula: "1+1", result: 2 }]] },
      "H8",
    ],
    [
      "a formula in a personnel cell",
      { extraCells: [["B14", { formula: '"1"', result: "1" }]] },
      "B14",
    ],
    ["merged day cells", { merges: ["F11:G11"] }, "F11:G11"],
    ["a merged personnel cell", { merges: ["B13:B14"] }, "B13:B14"],
    [
      "a value in a row without a personnel number",
      { staleDays: [[9, 3, "M"]] },
      "H9",
    ],
    [
      "text that is not a shift code (wrong first day column)",
      { staleDays: [[11, 2, "یکشنبه"]] },
      "G11",
    ],
    ["a number in a day cell", { extraCells: [["F7", 5]] }, "F7"],
    [
      "a personnel number beyond Excel's precision",
      { extraCells: [["B14", 1234567890123456]] },
      "B14",
    ],
    ["a decimal personnel number", { extraCells: [["B14", 12.5]] }, "B14"],
    ["a boolean personnel cell", { extraCells: [["B14", true]] }, "B14"],
    ["a locked day cell in a protected sheet", { protect: true }, "F7"],
  ])("rejects %s", async (_, options, cell) => {
    const inspection = inspectExcelTemplate(
      await syntheticTemplate(options),
      DEFAULT_MAPPING,
    );
    expect(inspection.valid).toBe(false);
    expect(inspection.errors.map((e) => e.cell)).toContain(cell);
  });

  it("accepts a protected sheet whose day cells are unlocked", async () => {
    const bytes = await syntheticTemplate({ protect: true, unlockDays: true });
    expect(inspectExcelTemplate(bytes, DEFAULT_MAPPING).valid).toBe(true);
  });

  it("accepts stale shift codes from a previous export", async () => {
    const bytes = await syntheticTemplate({
      staleDays: [
        [7, 1, "N"],
        [8, 31, " off "],
      ],
    });
    expect(inspectExcelTemplate(bytes, DEFAULT_MAPPING).valid).toBe(true);
  });

  it("rejects an Excel table over the mapped cells", async () => {
    const bytes = await syntheticTemplate();
    const part = sheetPart(bytes, DEFAULT_MAPPING.sheetName);
    const rels = part.replace("worksheets/", "worksheets/_rels/") + ".rels";
    const patched = patchXlsx(bytes, {
      [rels]: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>`,
      "xl/tables/table1.xml": `<?xml version="1.0"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="T" ref="E6:G12"/>`,
    });
    const inspection = inspectExcelTemplate(patched, DEFAULT_MAPPING);
    expect(inspection.errors.map((e) => e.cell)).toContain("E6:G12");
  });

  it("caps the listed issues", async () => {
    const stale = [9, 10].flatMap((row) =>
      Array.from({ length: 31 }, (_, d) => [row, d + 1, "M"] as const),
    );
    const inspection = inspectExcelTemplate(
      await syntheticTemplate({ staleDays: stale }),
      DEFAULT_MAPPING,
    );
    expect(inspection.errors).toHaveLength(EXCEL_TEMPLATE_LIMITS.maxIssues + 1);
  });
});

describe("unsafe and malformed files", () => {
  const reject = (bytes: Uint8Array) =>
    expect(() => inspectExcelTemplate(bytes, DEFAULT_MAPPING)).toThrow(
      ValidationError,
    );

  it("rejects empty, non-zip and legacy .xls bytes", () => {
    reject(new Uint8Array());
    reject(strToU8("name,number\n"));
    reject(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  });

  it("rejects a zip that is not a workbook", () => {
    reject(zipSync({ "hello.txt": strToU8("hi") }));
    reject(
      zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "a.xml": strToU8(""),
      }),
    );
  });

  it("rejects truncated archives", async () => {
    const bytes = await syntheticTemplate();
    reject(bytes.subarray(0, Math.floor(bytes.length / 2)));
  });

  it("rejects oversized uploads", () => {
    const big = new Uint8Array(EXCEL_TEMPLATE_LIMITS.maxBytes + 1);
    big.set([0x50, 0x4b]);
    reject(big);
  });

  // A minimal package (no spreadsheet library) at level 1 keeps building the
  // fixture fast; zeros still compress far below the upload limit.
  const bombWith = async (padding: number) =>
    zipSync(
      {
        "[Content_Types].xml": strToU8("<Types/>"),
        "xl/workbook.xml": strToU8("<workbook/>"),
        "xl/media/padding.bin": new Uint8Array(padding),
      },
      { level: 1 },
    );
  // Inflating tens of MiB is the point of these two; give them room on slow runners.
  const HEAVY = { timeout: 30_000 };

  it(
    "rejects archives that declare more than the inflation limit",
    HEAVY,
    async () => {
      const bomb = await bombWith(EXCEL_TEMPLATE_LIMITS.maxExpandedBytes);
      expect(bomb.length).toBeLessThan(EXCEL_TEMPLATE_LIMITS.maxBytes);
      expect(() => inspectExcelTemplate(bomb, DEFAULT_MAPPING)).toThrow(
        "حجم بازشده",
      );
    },
  );

  it(
    "rejects archives that lie about their size, while inflating",
    HEAVY,
    async () => {
      const bomb = await bombWith(EXCEL_TEMPLATE_LIMITS.maxExpandedBytes);
      // Rewrite the declared uncompressed size of padding.bin to 1 byte in both
      // the local header (offset 22) and the central directory (offset 24).
      const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
      const name = new TextEncoder().encode("xl/media/padding.bin");
      let patched = 0;
      for (let i = 0; i + 46 < bomb.length; i++) {
        const signature = view.getUint32(i, true);
        const local = signature === 0x04034b50;
        if (!local && signature !== 0x02014b50) continue;
        const nameLength = view.getUint16(i + (local ? 26 : 28), true);
        const start = i + (local ? 30 : 46);
        const entryName = bomb.subarray(start, start + nameLength);
        if (
          nameLength !== name.length ||
          !entryName.every((b, k) => b === name[k])
        )
          continue;
        view.setUint32(i + (local ? 22 : 24), 1, true);
        patched++;
      }
      expect(patched).toBe(2);
      // The declared sizes pass; the streaming pass rejects it (fflate reports
      // the size mismatch, or the incremental inflation limit stops it first).
      expect(() => inspectExcelTemplate(bomb, DEFAULT_MAPPING)).toThrow(
        ValidationError,
      );
    },
  );

  it("rejects too many parts", async () => {
    const parts: Record<string, Uint8Array> = unzipSync(
      await syntheticTemplate(),
    );
    for (let i = 0; i < EXCEL_TEMPLATE_LIMITS.maxEntries; i++)
      parts[`xl/extra/${i}.xml`] = strToU8("<a/>");
    reject(zipSync(parts));
  });

  it.each([
    "xl/vbaProject.bin",
    "xl/externalLinks/externalLink1.xml",
    "xl/embeddings/oleObject1.bin",
    "xl/activeX/activeX1.xml",
    "xl/connections.xml",
  ])("rejects a workbook containing %s", async (name) => {
    reject(patchXlsx(await syntheticTemplate(), { [name]: "<x/>" }));
  });

  it("rejects macro-enabled content types", async () => {
    const bytes = await syntheticTemplate();
    const types = strFromU8(unzipSync(bytes)["[Content_Types].xml"]!).replace(
      "sheet.main+xml",
      "sheet.macroEnabled.main+xml",
    );
    reject(patchXlsx(bytes, { "[Content_Types].xml": types }));
  });

  it("rejects external relationships but keeps hyperlinks", async () => {
    const bytes = await syntheticTemplate();
    const part = sheetPart(bytes, DEFAULT_MAPPING.sheetName);
    const rels = part.replace("worksheets/", "worksheets/_rels/") + ".rels";
    const rel = (type: string) =>
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="file:///C:/x.xlsx" TargetMode="External"/></Relationships>`;
    reject(patchXlsx(bytes, { [rels]: rel("oleObject") }));
    expect(
      inspectExcelTemplate(
        patchXlsx(bytes, { [rels]: rel("hyperlink") }),
        DEFAULT_MAPPING,
      ).valid,
    ).toBe(true);
  });
});

describe("populateExcelTemplate", () => {
  const values = new Map([
    ["1001", days({ 1: "M", 2: "E", 3: "N", 4: "OFF", 5: "ME", 6: "H" })],
    ["0042", days({ 31: "N" })],
    ["1002", days({ 10: "M" })],
  ]);

  it("writes codes into the matched rows and leaves other days blank", async () => {
    const template = await syntheticTemplate({ staleDays: [[7, 1, "E"]] });
    const output = populateExcelTemplate(template, DEFAULT_MAPPING, values);
    const sheet = (await readWorkbook(output)).getWorksheet(
      DEFAULT_MAPPING.sheetName,
    )!;
    const row = (r: number) =>
      Array.from(
        { length: 31 },
        (_, d) => sheet.getCell(r, 6 + d).value ?? null,
      );
    expect(row(11).slice(0, 7)).toEqual([
      "M",
      "E",
      "N",
      "OFF",
      "ME",
      "H",
      null,
    ]);
    expect(row(8)[30]).toBe("N");
    expect(row(12)[9]).toBe("M");
    // A stale value is cleared; a row with no data stays blank.
    expect(row(7).every((v) => v === null)).toBe(true);
    expect(row(13).every((v) => v === null)).toBe(true);
    // Identity, titles and totals are untouched.
    expect(sheet.getCell("B12").value).toBe(1002);
    expect(sheet.getCell("C11").value).toBe("پرستار نمونه یکم");
    expect(sheet.getCell("A3").value).toBe("برنامه ماه مهر ۱۴۰۵");
    expect(sheet.getCell("AK11").value).toMatchObject({
      formula: 'COUNTIF(F11:AJ11,"N")',
    });
  });

  it("keeps every other part and everything around the day cells byte for byte", async () => {
    const template = await syntheticTemplate();
    const before = unzipSync(template);
    const after = unzipSync(
      populateExcelTemplate(template, DEFAULT_MAPPING, values),
    );
    const part = sheetPart(template, DEFAULT_MAPPING.sheetName);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before))
      if (name !== part && name !== "xl/workbook.xml")
        expect(after[name], name).toEqual(before[name]);
    const a = strFromU8(before[part]!);
    const b = strFromU8(after[part]!);
    // Print setup, margins, merges, columns (widths, hidden) and views.
    expect(b.slice(0, b.indexOf("<sheetData"))).toBe(
      a.slice(0, a.indexOf("<sheetData")),
    );
    expect(b.slice(b.indexOf("</sheetData>"))).toBe(
      a.slice(a.indexOf("</sheetData>")),
    );
    // Only the day cells of matched rows differ.
    for (const r of [7, 8, 11, 12, 13])
      expect(b.replace(DAY_RE(r), "")).toContain(
        /<row r="\d+"[^>]*>/.exec(a.slice(a.indexOf(`<row r="${r}"`)))![0],
      );
    // Besides the day cells, only formula cells' cached results are dropped.
    const strip = (xml: string) =>
      [7, 8, 11, 12, 13]
        .reduce((s, r) => s.replace(DAY_RE(r), ""), xml)
        .replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/g, "$1");
    expect(strip(b)).toBe(strip(a));
    // Formulas recalculate when Excel opens the file.
    expect(strFromU8(after["xl/workbook.xml"]!)).toContain(
      'fullCalcOnLoad="1"',
    );
  });

  it("keeps cell styles of written day cells", async () => {
    const template = await syntheticTemplate();
    const output = populateExcelTemplate(template, DEFAULT_MAPPING, values);
    const original = (await readWorkbook(template)).getWorksheet(
      DEFAULT_MAPPING.sheetName,
    )!;
    const sheet = (await readWorkbook(output)).getWorksheet(
      DEFAULT_MAPPING.sheetName,
    )!;
    for (const address of ["F11", "K11", "AJ8", "O12", "G13"])
      expect(sheet.getCell(address).style).toEqual(
        original.getCell(address).style,
      );
    expect(sheet.getColumn(2).hidden).toBe(true);
    expect(sheet.getColumn(3).width).toBe(24);
    expect(sheet.getRow(1).height).toBe(32);
    expect(sheet.pageSetup).toMatchObject({
      orientation: "landscape",
      printArea: "A1:AL20",
      fitToPage: true,
    });
    expect(sheet.pageSetup.margins).toEqual(original.pageSetup.margins);
    expect(sheet.model.merges).toEqual(original.model.merges);
  });

  it("does not modify the template bytes it is given", async () => {
    const template = await syntheticTemplate();
    const copy = template.slice();
    populateExcelTemplate(template, DEFAULT_MAPPING, values);
    expect(template).toEqual(copy);
  });

  it("creates missing day cells in order and escapes nothing unexpected", async () => {
    // Day cells without any formatting do not exist in the sheet XML.
    const template = await syntheticTemplate({ totals: false });
    const part = sheetPart(template, DEFAULT_MAPPING.sheetName);
    const xml = strFromU8(unzipSync(template)[part]!).replace(
      /<c r="(?:[F-Z]|A[A-J])11"[^>]*?\/>/g,
      "",
    );
    const output = populateExcelTemplate(
      patchXlsx(template, { [part]: xml }),
      DEFAULT_MAPPING,
      values,
    );
    const row = /<row r="11"[^>]*>(.*?)<\/row>/.exec(
      strFromU8(unzipSync(output)[part]!),
    )!;
    const refs = [...row[1]!.matchAll(/<c r="([A-Z]+)11"/g)].map((m) => m[1]);
    expect(refs).toEqual(["A", "B", "C", "D", "F", "G", "H", "I", "J", "K"]);
    expect(row[0]).not.toContain("spans=");
    const sheet = (await readWorkbook(output)).getWorksheet(
      DEFAULT_MAPPING.sheetName,
    )!;
    expect(sheet.getCell("K11").value).toBe("H");
  });

  it("never ships the template's stale formula results", async () => {
    const template = await syntheticTemplate({
      otherSheets: ["خلاصه"],
      // A cross-sheet total cached at a stale value.
      extraCells: [["C20", { formula: "COUNTA(F7:AJ14)", result: 99 }]],
    });
    const part = sheetPart(template, DEFAULT_MAPPING.sheetName);
    const summary = sheetPart(template, "خلاصه");
    const withSummaryFormula = patchXlsx(template, {
      [summary]: strFromU8(unzipSync(template)[summary]!).replace(
        /<c r="A1"[^>]*>.*?<\/c>/,
        `<c r="A1"><f>'برنامه ماهانه'!AK11</f><v>7</v></c>`,
      ),
    });
    const after = unzipSync(
      populateExcelTemplate(withSummaryFormula, DEFAULT_MAPPING, values),
    );
    const before = unzipSync(withSummaryFormula);
    for (const name of [part, summary]) {
      const xml = strFromU8(after[name]!);
      const formulas = (x: string) =>
        [...x.matchAll(/<f>[^<]*<\/f>/g)].map((m) => m[0]);
      // Every formula is kept exactly; none keeps a cached result.
      expect(formulas(xml)).toEqual(formulas(strFromU8(before[name]!)));
      expect(formulas(xml).length).toBeGreaterThan(0);
      expect(xml).not.toMatch(/<\/f><v>/);
    }
    // Plain values elsewhere keep their cached text.
    const sheet = (
      await readWorkbook(
        populateExcelTemplate(withSummaryFormula, DEFAULT_MAPPING, values),
      )
    ).getWorksheet(DEFAULT_MAPPING.sheetName)!;
    expect(sheet.getCell("C11").value).toBe("پرستار نمونه یکم");
  });

  it("does not add a recalculation flag to a workbook without formulas", async () => {
    const template = await syntheticTemplate({ totals: false });
    const output = populateExcelTemplate(template, DEFAULT_MAPPING, values);
    expect(unzipSync(output)["xl/workbook.xml"]).toEqual(
      unzipSync(template)["xl/workbook.xml"],
    );
  });

  it("refuses an invalid template and malformed day values", async () => {
    const bad = await syntheticTemplate({ merges: ["F11:G11"] });
    expect(() => populateExcelTemplate(bad, DEFAULT_MAPPING, values)).toThrow(
      ValidationError,
    );
    const good = await syntheticTemplate();
    expect(() =>
      populateExcelTemplate(good, DEFAULT_MAPPING, new Map([["1001", ["M"]]])),
    ).toThrow(RangeError);
  });
});
