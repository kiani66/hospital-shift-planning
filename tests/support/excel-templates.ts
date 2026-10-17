import ExcelJS from "exceljs";
import { unzipSync, zipSync, strToU8 } from "fflate";

/**
 * Synthetic Excel export templates (D124). The real hospital workbook is not
 * available; these imitate a print layout: titles in merged cells, a hidden
 * personnel-number column, names and job titles, decorative and blank rows,
 * people in arbitrary order, borders, fills, row heights and column widths,
 * a per-person formula total, a signature row and print settings. All names
 * and numbers are fictional.
 */

export interface TemplatePersonRow {
  readonly row: number;
  /** Written as text unless `numeric`. */
  readonly number: string;
  readonly name: string;
  readonly title?: string;
  readonly numeric?: boolean;
}

export interface SyntheticTemplateOptions {
  readonly sheetName?: string;
  /** Extra sheets before the mapped one. */
  readonly otherSheets?: readonly string[];
  readonly personnelColumn?: number;
  readonly firstDayColumn?: number;
  readonly people?: readonly TemplatePersonRow[];
  readonly hidePersonnelColumn?: boolean;
  /** Values already sitting in day cells: [row, day, value]. */
  readonly staleDays?: readonly (readonly [number, number, string])[];
  /** Extra cell writes, e.g. a formula: [address, value]. */
  readonly extraCells?: readonly (readonly [string, ExcelJS.CellValue])[];
  readonly merges?: readonly string[];
  readonly protect?: boolean;
  /** Unlock the day cells of personnel rows when `protect` is set. */
  readonly unlockDays?: boolean;
  readonly totals?: boolean;
}

export const DEFAULT_PEOPLE: readonly TemplatePersonRow[] = [
  { row: 7, number: "1003", name: "پرستار نمونه سوم", title: "پرستار" },
  { row: 8, number: "0042", name: "سرپرستار نمونه", title: "سرپرستار" },
  // Row 9 is blank spacing; row 10 a subheading without a personnel number.
  { row: 11, number: "1001", name: "پرستار نمونه یکم", title: "پرستار" },
  {
    row: 12,
    number: "1002",
    name: "منشی نمونه",
    title: "منشی",
    numeric: true,
  },
  { row: 13, number: "1009", name: "پرستار بدون برنامه", title: "پرستار" },
];

export const DEFAULT_MAPPING = {
  sheetName: "برنامه ماهانه",
  personnelColumn: "B",
  firstRow: 7,
  lastRow: 14,
  firstDayColumn: "F",
} as const;

const thin = { style: "thin" as const, color: { argb: "FF7F7F7F" } };

export async function syntheticTemplate(
  options: SyntheticTemplateOptions = {},
): Promise<Uint8Array> {
  const personnelColumn = options.personnelColumn ?? 2;
  const firstDay = options.firstDayColumn ?? 6;
  const people = options.people ?? DEFAULT_PEOPLE;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "synthetic-test";
  for (const name of options.otherSheets ?? [])
    workbook.addWorksheet(name).getCell("A1").value = "برگه دیگر";
  const sheet = workbook.addWorksheet(
    options.sheetName ?? DEFAULT_MAPPING.sheetName,
    {
      views: [{ rightToLeft: true }],
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printArea: "A1:AL20",
        margins: {
          left: 0.25,
          right: 0.3,
          top: 0.5,
          bottom: 0.45,
          header: 0.2,
          footer: 0.2,
        },
      },
      headerFooter: { oddFooter: "&Cصفحه &P" },
    },
  );
  sheet.mergeCells("A1:AL1");
  sheet.getCell("A1").value = "بیمارستان نمونه";
  sheet.getCell("A1").font = { bold: true, size: 16, name: "B Nazanin" };
  sheet.getCell("A1").alignment = { horizontal: "center" };
  sheet.mergeCells("A2:AL2");
  sheet.getCell("A2").value = "بخش مراقبت‌های ویژه نوزادان";
  sheet.mergeCells("A3:AL3");
  sheet.getCell("A3").value = "برنامه ماه مهر ۱۴۰۵";
  sheet.getRow(1).height = 32;
  sheet.getRow(6).height = 24;
  sheet.getCell(6, 1).value = "ردیف";
  sheet.getCell(6, personnelColumn).value = "شماره پرسنلی";
  sheet.getCell(6, 3).value = "نام و نام خانوادگی";
  sheet.getCell(6, 4).value = "سمت";
  for (let d = 1; d <= 31; d++) {
    const cell = sheet.getCell(6, firstDay + d - 1);
    cell.value = d;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFDDEBF7" },
    };
    sheet.getColumn(firstDay + d - 1).width = 4.5;
  }
  sheet.getColumn(3).width = 24;
  sheet.getColumn(personnelColumn).width = 12;
  if (options.hidePersonnelColumn ?? true)
    sheet.getColumn(personnelColumn).hidden = true;
  sheet.getCell("C10").value = "پرستاران";
  sheet.getCell("C10").font = { italic: true };
  for (const [i, person] of people.entries()) {
    sheet.getCell(person.row, 1).value = i + 1;
    const number = sheet.getCell(person.row, personnelColumn);
    number.value = person.numeric ? Number(person.number) : person.number;
    sheet.getCell(person.row, 3).value = person.name;
    sheet.getCell(person.row, 4).value = person.title ?? "پرستار";
    sheet.getRow(person.row).height = 20;
    for (let d = 1; d <= 31; d++) {
      const cell = sheet.getCell(person.row, firstDay + d - 1);
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
      cell.alignment = { horizontal: "center" };
      cell.font = { name: "Tahoma", size: 9, color: { argb: "FF1F4E79" } };
      if (options.protect && options.unlockDays)
        cell.protection = { locked: false };
    }
    if (options.totals ?? true)
      sheet.getCell(person.row, firstDay + 31).value = {
        formula: `COUNTIF(${sheet.getCell(person.row, firstDay).address}:${sheet.getCell(person.row, firstDay + 30).address},"N")`,
        result: 0,
      };
  }
  for (const [row, day, value] of options.staleDays ?? [])
    sheet.getCell(row, firstDay + day - 1).value = value;
  for (const [address, value] of options.extraCells ?? [])
    sheet.getCell(address).value = value;
  for (const range of options.merges ?? []) sheet.mergeCells(range);
  sheet.getCell("C18").value = "امضای سرپرستار";
  sheet.getCell("H18").value = "امضای سوپروایزر";
  if (options.protect) await sheet.protect("", {});
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

/** The parts of an xlsx, decompressed. */
export const xlsxParts = (bytes: Uint8Array) => unzipSync(bytes);

/** Rebuilds an xlsx with some parts replaced, added or (undefined) removed. */
export function patchXlsx(
  bytes: Uint8Array,
  patch: Record<string, string | Uint8Array | undefined>,
): Uint8Array {
  const parts: Record<string, Uint8Array> = { ...unzipSync(bytes) };
  for (const [name, value] of Object.entries(patch))
    if (value === undefined) delete parts[name];
    else parts[name] = typeof value === "string" ? strToU8(value) : value;
  return zipSync(parts);
}

/** The worksheet part of the first sheet named `name`. */
export function sheetPart(bytes: Uint8Array, name: string): string {
  const parts = unzipSync(bytes);
  const workbook = new TextDecoder().decode(parts["xl/workbook.xml"]);
  const sheet = new RegExp(
    `<sheet [^>]*name="${name}"[^>]*r:id="(rId\\d+)"`,
  ).exec(workbook);
  const rels = new TextDecoder().decode(parts["xl/_rels/workbook.xml.rels"]);
  const target =
    new RegExp(`Id="${sheet![1]}"[^>]*Target="([^"]+)"`).exec(rels) ??
    new RegExp(`Target="([^"]+)"[^>]*Id="${sheet![1]}"`).exec(rels);
  return `xl/${target![1]!.replace(/^\/?xl\//, "")}`;
}

/** Reads a workbook back with ExcelJS (an independent reader). */
export async function readWorkbook(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}
