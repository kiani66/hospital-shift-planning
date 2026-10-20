import { z } from "zod";
import {
  canConfirmCalendar,
  validateCalendarImport,
  type CalendarActorSnapshot,
} from "../../domain/calendar/official-calendar";
import { eachDay, isIsoDate, parseIsoDate } from "../../domain/shared/dates";
import { InvalidStateError, ValidationError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import {
  calendarHorizon,
  calendarYearPeriod,
  generateCalendarDays,
} from "../../infrastructure/calendar/base";
import {
  MAX_JALALI_YEAR,
  MIN_JALALI_YEAR,
} from "../../infrastructure/calendar/jalali";
import {
  appendCalendarVersion,
  confirmCalendarVersion,
  ensureBaseCalendarYear,
  findCalendarVersion,
  listCalendarVersions,
  loadCalendarDays,
  lockCalendarYear,
} from "../../infrastructure/repositories/official-calendar";
import { findUserById } from "../../infrastructure/repositories/users";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type UnitOfWork } from "../use-case";
import { authorizeAdministration } from "../management/context";

const yearInput = z.number().int().min(MIN_JALALI_YEAR).max(MAX_JALALI_YEAR);
const expectedActive = z.uuid().nullable();
const isoInput = z
  .string()
  .refine(isIsoDate, "Expected an ISO calendar day")
  .transform((v) => unwrap(parseIsoDate(v)));

async function actorSnapshot(uow: UnitOfWork): Promise<CalendarActorSnapshot> {
  const user = await findUserById(uow.tx, uow.actor.userId);
  if (!user) throw new NotFoundError("Calendar actor");
  return {
    kind: "USER",
    userId: user.id,
    displayName: user.displayName,
    personnelNumber: user.personnelNumber,
  };
}

/** Initializes the runtime horizon, or one missing year. No existing record is changed. */
export const initializeOfficialCalendar = defineCommand({
  name: "officialCalendar.initialize",
  input: z.object({ year: yearInput.optional() }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "officialCalendar.manage");
    const actor = await actorSnapshot(uow);
    const years =
      input.year === undefined
        ? calendarHorizon(todayIn(APP_TIMEZONE, uow.now))
        : [input.year];
    for (const year of years)
      await ensureBaseCalendarYear(uow.tx, year, actor, uow.now);
    return { years };
  },
});

export const calendarImportInput = z.object({
  year: yearInput,
  expectedActiveVersionId: expectedActive,
  completeness: z.enum(["PARTIAL", "COMPLETE"]),
  reason: z.string().trim().min(1).max(2000),
  source: z.object({
    publisher: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(500),
    url: z
      .url({ protocol: /^https$/, error: "Source must be a valid HTTPS URL" })
      .max(2000),
    documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    retrievedOn: isoInput,
    verificationNote: z.string().trim().min(1).max(2000),
    verified: z.boolean(),
  }),
  holidays: z
    .array(
      z.object({
        date: isoInput,
        names: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
        provisional: z.boolean(),
      }),
    )
    .max(366),
});

/** Imports a complete new snapshot, including corrections. Never edits any existing version. */
export const importOfficialCalendar = defineCommand({
  name: "officialCalendar.import",
  input: calendarImportInput,
  async handler(uow, input) {
    await authorizeAdministration(uow, "officialCalendar.manage");
    const actor = await actorSnapshot(uow);
    const period = calendarYearPeriod(input.year);
    unwrap(
      validateCalendarImport(
        period,
        input.completeness,
        input.source,
        input.holidays,
      ),
    );
    const calendar = await ensureBaseCalendarYear(
      uow.tx,
      input.year,
      actor,
      uow.now,
    );
    if (calendar.activeVersionId !== input.expectedActiveVersionId)
      throw new ConflictError(
        "Active calendar changed; reload before importing",
        "CALENDAR_ACTIVE_CHANGED",
      );
    const lineage = await listCalendarVersions(uow.tx, input.year);
    const byDate = new Map(input.holidays.map((h) => [h.date, h]));
    const days = generateCalendarDays(input.year).map((day) => {
      const holiday = byDate.get(day.date);
      return {
        ...day,
        officialStatus: holiday
          ? holiday.provisional
            ? ("PROVISIONAL" as const)
            : ("OFFICIAL" as const)
          : input.completeness === "COMPLETE"
            ? ("NONE" as const)
            : ("UNKNOWN" as const),
        holidayNames: holiday?.names ?? [],
      };
    });
    const version = await appendCalendarVersion(
      uow.tx,
      {
        year: input.year,
        versionNo: lineage[0]!.versionNo + 1,
        basedOnVersionId: calendar.activeVersionId,
        origin: "IMPORT",
        completeness: input.completeness,
        source: input.source,
        reason: input.reason,
        createdBy: actor,
        createdAt: uow.now,
      },
      days,
    );
    return { versionId: version.id, versionNo: version.versionNo };
  },
});

export const confirmOfficialCalendar = defineCommand({
  name: "officialCalendar.confirm",
  input: z.object({
    versionId: z.uuid(),
    expectedActiveVersionId: expectedActive,
  }),
  async handler(uow, input) {
    await authorizeAdministration(uow, "officialCalendar.manage");
    const found = await findCalendarVersion(uow.tx, input.versionId);
    if (!found) throw new NotFoundError("Calendar version");
    const calendar = await lockCalendarYear(uow.tx, found.year);
    const version = (await findCalendarVersion(uow.tx, input.versionId))!;
    if (version.confirmedAt)
      throw new InvalidStateError("CONFIRMED", "CONFIRM", "calendar version");
    if (
      calendar.activeVersionId !== input.expectedActiveVersionId ||
      version.basedOnVersionId !== calendar.activeVersionId
    )
      throw new ConflictError(
        "Active calendar changed; create a replacement from the current active version",
        "CALENDAR_ACTIVE_CHANGED",
      );
    const days = await loadCalendarDays(uow.tx, version.id);
    const expectedDates = eachDay(
      calendarYearPeriod(found.year).start,
      calendarYearPeriod(found.year).end,
    );
    if (
      days.length !== expectedDates.length ||
      days.some((day, i) => day.date !== expectedDates[i])
    )
      throw new ValidationError(
        "Calendar version must contain every date of its year",
        "versionId",
        "CALENDAR_INCOMPLETE",
      );
    unwrap(canConfirmCalendar({ ...version, days }));
    await confirmCalendarVersion(
      uow.tx,
      version.id,
      await actorSnapshot(uow),
      uow.now,
    );
    return { versionId: version.id, year: version.year };
  },
});
