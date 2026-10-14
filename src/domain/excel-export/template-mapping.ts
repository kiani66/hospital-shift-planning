import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import type { AssignmentCode } from "../shifts/shift-type";

/**
 * The cell mapping of a department's Excel export template (D124). Nothing
 * about a hospital layout is assumed: the worksheet, the personnel-number
 * column, the personnel rows and the first of the 31 consecutive day columns
 * all come from the configuration saved with the template.
 */
export interface ExcelTemplateMapping {
  readonly sheetName: string;
  /** Column letters, e.g. `B`. */
  readonly personnelColumn: string;
  readonly firstRow: number;
  readonly lastRow: number;
  /** Column letters of day 1; days 2–31 follow consecutively. */
  readonly firstDayColumn: string;
}

/** One universal template holds every month: days 30 and 31 stay blank in shorter months. */
export const EXCEL_TEMPLATE_DAY_COLUMNS = 31;

/** Limits of Excel's grid (XFD, 1,048,576) and of one department's personnel block. */
export const EXCEL_MAX_COLUMN = 16_384;
export const EXCEL_MAX_ROW = 1_048_576;
export const EXCEL_TEMPLATE_MAX_PERSONNEL_ROWS = 500;
/** Excel's own limit for a worksheet name. */
export const EXCEL_SHEET_NAME_MAX_LENGTH = 31;

const COLUMN_LETTERS = /^[A-Z]{1,3}$/;

/** `A` → 1, `AA` → 27; null for anything that is not an Excel column. */
export function columnIndex(letters: string): number | null {
  const value = letters.trim().toUpperCase();
  if (!COLUMN_LETTERS.test(value)) return null;
  let index = 0;
  for (const letter of value) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index <= EXCEL_MAX_COLUMN ? index : null;
}

/** 1 → `A`, 27 → `AA`. */
export function columnLetters(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > EXCEL_MAX_COLUMN)
    throw new RangeError(`Invalid column index: ${index}`);
  let letters = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/** `M7` from column 13 and row 7. */
export const cellAddress = (column: number, row: number): string =>
  `${columnLetters(column)}${row}`;

/** A mapping whose coordinates are known to be inside the grid and consistent. */
export interface ResolvedTemplateMapping extends ExcelTemplateMapping {
  readonly personnelColumnIndex: number;
  readonly firstDayColumnIndex: number;
  readonly lastDayColumnIndex: number;
}

/** Field → Persian message, for the mapping form. */
export type MappingErrors = Partial<Record<keyof ExcelTemplateMapping, string>>;

/**
 * Validates the coordinates on their own (the workbook checks come later).
 * Column letters are normalized to upper case; rows are 1-based.
 */
export function resolveTemplateMapping(
  input: ExcelTemplateMapping,
): Result<ResolvedTemplateMapping, MappingErrors> {
  const errors: MappingErrors = {};
  const sheetName = input.sheetName.trim();
  if (
    !sheetName ||
    sheetName.length > EXCEL_SHEET_NAME_MAX_LENGTH ||
    /[\\/?*[\]:]/.test(sheetName)
  )
    errors.sheetName = "نام Sheet معتبر نیست.";
  const personnel = columnIndex(input.personnelColumn);
  if (personnel === null)
    errors.personnelColumn = "ستون شماره پرسنلی باید حرف ستون Excel باشد.";
  const firstDay = columnIndex(input.firstDayColumn);
  const lastDay =
    firstDay === null ? null : firstDay + EXCEL_TEMPLATE_DAY_COLUMNS - 1;
  if (firstDay === null)
    errors.firstDayColumn = "ستون روز اول باید حرف ستون Excel باشد.";
  else if (lastDay! > EXCEL_MAX_COLUMN)
    errors.firstDayColumn = "۳۱ ستون روز از ستون آخر Excel بیرون می‌زند.";
  else if (personnel !== null && personnel >= firstDay && personnel <= lastDay!)
    errors.personnelColumn =
      "ستون شماره پرسنلی نباید داخل ۳۱ ستون روزانه باشد.";
  const rowValid = (row: number) =>
    Number.isInteger(row) && row >= 1 && row <= EXCEL_MAX_ROW;
  if (!rowValid(input.firstRow))
    errors.firstRow = "ردیف شروع باید عدد صحیح مثبت باشد.";
  if (!rowValid(input.lastRow))
    errors.lastRow = "ردیف پایان باید عدد صحیح مثبت باشد.";
  else if (rowValid(input.firstRow) && input.lastRow < input.firstRow)
    errors.lastRow = "ردیف پایان نباید پیش از ردیف شروع باشد.";
  else if (
    rowValid(input.firstRow) &&
    input.lastRow - input.firstRow + 1 > EXCEL_TEMPLATE_MAX_PERSONNEL_ROWS
  )
    errors.lastRow = "محدوده پرسنل حداکثر ۵۰۰ ردیف است.";
  if (Object.keys(errors).length > 0) return err(errors);
  return ok({
    sheetName,
    personnelColumn: columnLetters(personnel!),
    firstRow: input.firstRow,
    lastRow: input.lastRow,
    firstDayColumn: columnLetters(firstDay!),
    personnelColumnIndex: personnel!,
    firstDayColumnIndex: firstDay!,
    lastDayColumnIndex: lastDay!,
  });
}

/** `resolveTemplateMapping` that throws the first message as a ValidationError. */
export function requireTemplateMapping(
  input: ExcelTemplateMapping,
): ResolvedTemplateMapping {
  const result = resolveTemplateMapping(input);
  if (result.ok) return result.value;
  const [field, message] = Object.entries(result.error)[0]!;
  throw new ValidationError(message, field, "EXCEL_TEMPLATE_MAPPING");
}

/**
 * The value written into a day cell for each decision. The project's codes
 * are the hospital's Excel codes (D118, D120): explicit OFF and leave H are
 * written like shifts. An undecided day has no entry and stays blank.
 */
export const EXCEL_EXPORT_VALUES: Readonly<Record<AssignmentCode, string>> = {
  M: "M",
  E: "E",
  N: "N",
  ME: "ME",
  OFF: "OFF",
  H: "H",
};

/**
 * The 31 day values of one person: index 0 is day 1. A day the period does
 * not have (30 and 31 of a 29-day month) or an undecided day is null.
 */
export function exportDayValues(
  dayCount: number,
  decisions: ReadonlyMap<number, AssignmentCode>,
): (string | null)[] {
  if (
    !Number.isInteger(dayCount) ||
    dayCount < 1 ||
    dayCount > EXCEL_TEMPLATE_DAY_COLUMNS
  )
    throw new ValidationError(
      "طول دوره برنامه با ۳۱ ستون روزانه قالب سازگار نیست.",
      "period",
      "EXCEL_EXPORT_PERIOD",
    );
  return Array.from({ length: EXCEL_TEMPLATE_DAY_COLUMNS }, (_, i) => {
    const code = i < dayCount ? decisions.get(i + 1) : undefined;
    return code ? EXCEL_EXPORT_VALUES[code] : null;
  });
}
