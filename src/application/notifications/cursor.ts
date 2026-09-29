import { z } from "zod";

import type { NotificationKey } from "../../infrastructure/repositories/notifications";

/**
 * Opaque keyset cursor for the notification list: the last row's exact
 * `created_at` and id, base64url-encoded. It is only a position; ownership is
 * always enforced by the query, so a forged cursor can reveal nothing.
 */

const keyShape = z.object({
  createdAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    .refine((value) => !Number.isNaN(Date.parse(value))),
  id: z.uuid(),
});

export function encodeNotificationCursor(key: NotificationKey): string {
  return Buffer.from(`${key.createdAt}|${key.id}`, "utf8").toString(
    "base64url",
  );
}

/** The position a cursor encodes, or null when it is malformed. */
export function decodeNotificationCursor(
  cursor: string,
): NotificationKey | null {
  if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url")
    .toString("utf8")
    .split("|");
  if (rest.length > 0) return null;
  const parsed = keyShape.safeParse({ createdAt, id });
  return parsed.success ? parsed.data : null;
}
