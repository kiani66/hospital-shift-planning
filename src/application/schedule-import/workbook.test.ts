import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  parseScheduleWorkbook,
  scheduleWorkbookTemplate,
  SCHEDULE_IMPORT_LIMITS,
} from "./workbook";

async function file(
  dayCount = 30,
  modify?: (sheet: ExcelJS.Worksheet) => void,
) {
  const w = new ExcelJS.Workbook();
  const s = w.addWorksheet("Schedule");
  s.addRow([
    "شماره پرسنلی",
    "نام و نام خانوادگی",
    ...Array.from({ length: dayCount }, (_, i) => i + 1),
  ]);
  s.addRow(["00123", "فرد نمونه", " m ", "e", "N", "ME", "h", "off", ""]);
  modify?.(s);
  return new Uint8Array(await w.xlsx.writeBuffer());
}
describe("standard monthly xlsx reader", () => {
  it.each([
    [1405, 12, 29],
    [1405, 7, 30],
    [1405, 1, 31],
    [1403, 12, 30],
  ])("reads %i/%i with %i day columns", async (year, month, count) => {
    const parsed = await parseScheduleWorkbook(await file(count!), count!);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]!.days).toHaveLength(count!);
    expect(parsed.rows[0]!.days.slice(0, 7)).toEqual([
      "M",
      "E",
      "N",
      "ME",
      "H",
      "OFF",
      "OFF",
    ]);
    expect(parsed.rows[0]!.personnelNumber).toBe("00123");
  });
  it("uses the sanitized NICU normalized fixture with nurse, head and secretary", async () => {
    const parsed = await parseScheduleWorkbook(
      readFileSync(
        "tests/fixtures/schedule-import/nicu-mehr-1405-standardized.xlsx",
      ),
      30,
    );
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[2]!.days.slice(0, 6)).toEqual([
      "M",
      "M",
      "OFF",
      "H",
      "ME",
      "OFF",
    ]);
  });
  it("rejects the real-world print layout instead of guessing identities or columns", async () => {
    await expect(
      parseScheduleWorkbook(
        readFileSync(
          "tests/fixtures/schedule-import/nicu-print-layout-sanitized.xlsx",
        ),
        30,
      ),
    ).rejects.toThrow();
  });
  it("skips empty rows and decorative blank columns; ignores day 31 in a 30-day month", async () => {
    const parsed = await parseScheduleWorkbook(
      await file(31, (s) => {
        s.getCell("AG2").value = "ambiguous";
        s.getCell("AH1").value = "";
        s.getCell("A5").value = "";
      }),
      30,
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.days).toHaveLength(30);
    expect(parsed.issues).toEqual([]);
  });
  it.each(["MN", "تعطیل", "=M"])(
    "reports unknown %s with row/cell/day",
    async (code) => {
      const parsed = await parseScheduleWorkbook(
        await file(30, (s) => {
          s.getCell("E2").value = code;
        }),
        30,
      );
      expect(parsed.issues).toMatchObject([{ row: 2, cell: "E2", day: 3 }]);
    },
  );
  it("rejects formulas, ambiguous identity and duplicate rows", async () => {
    const parsed = await parseScheduleWorkbook(
      await file(30, (s) => {
        s.getCell("C2").value = { formula: '"M"', result: "M" };
        s.addRow(["00123", "فرد نمونه"]);
        s.addRow([null, "بی شماره"]);
      }),
      30,
    );
    expect(parsed.issues.some((i) => i.cell === "C2")).toBe(true);
    expect(
      parsed.issues.some((i) => i.row === 3 && i.message.includes("تکرار")),
    ).toBe(true);
    expect(parsed.issues.some((i) => i.row === 4 && i.cell === "A4")).toBe(
      true,
    );
  });
  it.each(["duplicate", "missing", "merged", "too many", "extra"])(
    "rejects malformed template: %s",
    async (kind) => {
      const bytes = await file(30, (s) => {
        if (kind === "duplicate") s.getCell("D1").value = 1;
        if (kind === "missing") s.getCell("D1").value = "";
        if (kind === "merged") s.mergeCells("C2:D2");
        if (kind === "too many") s.getCell("A502").value = "too many";
        if (kind === "extra") s.getCell("AG1").value = "unsupported";
      });
      await expect(parseScheduleWorkbook(bytes, 30)).rejects.toThrow();
    },
  );
  it("rejects missing name, precision loss, credential objects and nonempty unlabelled cells", async () => {
    const parsed = await parseScheduleWorkbook(
      await file(30, (s) => {
        s.getCell("A2").value = 1234567890123456;
        s.getCell("B2").value = null;
        s.getCell("AG2").value = "unexpected";
      }),
      30,
    );
    expect(parsed.issues.map((i) => i.cell)).toEqual(["A2", "B2", "AG2"]);
  });
  it("bounds input bytes, ZIP expansion, entry count and unsafe external/macro parts", async () => {
    await expect(
      parseScheduleWorkbook(
        new Uint8Array(SCHEDULE_IMPORT_LIMITS.maxBytes + 1),
        30,
      ),
    ).rejects.toThrow();
    await expect(
      parseScheduleWorkbook(new Uint8Array([1, 2, 3]), 30),
    ).rejects.toThrow();
    for (const entries of [
      {
        "xl/workbook.xml": new Uint8Array(
          SCHEDULE_IMPORT_LIMITS.maxExpandedBytes + 1,
        ),
      },
      {
        "xl/workbook.xml": new Uint8Array(),
        "xl/externalLinks/externalLink1.xml": new Uint8Array(),
      },
      Object.fromEntries(
        Array.from({ length: 129 }, (_, i) => [`file${i}`, new Uint8Array()]),
      ),
    ])
      await expect(
        parseScheduleWorkbook(zipSync(entries), 30),
      ).rejects.toThrow();
  });
  it("produces downloadable RTL templates with exact month columns", async () => {
    const w = new ExcelJS.Workbook();
    await w.xlsx.load(
      Buffer.from(
        await scheduleWorkbookTemplate(29, true),
      ) as unknown as Parameters<typeof w.xlsx.load>[0],
    );
    expect(w.worksheets[0]!.views[0]!.rightToLeft).toBe(true);
    expect(
      (
        await parseScheduleWorkbook(
          await scheduleWorkbookTemplate(29, true),
          29,
        )
      ).rows,
    ).toHaveLength(3);
    await expect(
      parseScheduleWorkbook(await scheduleWorkbookTemplate(30), 30),
    ).rejects.toThrow(/ردیف/);
  });
});
