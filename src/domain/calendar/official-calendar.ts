import { isIsoDate, type IsoDate } from "../shared/dates";
import { ValidationError } from "../shared/errors";
import type { DatePeriod } from "../shared/period";
import { err, ok, type Result } from "../shared/result";

/** Attribution is evidence, not a live account reference. Never resolved through users. */
export type CalendarActorSnapshot =
  | { readonly kind: "SYSTEM" }
  | {
      readonly kind: "USER";
      readonly userId: string;
      readonly displayName: string;
      readonly personnelNumber: string | null;
    };

/** An administrator's verification of an archived publication; never fetched at runtime. */
export interface CalendarSource {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly documentSha256: string;
  readonly retrievedOn: IsoDate;
  readonly verificationNote: string;
  readonly verified: boolean;
}

export type HolidayCompleteness = "UNKNOWN" | "PARTIAL" | "COMPLETE";
export type OfficialDayStatus = "UNKNOWN" | "NONE" | "OFFICIAL" | "PROVISIONAL";

export interface CalendarDay {
  readonly date: IsoDate;
  readonly isFriday: boolean;
  readonly officialStatus: OfficialDayStatus;
  readonly holidayNames: readonly string[];
}

export interface ImportedHoliday {
  readonly date: IsoDate;
  readonly names: readonly string[];
  readonly provisional: boolean;
}

export function validateCalendarImport(
  period: DatePeriod,
  completeness: Exclude<HolidayCompleteness, "UNKNOWN">,
  source: CalendarSource,
  holidays: readonly ImportedHoliday[],
): Result<void, ValidationError> {
  const seen = new Set<IsoDate>();
  for (const holiday of holidays) {
    if (
      !isIsoDate(holiday.date) ||
      holiday.date < period.start ||
      holiday.date > period.end
    )
      return err(
        new ValidationError(
          "Holiday must be inside this calendar year",
          "holidays",
        ),
      );
    if (seen.has(holiday.date))
      return err(
        new ValidationError(
          "Combine all names for the same holiday date",
          "holidays",
        ),
      );
    seen.add(holiday.date);
    if (
      !holiday.names.length ||
      holiday.names.some((n) => !n.trim()) ||
      new Set(holiday.names).size !== holiday.names.length
    )
      return err(
        new ValidationError(
          "Holiday names must be nonempty and unique",
          "holidays",
        ),
      );
    if (!source.verified && !holiday.provisional)
      return err(
        new ValidationError(
          "Official holidays require verified source evidence",
          "source",
        ),
      );
  }
  if (
    completeness === "COMPLETE" &&
    (!source.verified || holidays.some((h) => h.provisional))
  )
    return err(
      new ValidationError(
        "Complete holiday data must be verified and contain no provisional dates",
        "completeness",
      ),
    );
  return ok(undefined);
}

export function canConfirmCalendar(input: {
  completeness: HolidayCompleteness;
  source: CalendarSource | null;
  days: readonly CalendarDay[];
}): Result<void, ValidationError> {
  if (
    input.completeness !== "COMPLETE" ||
    !input.source?.verified ||
    input.days.some(
      (d) =>
        d.officialStatus === "UNKNOWN" || d.officialStatus === "PROVISIONAL",
    )
  )
    return err(
      new ValidationError(
        "Only complete, verified official calendars may be confirmed",
        "versionId",
        "CALENDAR_INCOMPLETE",
      ),
    );
  return ok(undefined);
}
