import { z } from "zod";

import type { Actor } from "../../domain/authz/actor";
import { isoDate, type IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import { loadActor } from "../repositories/memberships";
import { findSessionUserState } from "../repositories/users";

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

/**
 * Only the user id and the session version are read from the session;
 * everything else in it is ignored. Sessions issued before session versions
 * existed carry none and count as version 0 (the column default).
 */
const sessionShape = z.object({
  user: z.object({
    id: z.uuid(),
    sv: z.number().int().nonnegative().optional(),
  }),
});

/** The user id a session identifies, or null for no or a malformed session. */
export function sessionUserId(session: unknown): string | null {
  return sessionIdentity(session)?.userId ?? null;
}

export function sessionIdentity(
  session: unknown,
): { userId: string; sessionVersion: number } | null {
  const parsed = sessionShape.safeParse(session);
  return parsed.success
    ? { userId: parsed.data.user.id, sessionVersion: parsed.data.user.sv ?? 0 }
    : null;
}

/**
 * What a request's session amounts to, decided from the database:
 * - `none`: no session, unknown or deactivated user, or a session issued
 *   before the last password change/reset (session version mismatch);
 * - `passwordChangeRequired`: a valid session of a user holding a temporary
 *   password. They may only change it; no other page, action or use case
 *   receives an actor;
 * - `active`: the trusted actor.
 */
export type SessionState =
  | { readonly status: "none" }
  | { readonly status: "passwordChangeRequired"; readonly actor: Actor }
  | { readonly status: "active"; readonly actor: Actor };

export async function resolveSession(
  db: DbExecutor,
  session: unknown,
  onDate: IsoDate,
): Promise<SessionState> {
  const identity = sessionIdentity(session);
  if (!identity) return { status: "none" };
  const state = await findSessionUserState(db, identity.userId);
  if (!state?.isActive || state.sessionVersion !== identity.sessionVersion)
    return { status: "none" };
  const actor = await loadActor(db, identity.userId, onDate);
  if (!actor?.isActive) return { status: "none" };
  return state.mustChangePassword
    ? { status: "passwordChangeRequired", actor }
    : { status: "active", actor };
}

/**
 * The trusted authorization boundary. The session only says who the user is
 * (and which password generation it was issued for); whether they are
 * active, their department memberships (effective on `onDate`, D19), Head
 * Nurse roles and supervisor assignments are all loaded from PostgreSQL.
 * Returns null (no access) when there is no session, the user no longer
 * exists, is deactivated, changed or had their password reset since the
 * session was issued, or must still replace a temporary password.
 */
export async function actorFromSession(
  db: DbExecutor,
  session: unknown,
  onDate: IsoDate,
): Promise<Actor | null> {
  const state = await resolveSession(db, session, onDate);
  return state.status === "active" ? state.actor : null;
}
