import ExcelJS from "exceljs";
import { Unzip, UnzipInflate, unzipSync } from "fflate";

import { normalizeDisplayName } from "../../domain/identity/normalize";
import { parsePersonnelNumber } from "../../domain/identity/personnel-number";
import { parseSpreadsheetDayCode } from "../../domain/shifts/spreadsheet-codes";
import type { AssignmentCode } from "../../domain/shifts/shift-type";
import { ValidationError } from "../../domain/shared/errors";
import { IMPORT_HEADERS, normalizeHeader } from "../personnel-import/rows";

export const SCHEDULE_IMPORT_LIMITS = {
  maxBytes: 512 * 1024,
  maxRows: 500,
  maxColumns: 40,
  maxEntries: 128,
  maxExpandedBytes: 8 * 1024 * 1024,
} as const;

export interface WorkbookIssue {
  readonly row: number;
  readonly cell: string;
  readonly day?: number;
  readonly message: string;
}
export interface WorkbookRow {
  readonly line: number;
  readonly personnelNumber: string;
  readonly displayName: string;
  readonly days: readonly AssignmentCode[];
}
export interface ParsedWorkbook {
  readonly rows: readonly WorkbookRow[];
  readonly issues: readonly WorkbookIssue[];
}
const invalid = (message: string): never => {
  throw new ValidationError(message, "file", "SCHEDULE_IMPORT_FILE");
};

/** Bound decompression before ExcelJS sees any XML; never evaluate formulas or links. */
function validateArchive(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > SCHEDULE_IMPORT_LIMITS.maxBytes)
    invalid("فایل باید حداکثر ۵۱۲ کیلوبایت باشد.");
  let entries = 0;
  let expanded = 0;
  const names = new Set<string>();
  try {
    unzipSync(bytes, {
      filter(entry) {
        entries++;
        expanded += entry.originalSize;
        if (
          entries > SCHEDULE_IMPORT_LIMITS.maxEntries ||
          expanded > SCHEDULE_IMPORT_LIMITS.maxExpandedBytes ||
          names.has(entry.name) ||
          /vbaProject|externalLinks/i.test(entry.name)
        )
          invalid(
            "ساختار یا حجم بازشده فایل مجاز نیست؛ از الگوی استاندارد استفاده کنید.",
          );
        names.add(entry.name);
        // Inspect the archive directory without inflating any entry here.
        return false;
      },
    });
  } catch {
    invalid("فایل Excel معتبر یا مجاز نیست؛ از الگوی استاندارد استفاده کنید.");
  }
  // Validate actual inflated sizes too, including archives whose directory lies.
  // Small compressed chunks bound the decoder's allocation between callbacks.
  let actualBytes = 0;
  const decoder = new Unzip((entry) => {
    entry.ondata = (error, data) => {
      if (error) invalid("فایل فشرده معتبر نیست.");
      actualBytes += data.length;
      if (actualBytes > SCHEDULE_IMPORT_LIMITS.maxExpandedBytes) {
        entry.terminate();
        invalid("حجم واقعی بازشده فایل بیش از حد مجاز است.");
      }
    };
    entry.start();
  });
  decoder.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 1024)
      decoder.push(
        bytes.subarray(offset, offset + 1024),
        offset + 1024 >= bytes.length,
      );
  } catch {
    invalid("فایل فشرده معتبر یا مجاز نیست.");
  }
  if (!names.has("xl/workbook.xml"))
    invalid("فقط فایل استاندارد .xlsx پذیرفته می‌شود.");
}

export async function parseScheduleWorkbook(
  bytes: Uint8Array,
  dayCount: number,
): Promise<ParsedWorkbook> {
  if (![29, 30, 31].includes(dayCount)) invalid("طول ماه معتبر نیست.");
  validateArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    invalid("فایل Excel خوانده نشد؛ از الگوی استاندارد استفاده کنید.");
  }
  const sheets = workbook.worksheets.filter((s) => s.actualRowCount > 0);
  if (sheets.length !== 1 || sheets[0]!.state !== "visible")
    invalid("فایل باید یک برگه قابل مشاهده با داده داشته باشد.");
  const sheet = sheets[0]!;
  if (
    sheet.rowCount > SCHEDULE_IMPORT_LIMITS.maxRows + 1 ||
    sheet.columnCount > SCHEDULE_IMPORT_LIMITS.maxColumns
  )
    invalid("فایل بیش از ۵۰۰ ردیف یا ۴۰ ستون دارد.");
  if (sheet.model.merges.length)
    invalid("خانه‌های ادغام‌شده مجاز نیست؛ از الگوی استاندارد استفاده کنید.");
  const text = (cell: ExcelJS.Cell): string | null => {
    if (cell.value === null || cell.value === undefined) return "";
    if (typeof cell.value === "string") return cell.value;
    if (typeof cell.value === "number" && Number.isSafeInteger(cell.value))
      return String(cell.value);
    return null;
  };
  const columns = new Map<string, number>();
  const ignored = new Set<number>();
  const aliases = (field: "personnelNumber" | "displayName") =>
    IMPORT_HEADERS[field].map(normalizeHeader);
  for (let i = 1; i <= sheet.columnCount; i++) {
    const raw = text(sheet.getCell(1, i));
    if (raw === null) invalid("سرستون باید متن یا شماره روز باشد.");
    const h = normalizeHeader(raw!);
    const day = /^\d{1,2}$/.test(h) ? Number(h) : null;
    const key = aliases("personnelNumber").includes(h)
      ? "personnelNumber"
      : aliases("displayName").includes(h)
        ? "displayName"
        : day !== null && day >= 1 && day <= 31
          ? String(day)
          : null;
    if (!key) {
      if (h) invalid(`سرستون ناشناخته: ${raw}`);
      ignored.add(i);
      continue;
    }
    if (columns.has(key)) invalid(`سرستون تکراری: ${raw}`);
    columns.set(key, i);
  }
  for (const key of [
    "personnelNumber",
    "displayName",
    ...Array.from({ length: dayCount }, (_, i) => String(i + 1)),
  ])
    if (!columns.has(key))
      invalid(
        `ستون الزامی موجود نیست: ${key === "personnelNumber" ? "شماره پرسنلی" : key === "displayName" ? "نام و نام خانوادگی" : key}`,
      );
  const rows: WorkbookRow[] = [];
  const issues: WorkbookIssue[] = [];
  const issue = (line: number, column: number, message: string, day?: number) =>
    issues.push({
      row: line,
      cell: sheet.getCell(line, column).address,
      message,
      ...(day ? { day } : {}),
    });
  for (let line = 2; line <= sheet.rowCount; line++) {
    const row = sheet.getRow(line);
    // Decorative columns and days outside the month never create assignments.
    const used = [
      columns.get("personnelNumber")!,
      columns.get("displayName")!,
      ...Array.from({ length: dayCount }, (_, i) =>
        columns.get(String(i + 1))!,
      ),
    ];
    if (used.every((c) => (text(row.getCell(c)) ?? "invalid").trim() === ""))
      continue;
    const numberCol = columns.get("personnelNumber")!;
    const nameCol = columns.get("displayName")!;
    const rawNumber = text(row.getCell(numberCol));
    const number = parsePersonnelNumber(rawNumber ?? "");
    // Numeric identifiers beyond Excel's exact 15-digit precision cannot be trusted.
    if (
      !number.ok ||
      (typeof row.getCell(numberCol).value === "number" &&
        (rawNumber?.length ?? 0) > 15)
    )
      issue(
        line,
        numberCol,
        "شماره پرسنلی معتبر و تأییدشده لازم است؛ شماره‌های بلند را به صورت متن ذخیره کنید.",
      );
    const rawName = text(row.getCell(nameCol));
    const displayName = normalizeDisplayName(rawName ?? "");
    if (!displayName || displayName.length > 200)
      issue(line, nameCol, "نام و نام خانوادگی معتبر لازم است.");
    for (const c of ignored)
      if ((text(row.getCell(c)) ?? "invalid").trim())
        issue(line, c, "ستون بدون عنوان باید خالی باشد.");
    const days: AssignmentCode[] = [];
    for (let day = 1; day <= dayCount; day++) {
      const column = columns.get(String(day))!;
      const value = text(row.getCell(column));
      const parsed = value === null ? null : parseSpreadsheetDayCode(value);
      if (!parsed?.ok) {
        issue(
          line,
          column,
          `کد روز نامعتبر است: ${(value ?? "فرمول یا مقدار غیرمتنی").slice(0, 80)}`,
          day,
        );
        // Placeholder is never committable: the cell error blocks the whole file.
        days.push("OFF");
      } else
        days.push(parsed.value.kind === "EMPTY" ? "OFF" : parsed.value.code);
    }
    rows.push({
      line,
      personnelNumber: number.ok ? number.value : (rawNumber ?? ""),
      displayName,
      days,
    });
  }
  if (!rows.length) invalid("فایل ردیف پرسنل ندارد.");
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.personnelNumber))
      issue(
        row.line,
        columns.get("personnelNumber")!,
        "شماره پرسنلی در فایل تکرار شده است.",
      );
    seen.add(row.personnelNumber);
  }
  return { rows, issues };
}

/** Fictional examples only; users replace identifiers with verified personnel numbers. */
export async function scheduleWorkbookTemplate(
  dayCount: number,
  sample = false,
): Promise<Uint8Array> {
  if (![29, 30, 31].includes(dayCount)) invalid("طول ماه معتبر نیست.");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("برنامه ماهانه", {
    views: [{ rightToLeft: true, state: "frozen", xSplit: 2, ySplit: 1 }],
  });
  sheet.addRow([
    "شماره پرسنلی",
    "نام و نام خانوادگی",
    ...Array.from({ length: dayCount }, (_, i) => i + 1),
  ]);
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn(1).numFmt = "@";
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 26;
  if (sample)
    for (const [number, name, codes] of [
      ["1001", "سرپرستار نمونه", ["M", "E", "N", "", "ME", "H"]],
      ["1002", "پرستار نمونه", ["N", "", "ME", "H", "M", "E"]],
      ["1003", "منشی نمونه", ["M", "M", "", "H", "ME", "OFF"]],
    ] as const)
      sheet.addRow([
        number,
        name,
        ...Array.from({ length: dayCount }, (_, i) => codes[i % codes.length]),
      ]);
  for (let i = 3; i <= dayCount + 2; i++) {
    sheet.getColumn(i).width = 6;
    for (let row = 2; row <= 501; row++)
      sheet.getCell(row, i).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"M,E,N,ME,OFF,H"'],
      };
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
