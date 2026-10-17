import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";

import type { ExcelTemplateMapping } from "../../src/domain/excel-export/template-mapping";
import { patchXlsx, sheetPart } from "./excel-templates";

/**
 * A sanitized equivalent of the NICU print workbook (D124), built to the
 * structure of the hospital's approved `Template_Export.xlsx` (verified cell
 * by cell). The real file is never committed: every name, personnel number
 * and figure here is fictional.
 *
 * - one worksheet `Sheet2`, right-to-left, frozen under row 6, page-break
 *   preview; no merged cells;
 * - title cells X1 (hospital), A2/A3 (last month's care notes), U3 (month
 *   heading «مهرماه 1405»), AM3 (department);
 * - row 5: the weekday row, empty, its 31 day cells bordered and filled;
 * - row 6: the header (A «ردیف», B «شماره سیستم» = personnel number, C/D
 *   names, …, J «ساعت موظفی», K «مرخصی», L «تعداد شیفت», M «قرارداد»)
 *   and the day numbers 1–31 as text in N–AR;
 * - nurses on rows 7–21, the secretary («منشی») on row 22, every number in
 *   B as text; static totals in J–L;
 * - daily counts on rows 23–25 (no label; notes overflow from C24/C25),
 *   AQ (day 30) empty as in the hospital file;
 * - static averages on rows 26–29 and the signatures on row 28;
 * - the saved month is Mehr 1405: its Fridays (days 3, 10, 17, 24 = P, W,
 *   AD, AK) have the holiday fill in rows 7–25; the header rows 5–6 have that
 *   same fill on every day;
 * - day cells with differing borders (row 15) and alignment (row 21);
 * - print area A1:AS31, landscape, scale 89, a manual column break at AY,
 *   hidden columns AU, AW and AX, stray values outside the print area.
 */

export const NICU_SHEET = "Sheet2";
export const NICU_NURSE_ROWS = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
] as const;
export const NICU_SECRETARY_ROW = 22;
export const NICU_PERSONNEL_ROWS = [
  ...NICU_NURSE_ROWS,
  NICU_SECRETARY_ROW,
] as const;
export const NICU_SUMMARY_ROWS = [23, 24, 25] as const;
export const NICU_WEEKDAY_ROW = 5;
export const NICU_DAY_ROW = 6;
/** Column N: day 1; day 31 is AR. */
export const NICU_FIRST_DAY = 14;
/** The Fridays of the month the file was saved in (Mehr 1405): P, W, AD, AK. */
export const NICU_SAVED_FRIDAYS = [3, 10, 17, 24] as const;

/** Fictional personnel numbers, as text; the secretary's keeps a leading zero. */
export const nicuNumber = (row: number) =>
  row === NICU_SECRETARY_ROW ? "07022" : String(7000 + row);

/** The NICU mapping, as verified against the hospital's workbook. */
export const NICU_MAPPING = {
  sheetName: NICU_SHEET,
  personnelColumn: "B",
  firstRow: 7,
  lastRow: 22,
  firstDayColumn: "N",
  dayHeaderRow: NICU_DAY_ROW,
  statisticColumns: [
    // «ساعت موظفی» is contractual: the system cannot calculate it.
    { column: "J", statistic: "CLEAR" },
    { column: "K", statistic: "LEAVE_DAYS" },
    { column: "L", statistic: "SHIFT_COUNT" },
  ],
  summaryRows: [
    { row: 23, statistic: "COVERAGE_M" },
    { row: 24, statistic: "COVERAGE_E" },
    { row: 25, statistic: "COVERAGE_N" },
  ],
  weekdayRow: NICU_WEEKDAY_ROW,
  // The day columns are about three characters wide.
  weekdayFormat: "NARROW",
  monthHeadingCell: "U3",
  holidayFillCell: "P7",
  normalFillColumn: "O",
} as const satisfies ExcelTemplateMapping;

export interface NicuTemplateOptions {
  /** Default `A1:AS31`, as found. */
  readonly printArea?: string;
  /**
   * Personnel numbers in column B by row (default `nicuNumber` for rows
   * 7–22); `false` leaves B empty, a workbook without numbers.
   */
  readonly numbers?: ReadonlyMap<number, string> | false;
  /**
   * Rows that hold a person (default 7–22); the other personnel rows keep
   * only their borders and fills, for a department with fewer people.
   */
  readonly peopleRows?: readonly number[];
}

const thin = { style: "thin" as const, color: { argb: "FF000000" } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
/** Row 15: the day cells have no left border (Q15 only left and right). */
const openLeft = { top: thin, bottom: thin, right: thin };
const sides = { left: thin, right: thin };

const solid = (fgColor: Partial<ExcelJS.Color>): ExcelJS.Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor,
  bgColor: { indexed: 64 } as Partial<ExcelJS.Color>,
});
/** The template's holiday (and header) fill: theme colour 3, tint 0.6. */
const HOLIDAY = solid({ theme: 3, tint: 0.5999938962981048 } as never);
const WHITE = solid({ theme: 0 } as never);

const titr = { name: "B Titr", size: 11 };
const body = { name: "Cambria", size: 11 };

const HEADER = [
  "رديف",
  "شماره سیستم",
  "نام",
  "نام خانوادگي",
  "سمت",
  "شيفت",
  "تخصص",
  "سايقه كار- سال",
  "سايقه كار-ماه",
  "ساعت موظفي",
  "مرخصی",
  "تعداد شیفت",
  "قرارداد ",
];

export async function nicuTemplate(
  options: NicuTemplateOptions = {},
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "sanitized-nicu-fixture";
  const sheet = workbook.addWorksheet(NICU_SHEET, {
    views: [
      {
        rightToLeft: true,
        state: "frozen",
        ySplit: 6,
        topLeftCell: "A7",
        style: "pageBreakPreview",
      } as ExcelJS.WorksheetView,
    ],
    pageSetup: {
      orientation: "landscape",
      paperSize: 258 as ExcelJS.PaperSize,
      scale: 89,
      printArea: options.printArea ?? "A1:AS31",
      margins: {
        left: 0.0394,
        right: 0.1575,
        top: 0.1575,
        bottom: 0.1575,
        header: 0.4331,
        footer: 0.1181,
      },
    },
  });
  const dayColumn = (day: number) => NICU_FIRST_DAY + day - 1;
  const friday = (day: number) =>
    (NICU_SAVED_FRIDAYS as readonly number[]).includes(day);

  // Titles and notes (fictional).
  sheet.getCell("X1").value = "بیمارستان آموزشی نمونه";
  sheet.getCell("X1").font = { ...titr, size: 16, bold: true };
  sheet.getCell("A2").value =
    "تعداد و ساعت مراقبت پرستاری بیماران سطح 4 (ماه گذشته): 9 نفر و 12 ساعت";
  sheet.getCell("A3").value =
    "تعداد و ساعت مراقبت پرستاری بیماران سطح 5 (ماه گذشته): 7 نفر و 10 ساعت";
  sheet.getCell("N3").value = "    ";
  sheet.getCell("U3").value = "مهرماه 1405";
  sheet.getCell("U3").font = { name: "Calibri", size: 20, bold: true };
  sheet.getCell("U3").alignment = { horizontal: "center" };
  sheet.getCell("AM3").value = "بخش نمونه ان آی سی یو";
  sheet.getRow(1).height = 19.5;
  sheet.getRow(3).height = 20.25;

  // Row 5: the weekday row; row 6: the header and the day numbers.
  for (let day = 1; day <= 31; day++) {
    const weekday = sheet.getCell(NICU_WEEKDAY_ROW, dayColumn(day));
    weekday.border = box;
    weekday.fill = HOLIDAY;
    weekday.font = titr;
    weekday.alignment = { horizontal: "center", vertical: "middle" };
    const number = sheet.getCell(NICU_DAY_ROW, dayColumn(day));
    number.value = String(day);
    number.border = box;
    number.fill = HOLIDAY;
    number.font = { name: "Arial", size: 10, bold: true };
    number.alignment = {
      horizontal: "center",
      vertical: "middle",
      shrinkToFit: true,
    };
  }
  HEADER.forEach((title, i) => {
    const cell = sheet.getCell(NICU_DAY_ROW, i + 1);
    cell.value = title;
    cell.border = box;
    cell.font = { ...titr, size: 9, bold: true };
  });
  sheet.getRow(NICU_DAY_ROW).height = 22.5;

  const numbers =
    options.numbers === false
      ? new Map<number, string>()
      : (options.numbers ??
        new Map(NICU_PERSONNEL_ROWS.map((row) => [row, nicuNumber(row)])));
  const people = new Set<number>(options.peopleRows ?? NICU_PERSONNEL_ROWS);
  const dayCells = (row: number) => {
    for (let day = 1; day <= 31; day++) {
      const cell = sheet.getCell(row, dayColumn(day));
      cell.fill = friday(day) ? HOLIDAY : WHITE;
      cell.font = body;
      cell.border = row === 15 ? (day === 4 ? sides : openLeft) : box;
      cell.alignment =
        row === 21 && day === 1
          ? { horizontal: "center", shrinkToFit: true }
          : { horizontal: "center", vertical: "middle", shrinkToFit: true };
    }
  };
  for (const row of NICU_PERSONNEL_ROWS) {
    sheet.getRow(row).height = 20.1;
    for (let c = 1; c <= 13; c++) sheet.getCell(row, c).border = box;
    dayCells(row);
    if (!people.has(row)) continue;
    const index = row - 6;
    const secretary = row === NICU_SECRETARY_ROW;
    const values = [
      String(index),
      numbers.get(row) ?? null,
      `نام${index}`,
      `خانوادگی${index}`,
      index === 1 ? "سرپرستار" : secretary ? "منشی" : "پرستار",
      index % 3 ? "درگردش" : "دونوبتی",
      ["ICU", "EM", "PICU", "اطفال"][index % 4]!,
      String(3 + index),
      String(index % 12),
      // Last month's static totals: contractual hours, leave and shifts.
      String(140 + (index % 4) * 6),
      index % 3 ? String(index % 7) : null,
      String(18 + (index % 9)),
      index % 2 ? "رسمی" : "شرکتی",
    ];
    values.forEach((value, i) => {
      const cell = sheet.getCell(row, i + 1);
      if (value !== null) cell.value = value;
      cell.font = { ...titr, size: 8 };
    });
  }

  // Rows 23–25: last month's daily counts, as text; day 30 (AQ) empty.
  for (const row of NICU_SUMMARY_ROWS) {
    sheet.getRow(row).height = 20.1;
    dayCells(row);
    for (let day = 1; day <= 31; day++)
      if (day !== 30)
        sheet.getCell(row, dayColumn(day)).value = day % 9 ? "3" : "4";
  }
  sheet.getCell("C24").value =
    "علامت S1 تا S8 به منزله اولویت مسئول شیفت می‌باشد.";
  sheet.getCell("C25").value = "همه پرسنل مسئول آموزش به بیمار می‌باشند.";
  sheet.getCell("C26").value = "میانگین سنوات حرفه‌ای: 9";
  sheet.getCell("F26").value = "12";
  sheet.getCell("G26").value = "میانگین موظف غیرحرفه‌ای:";
  sheet.getCell("C27").value = "جمع مرخصی حرفه‌ای:";
  sheet.getCell("F27").value = "40";
  sheet.getCell("G27").value = "میانگین تعداد شیفت حرفه‌ای:";
  sheet.getCell("N27").value = "21";
  sheet.getCell("C29").value = "میانگین موظف حرفه‌ای:";
  sheet.getCell("G29").value = "150";
  sheet.getCell("V28").value = "مهر و امضاء سرپرستار";
  sheet.getCell("AD28").value = "مهر و امضاء سوپروایزر";
  sheet.getCell("AK28").value = "مهر و امضاء مدیر پرستاری";
  // Stray values outside the print area, kept as they are.
  sheet.getCell("AZ23").value = "31";
  sheet.getCell("BA42").value = "3";
  sheet.getCell("BM127").border = { bottom: thin };

  sheet.getColumn(1).width = 2.86;
  sheet.getColumn(2).width = 8.71;
  sheet.getColumn(3).width = 5.86;
  sheet.getColumn(4).width = 6.43;
  for (let day = 1; day <= 31; day++)
    sheet.getColumn(dayColumn(day)).width = 3.29;
  for (const hidden of [47, 49, 50]) sheet.getColumn(hidden).hidden = true;

  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  // A manual column break after AY, which ExcelJS does not write itself.
  const part = sheetPart(bytes, NICU_SHEET);
  const xml = strFromU8(unzipSync(bytes)[part]!);
  return patchXlsx(bytes, {
    [part]: xml.replace(
      /(<pageSetup\b[^>]*\/>)/,
      '$1<colBreaks count="1" manualBreakCount="1"><brk id="51" max="1048575" man="1"/></colBreaks>',
    ),
  });
}
