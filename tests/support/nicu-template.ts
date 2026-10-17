import ExcelJS from "exceljs";

import type { ExcelTemplateMapping } from "../../src/domain/excel-export/template-mapping";

/**
 * A sanitized equivalent of the NICU print workbook (D124). The real file is
 * never committed; this one has the same structure with fictional people and
 * values:
 *
 * - worksheet `Sheet2` (after an unrelated `Sheet1`), right-to-left;
 * - merged title rows, the personnel header on row 6 (row number, first and
 *   last name in B/C, job title, …, the monthly totals I «ساعت موظفی»,
 *   J «مرخصی», K «تعداد شیفت», L «قرارداد», day numbers 1–30 in M–AP; AQ,
 *   the day-31 candidate, is empty);
 * - personnel on rows 7–21, a «منشی» caption on row 22, the secretary on 23;
 * - last month's codes still in the day cells and static totals in I–K;
 * - static daily counts on rows 25–27, signatures on row 30;
 * - landscape A4 fit-to-width print setup, margins, footer, print area.
 *
 * There is no personnel-number column: like the hospital's file it is
 * prepared by `writePersonnelColumn` from the system's records.
 */

export const NICU_SHEET = "Sheet2";
export const NICU_PERSONNEL_ROWS = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
] as const;
export const NICU_SECRETARY_ROW = 23;
export const NICU_SUMMARY_ROWS = [25, 26, 27] as const;
/** Outside the used range A1:BK128, so nothing printed moves. */
export const NICU_PERSONNEL_COLUMN = "BL";

/** The mapping of the prepared workbook (after the personnel column is added). */
export const NICU_MAPPING = {
  sheetName: NICU_SHEET,
  personnelColumn: NICU_PERSONNEL_COLUMN,
  firstRow: 7,
  lastRow: 23,
  firstDayColumn: "M",
  dayHeaderRow: 6,
  statisticColumns: [
    // Required hours are contractual: the system cannot calculate them.
    { column: "I", statistic: "CLEAR" },
    { column: "J", statistic: "LEAVE_DAYS" },
    { column: "K", statistic: "SHIFT_COUNT" },
  ],
  summaryRows: [
    { row: 25, statistic: "COVERAGE_M" },
    { row: 26, statistic: "COVERAGE_E" },
    { row: 27, statistic: "COVERAGE_N" },
  ],
} as const satisfies ExcelTemplateMapping;

export interface NicuTemplateOptions {
  /** e.g. `A1:AP31` (day 31 not printed, as found) or `A1:AQ31`. */
  readonly printArea?: string;
  /**
   * Rows that hold a person (default: 7–21 and 23); the other personnel rows
   * keep only their borders, for a department with fewer people.
   */
  readonly peopleRows?: readonly number[];
}

const FIRST_DAY = 13; // M
const thin = { style: "thin" as const, color: { argb: "FF000000" } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const STALE = ["M", "E", "N", null, "ME", "H", null, "M", "N", null] as const;

export async function nicuTemplate(
  options: NicuTemplateOptions = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "sanitized-nicu-fixture";
  workbook.addWorksheet("Sheet1").getCell("A1").value = "یادداشت";
  const sheet = workbook.addWorksheet(NICU_SHEET, {
    views: [{ rightToLeft: true }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printArea: options.printArea ?? "A1:AP31",
      margins: {
        left: 0.2,
        right: 0.2,
        top: 0.4,
        bottom: 0.4,
        header: 0.1,
        footer: 0.1,
      },
    },
    headerFooter: { oddFooter: "&Cبرنامه ماهانه بخش — صفحه &P" },
  });
  const font = { name: "B Nazanin", size: 11 };

  sheet.mergeCells("M1:AP1");
  sheet.getCell("M1").value = "بیمارستان نمونه";
  sheet.getCell("M1").font = { ...font, bold: true, size: 16 };
  sheet.getCell("M1").alignment = { horizontal: "center" };
  sheet.mergeCells("T3:Z3");
  sheet.getCell("T3").value = "مهرماه 1405";
  sheet.mergeCells("AL3:AP3");
  sheet.getCell("AL3").value = "بخش نمونه NICU";
  sheet.getRow(1).height = 30;

  const header = [
    "ردیف",
    "نام",
    "نام خانوادگی",
    "سمت",
    "شیفت",
    "تخصص",
    "سابقه سال",
    "سابقه ماه",
    "ساعت موظفی",
    "مرخصی",
    "تعداد شیفت",
    "قرارداد",
  ];
  header.forEach((title, i) => {
    const cell = sheet.getCell(6, i + 1);
    cell.value = title;
    cell.font = { ...font, bold: true };
    cell.border = box;
  });
  for (let d = 1; d <= 30; d++) {
    const cell = sheet.getCell(6, FIRST_DAY + d - 1);
    cell.value = d;
    cell.border = box;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9E1F2" },
    };
  }
  // AQ6: the day-31 heading is empty in the hospital's file.
  sheet.getCell(6, FIRST_DAY + 30).border = box;
  sheet.getRow(6).height = 26;

  const people = new Set(
    options.peopleRows ?? [...NICU_PERSONNEL_ROWS, NICU_SECRETARY_ROW],
  );
  const person = (row: number, index: number, title: string) => {
    sheet.getRow(row).height = 19;
    if (!people.has(row)) {
      for (let c = 1; c <= FIRST_DAY + 30; c++)
        sheet.getCell(row, c).border = box;
      return;
    }
    sheet.getCell(row, 1).value = index;
    sheet.getCell(row, 2).value = `نام${index}`;
    sheet.getCell(row, 3).value = `خانوادگی نمونه ${index}`;
    sheet.getCell(row, 4).value = title;
    sheet.getCell(row, 7).value = 3 + index;
    sheet.getCell(row, 8).value = index % 12;
    // Last month's static totals.
    sheet.getCell(row, 9).value = 176;
    sheet.getCell(row, 10).value = index % 3;
    sheet.getCell(row, 11).value = 20 + (index % 5);
    sheet.getCell(row, 12).value = index % 2 ? "رسمی" : "قراردادی";
    for (let c = 1; c <= 12; c++) {
      sheet.getCell(row, c).border = box;
      sheet.getCell(row, c).font = font;
    }
    for (let d = 1; d <= 31; d++) {
      const cell = sheet.getCell(row, FIRST_DAY + d - 1);
      const stale = d <= 30 ? STALE[(d + index) % STALE.length] : null;
      if (stale) cell.value = stale;
      cell.border = box;
      cell.alignment = { horizontal: "center" };
      cell.font = { name: "Tahoma", size: 9 };
    }
  };
  NICU_PERSONNEL_ROWS.forEach((row, i) =>
    person(row, i + 1, i === 0 ? "سرپرستار" : "پرستار"),
  );
  sheet.mergeCells("A22:L22");
  sheet.getCell("A22").value = "منشی";
  sheet.getCell("A22").font = { ...font, italic: true };
  person(NICU_SECRETARY_ROW, 16, "منشی");

  ["تعداد صبح", "تعداد عصر", "تعداد شب"].forEach((title, i) => {
    const row = NICU_SUMMARY_ROWS[i]!;
    sheet.mergeCells(row, 1, row, 12);
    sheet.getCell(row, 1).value = title;
    sheet.getCell(row, 1).font = { ...font, bold: true };
    for (let d = 1; d <= 31; d++) {
      const cell = sheet.getCell(row, FIRST_DAY + d - 1);
      if (d <= 30) cell.value = 4 - i; // Last month's static counts.
      cell.border = box;
    }
  });

  sheet.getCell("C30").value = "امضای سرپرستار";
  sheet.getCell("T30").value = "امضای سوپروایزر";
  sheet.getCell("AH30").value = "امضای مدیر پرستاری";
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 18;
  for (let c = FIRST_DAY; c <= FIRST_DAY + 30; c++)
    sheet.getColumn(c).width = 4.2;
  // The used range of the hospital's file ends at BK128.
  sheet.getCell("BK128").border = { bottom: thin };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
