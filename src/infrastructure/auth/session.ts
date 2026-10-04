import "server-only";

import { cache } from "react";

import type { Actor } from "../../domain/authz/actor";
import { getDb } from "../db/client";
import type { Database } from "../db/database";
import {
  APP_TIMEZONE,
  resolveSession,
  todayIn,
  type SessionState,
} from "./actor";
import { auth } from "./index";

/** This request's session, resolved against the database once (see `resolveSession`). */
export const getSessionState = cache(async (): Promise<SessionState> =>
  resolveSession(getDb(), await auth(), todayIn(APP_TIMEZONE)),
);

/**
 * The authenticated actor for this request, or null when there is none, the
 * user lost access, the session predates a password change, or a temporary
 * password must be replaced first. Cached per request.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const state = await getSessionState();
  return state.status === "active" ? state.actor : null;
});

/** What application use cases and queries need (`AppContext`), or null without a trusted actor. */
export async function getRequestContext(): Promise<{
  db: Database;
  actor: Actor;
} | null> {
  const actor = await getActor();
  return actor ? { db: getDb(), actor } : null;
}

/**
 * The context for the password-change page and action only: also available
 * while a temporary password must be replaced. `forced` says which case.
 */
export async function getPasswordChangeContext(): Promise<{
  db: Database;
  actor: Actor;
  forced: boolean;
} | null> {
  const state = await getSessionState();
  if (state.status === "none") return null;
  return {
    db: getDb(),
    actor: state.actor,
    forced: state.status === "passwordChangeRequired",
  };
}
