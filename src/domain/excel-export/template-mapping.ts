import { holidayKindOf } from "../calendar/holiday-kind";
import type { IsoDate } from "../shared/dates";
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
  /**
   * Optional row whose 31 day cells get the period's day numbers (1 … the
   * month's length), so a 31-day month prints its 31st heading and a shorter
   * month none past its end.
   */
  readonly dayHeaderRow?: number | null;
  /** Optional per-person statistic columns (e.g. the printed totals I, J, K). */
  readonly statisticColumns?: readonly StatisticColumn[];
  /** Optional daily summary rows written in the 31 day columns. */
  readonly summaryRows?: readonly SummaryRow[];
  /**
   * Optional row whose 31 day cells get each day's Persian weekday; blank
   * past the period's end.
   */
  readonly weekdayRow?: number | null;
  /** How the weekday is written (default LONG). */
  readonly weekdayFormat?: WeekdayFormat;
  /** Optional cell that gets the schedule's Jalali month and year, e.g. `U3`. */
  readonly monthHeadingCell?: string | null;
  /**
   * Holiday highlighting, set together or not at all: a cell whose fill is
   * the template's holiday (Friday) fill, e.g. `P7`, and a day column whose
   * cells show each written row's normal-day fill, e.g. `O`. Only the fill
   * of the written day cells changes; borders, fonts and the rest stay.
   */
  readonly holidayFillCell?: string | null;
  readonly normalFillColumn?: string | null;
}

/**
 * LONG: the full name («چهارشنبه»); NARROW: the one-letter form calendars
 * print in narrow day columns («چ»).
 */
export const WEEKDAY_FORMATS = ["LONG", "NARROW"] as const;
export type WeekdayFormat = (typeof WEEKDAY_FORMATS)[number];

/**
 * What a per-person statistic column holds (D124). Only figures the system
 * derives from its own decisions are offered; contractual or required hours
 * and leave balances are not known to it and can only be cleared.
 *
 * - SHIFT_COUNT: working shifts in the period (M, E, N, ME each count once).
 * - LEAVE_DAYS: leave days (H) in the period.
 * - CLEAR: a printed figure the system cannot calculate; emptied so last
 *   month's value is never exported as current.
 */
export const PERSON_STATISTICS = [
  "SHIFT_COUNT",
  "LEAVE_DAYS",
  "CLEAR",
] as const;
export type PersonStatistic = (typeof PERSON_STATISTICS)[number];

/**
 * What a daily summary row holds: nursing coverage of one period (M, E or
 * N, counted as the app counts staffing: ME toward M and E, secretaries
 * excluded, D42, D119), CLEAR, or MANUAL.
 *
 * MANUAL is a row the hospital maintains by hand (D124): the export keeps
 * the values of the period's days exactly as they are, clears the days the
 * period does not have, and only restyles the cells (Friday highlighting).
 */
export const DAILY_STATISTICS = [
  "COVERAGE_M",
  "COVERAGE_E",
  "COVERAGE_N",
  "CLEAR",
  "MANUAL",
] as const;
export type DailyStatistic = (typeof DAILY_STATISTICS)[number];

export interface StatisticColumn {
  /** Column letters, e.g. `K`. */
  readonly column: string;
  readonly statistic: PersonStatistic;
}

export interface SummaryRow {
  readonly row: number;
  readonly statistic: DailyStatistic;
}

/** Upper bounds that keep a mapping reviewable. */
export const EXCEL_TEMPLATE_MAX_STATISTIC_COLUMNS = 8;
export const EXCEL_TEMPLATE_MAX_SUMMARY_ROWS = 8;

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

/** `u3` → column 21, row 3; null for anything that is not one Excel cell. */
export function parseCellAddress(
  text: string,
): { column: number; row: number } | null {
  const m = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(text.trim().toUpperCase());
  const column = m ? columnIndex(m[1]!) : null;
  const row = m ? Number(m[2]) : 0;
  return column !== null && row <= EXCEL_MAX_ROW ? { column, row } : null;
}

/** A single mapped cell, with its coordinates. */
export interface MappedCell {
  /** Normalized address, e.g. `U3`. */
  readonly cell: string;
  readonly column: number;
  readonly row: number;
}

/** Where the holiday and normal-day fills of written day cells come from. */
export interface HolidayFillSource {
  readonly holidayCell: MappedCell;
  readonly normalColumn: string;
  readonly normalColumnIndex: number;
}

/** A mapping whose coordinates are known to be inside the grid and consistent. */
export interface ResolvedTemplateMapping extends ExcelTemplateMapping {
  readonly personnelColumnIndex: number;
  readonly firstDayColumnIndex: number;
  readonly lastDayColumnIndex: number;
  readonly dayHeaderRow: number | null;
  readonly statisticColumns: readonly ResolvedStatisticColumn[];
  readonly summaryRows: readonly SummaryRow[];
  readonly weekdayRow: number | null;
  readonly weekdayFormat: WeekdayFormat;
  readonly monthHeading: MappedCell | null;
  readonly holidayFill: HolidayFillSource | null;
}

export interface ResolvedStatisticColumn extends StatisticColumn {
  readonly columnIndex: number;
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
  const inPersonnelRows = (row: number) =>
    row >= input.firstRow && row <= input.lastRow;

  const dayHeaderRow = input.dayHeaderRow ?? null;
  if (dayHeaderRow !== null) {
    if (!rowValid(dayHeaderRow))
      errors.dayHeaderRow = "ردیف عنوان روزها باید عدد صحیح مثبت باشد.";
    else if (inPersonnelRows(dayHeaderRow))
      errors.dayHeaderRow = "ردیف عنوان روزها نباید داخل ردیف‌های پرسنل باشد.";
  }

  const statisticColumns: ResolvedStatisticColumn[] = [];
  const statistics = input.statisticColumns ?? [];
  if (statistics.length > EXCEL_TEMPLATE_MAX_STATISTIC_COLUMNS)
    errors.statisticColumns = "حداکثر ۸ ستون آمار پرسنل مجاز است.";
  for (const entry of statistics) {
    if (errors.statisticColumns) break;
    const index = columnIndex(entry.column);
    if (index === null || !PERSON_STATISTICS.includes(entry.statistic))
      errors.statisticColumns = "ستون آمار باید حرف ستون Excel باشد.";
    else if (index === personnel)
      errors.statisticColumns = "ستون آمار نباید همان ستون شماره پرسنلی باشد.";
    else if (firstDay !== null && index >= firstDay && index <= lastDay!)
      errors.statisticColumns = "ستون آمار نباید داخل ۳۱ ستون روزانه باشد.";
    else if (statisticColumns.some((c) => c.columnIndex === index))
      errors.statisticColumns = `ستون آمار ${columnLetters(index)} تکرار شده است.`;
    else
      statisticColumns.push({
        column: columnLetters(index),
        statistic: entry.statistic,
        columnIndex: index,
      });
  }

  const summaryRows: SummaryRow[] = [];
  const summaries = input.summaryRows ?? [];
  if (summaries.length > EXCEL_TEMPLATE_MAX_SUMMARY_ROWS)
    errors.summaryRows = "حداکثر ۸ ردیف خلاصه روزانه مجاز است.";
  for (const entry of summaries) {
    if (errors.summaryRows) break;
    if (!rowValid(entry.row) || !DAILY_STATISTICS.includes(entry.statistic))
      errors.summaryRows = "ردیف خلاصه روزانه باید عدد صحیح مثبت باشد.";
    else if (entry.row === dayHeaderRow)
      errors.summaryRows =
        "ردیف خلاصه روزانه نباید همان ردیف عنوان روزها باشد.";
    else if (summaryRows.some((r) => r.row === entry.row))
      errors.summaryRows = `ردیف خلاصه ${entry.row} تکرار شده است.`;
    else if (entry.row === input.weekdayRow)
      errors.summaryRows =
        "ردیف خلاصه روزانه نباید همان ردیف روزهای هفته باشد.";
    else summaryRows.push({ row: entry.row, statistic: entry.statistic });
  }

  const weekdayRow = input.weekdayRow ?? null;
  if (weekdayRow !== null) {
    if (!rowValid(weekdayRow))
      errors.weekdayRow = "ردیف روزهای هفته باید عدد صحیح مثبت باشد.";
    else if (inPersonnelRows(weekdayRow))
      errors.weekdayRow = "ردیف روزهای هفته نباید داخل ردیف‌های پرسنل باشد.";
    else if (weekdayRow === dayHeaderRow)
      errors.weekdayRow = "ردیف روزهای هفته نباید همان ردیف شماره روزها باشد.";
  }
  const weekdayFormat = input.weekdayFormat ?? "LONG";
  if (!WEEKDAY_FORMATS.includes(weekdayFormat))
    errors.weekdayFormat = "شکل نوشتن روز هفته معتبر نیست.";

  const inDayColumns = (column: number) =>
    firstDay !== null && column >= firstDay && column <= lastDay!;
  let monthHeading: MappedCell | null = null;
  if (input.monthHeadingCell) {
    const at = parseCellAddress(input.monthHeadingCell);
    if (!at)
      errors.monthHeadingCell =
        "خانه عنوان ماه باید نشانی یک خانه Excel باشد (مثلاً U3).";
    else if (inPersonnelRows(at.row))
      errors.monthHeadingCell =
        "خانه عنوان ماه نباید داخل ردیف‌های پرسنل باشد.";
    else if (
      inDayColumns(at.column) &&
      [dayHeaderRow, weekdayRow, ...summaryRows.map((r) => r.row)].includes(
        at.row,
      )
    )
      errors.monthHeadingCell =
        "خانه عنوان ماه نباید روی ردیف شماره روزها، روزهای هفته یا خلاصه روزانه باشد.";
    else
      monthHeading = {
        cell: cellAddress(at.column, at.row),
        column: at.column,
        row: at.row,
      };
  }

  let holidayFill: HolidayFillSource | null = null;
  const holidayText = input.holidayFillCell?.trim() || null;
  const normalText = input.normalFillColumn?.trim() || null;
  if (holidayText || normalText) {
    const holiday = holidayText ? parseCellAddress(holidayText) : null;
    const normal = normalText ? columnIndex(normalText) : null;
    if (!holiday)
      errors.holidayFillCell =
        "خانه رنگ تعطیل باید نشانی یک خانه Excel باشد (مثلاً P7).";
    if (normal === null)
      errors.normalFillColumn = "ستون رنگ روز عادی باید حرف ستون Excel باشد.";
    else if (!inDayColumns(normal))
      errors.normalFillColumn =
        "ستون رنگ روز عادی باید یکی از ۳۱ ستون روزانه باشد.";
    if (holiday && normal !== null && inDayColumns(normal))
      holidayFill = {
        holidayCell: {
          cell: cellAddress(holiday.column, holiday.row),
          column: holiday.column,
          row: holiday.row,
        },
        normalColumn: columnLetters(normal),
        normalColumnIndex: normal,
      };
  }

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
    dayHeaderRow,
    statisticColumns,
    summaryRows,
    weekdayRow,
    weekdayFormat,
    // The normalized inputs too, so resolving a resolved mapping is a no-op.
    monthHeadingCell: monthHeading?.cell ?? null,
    holidayFillCell: holidayFill?.holidayCell.cell ?? null,
    normalFillColumn: holidayFill?.normalColumn ?? null,
    monthHeading,
    holidayFill,
  });
}

/** The mapping as stored with the template: coordinates without derived indexes. */
export function storedTemplateMapping(
  mapping: ResolvedTemplateMapping,
): Required<ExcelTemplateMapping> {
  return {
    sheetName: mapping.sheetName,
    personnelColumn: mapping.personnelColumn,
    firstRow: mapping.firstRow,
    lastRow: mapping.lastRow,
    firstDayColumn: mapping.firstDayColumn,
    dayHeaderRow: mapping.dayHeaderRow,
    statisticColumns: mapping.statisticColumns.map(({ column, statistic }) => ({
      column,
      statistic,
    })),
    summaryRows: mapping.summaryRows.map(({ row, statistic }) => ({
      row,
      statistic,
    })),
    weekdayRow: mapping.weekdayRow,
    weekdayFormat: mapping.weekdayFormat,
    monthHeadingCell: mapping.monthHeading?.cell ?? null,
    holidayFillCell: mapping.holidayFill?.holidayCell.cell ?? null,
    normalFillColumn: mapping.holidayFill?.normalColumn ?? null,
  };
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
 * The value written into a day cell for each decision (D124). The working
 * codes are the hospital's Excel codes (D118); leave is `H`. Rest (OFF) is a
 * blank cell, as the hospital's printed schedules show it. Null is a blank.
 */
export const EXCEL_EXPORT_VALUES: Readonly<
  Record<AssignmentCode, string | null>
> = {
  M: "M",
  E: "E",
  N: "N",
  ME: "ME",
  OFF: null,
  H: "H",
};

/**
 * An undecided day, and any statistic that depends on one. Written instead
 * of a blank, because a blank cell is rest: an undecided day is never
 * printed as OFF (D100).
 */
export const EXCEL_UNDECIDED_VALUE = "?";

/** A cell value to write: text, a number, or null for a blank cell. */
export type ExportCellValue = string | number | null;

/**
 * "Leave this cell's value as it is" (a MANUAL summary row's valid days).
 * Only its style may change.
 */
export const KEEP_CELL: unique symbol = Symbol("KEEP_CELL");

/** A summary-row cell: a value to write, or `KEEP_CELL`. */
export type SummaryCellValue = ExportCellValue | typeof KEEP_CELL;

function requireDayCount(dayCount: number): void {
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
}

/**
 * The 31 day values of one person: index 0 is day 1. An undecided day of the
 * period is `?`; a day the period does not have (30 and 31 of a 29-day
 * month) is blank.
 */
export function exportDayValues(
  dayCount: number,
  decisions: ReadonlyMap<number, AssignmentCode>,
): ExportCellValue[] {
  requireDayCount(dayCount);
  return Array.from({ length: EXCEL_TEMPLATE_DAY_COLUMNS }, (_, i) => {
    if (i >= dayCount) return null;
    const code = decisions.get(i + 1);
    return code ? EXCEL_EXPORT_VALUES[code] : EXCEL_UNDECIDED_VALUE;
  });
}

/**
 * The 31 values of a calendar row (day numbers, weekdays): `valueOf` for
 * each day of the period (index 0 is its first day), blank past its end, so
 * a shorter month never keeps a heading of the template's longer one.
 */
export function exportPeriodRow(
  dayCount: number,
  valueOf: (dayIndex: number) => ExportCellValue,
): ExportCellValue[] {
  requireDayCount(dayCount);
  return Array.from({ length: EXCEL_TEMPLATE_DAY_COLUMNS }, (_, i) =>
    i < dayCount ? valueOf(i) : null,
  );
}

/**
 * Which of the 31 day columns are printed as holidays: the days of the
 * period (`dates`, in order) that `holidayKindOf` classifies (Fridays and,
 * once connected, official holidays). Days past the period are never
 * highlighted, so a column highlighted in another month is restored.
 */
export function exportHolidayColumns(
  dates: readonly IsoDate[],
  officialHolidays: ReadonlySet<IsoDate> = new Set(),
): boolean[] {
  requireDayCount(dates.length);
  return Array.from(
    { length: EXCEL_TEMPLATE_DAY_COLUMNS },
    (_, i) =>
      i < dates.length && holidayKindOf(dates[i]!, officialHolidays) !== null,
  );
}
