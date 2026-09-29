import { z } from "zod";

import type { Actor } from "../../domain/authz/actor";
import { isoDate, type IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import { loadActor } from "../repositories/memberships";

/**
 * Timezone that decides "today" for effective-dated memberships. Every
 * department currently uses it (`departments.timezone` defaults to it).
 */
export const APP_TIMEZONE = "Asia/Tehran";

/** The calendar day of `now` in `timeZone`, as an ISO date. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return isoDate(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
  );
}

/** Only the user id is read from the session; everything else in it is ignored. */
const sessionShape = z.object({ user: z.object({ id: z.uuid() }) });

/** The user id a session identifies, or null for no or a malformed session. */
export function sessionUserId(session: unknown): string | null {
  const parsed = sessionShape.safeParse(session);
  return parsed.success ? parsed.data.user.id : null;
}

/**
 * The trusted authorization boundary. The session only says who the user is;
 * whether they are active, their department memberships (effective on
 * `onDate`, D19), Head Nurse roles and supervisor assignments are all loaded
 * from PostgreSQL. Returns null (no access) when there is no session, the
 * user no longer exists, or the user is deactivated, even if the session
 * cookie itself is still valid.
 */
export async function actorFromSession(
  db: DbExecutor,
  session: unknown,
  onDate: IsoDate,
): Promise<Actor | null> {
  const userId = sessionUserId(session);
  if (!userId) return null;
  const actor = await loadActor(db, userId, onDate);
  return actor?.isActive ? actor : null;
}
