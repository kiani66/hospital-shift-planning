import "server-only";

import { cache } from "react";

import type { Actor } from "../../domain/authz/actor";
import { getDb } from "../db/client";
import type { Database } from "../db/database";
import { actorFromSession, APP_TIMEZONE, todayIn } from "./actor";
import { auth } from "./index";

/**
 * The authenticated actor for this request, built from the database (see
 * `actorFromSession`), or null when there is none or the user lost access.
 * Cached per request.
 */
export const getActor = cache(async (): Promise<Actor | null> =>
  actorFromSession(getDb(), await auth(), todayIn(APP_TIMEZONE)),
);

/** What application use cases and queries need (`AppContext`), or null without a trusted actor. */
export async function getRequestContext(): Promise<{
  db: Database;
  actor: Actor;
} | null> {
  const actor = await getActor();
  return actor ? { db: getDb(), actor } : null;
}
