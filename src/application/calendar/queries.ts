import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import { unwrap } from "../../domain/shared/result";
import { calendarYearPeriod } from "../../infrastructure/calendar/base";
import {
  findCalendarVersion,
  findCalendarYear,
  listCalendarAudit,
  listCalendarVersions,
  loadCalendarDays,
} from "../../infrastructure/repositories/official-calendar";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";

/** Admin reference-data read. A missing year is explicit; initialize through the authorized command. */
export async function getOfficialCalendarYear(ctx: AppContext, year: number) {
  unwrap(authorize(ctx.actor, "officialCalendar.manage", {}));
  calendarYearPeriod(year);
  return ctx.db.transaction(
    async (tx) => {
      const calendar = await findCalendarYear(tx, year);
      if (!calendar) return null;
      const versions = await listCalendarVersions(tx, year);
      return {
        ...calendar,
        versions,
        audit: await listCalendarAudit(
          tx,
          versions.map((v) => v.id),
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** Historical content is always addressed by an explicit version ID. Never silently follows active. */
export async function getOfficialCalendarVersion(
  ctx: AppContext,
  versionId: string,
) {
  unwrap(authorize(ctx.actor, "officialCalendar.manage", {}));
  const id = z.uuid().parse(versionId);
  return ctx.db.transaction(
    async (tx) => {
      const version = await findCalendarVersion(tx, id);
      if (!version) throw new NotFoundError("Calendar version");
      return {
        ...version,
        days: await loadCalendarDays(tx, id),
        audit: await listCalendarAudit(tx, [id]),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
