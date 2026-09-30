import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import {
  departments,
  notifications,
  schedules,
  type NotificationType,
} from "../db/schema";

export interface NewNotification {
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly scheduleId?: string | null;
  readonly data?: Record<string, unknown>;
}

export interface NotificationRecord {
  readonly id: string;
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly scheduleId: string | null;
  readonly data: Record<string, unknown>;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

/** Writes in-app notifications; call inside the business transaction so they roll back with it. */
export async function insertNotifications(
  db: DbExecutor,
  rows: readonly NewNotification[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(notifications)
    .values(rows.map((r) => ({ ...r, data: r.data ?? {} })))
    .returning({ id: notifications.id });
  return inserted.length;
}

export async function listNotificationsForRecipient(
  db: DbExecutor,
  recipientId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationRecord[]> {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit ?? 50);
}

/**
 * A position in the newest-first order: the exact `created_at` (microseconds,
 * UTC, as PostgreSQL formats it; a JS Date would lose the microseconds and
 * skip rows created in the same millisecond) and the id as the tie-breaker.
 */
export interface NotificationKey {
  readonly createdAt: string;
  readonly id: string;
}

/** A notification with the schedule/department it refers to, for display. */
export interface NotificationListRow extends NotificationRecord {
  readonly key: NotificationKey;
  readonly schedule: {
    readonly label: string;
    readonly departmentName: string;
  } | null;
}

const exactCreatedAt = sql<string>`to_char(${notifications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * One page of the recipient's notifications, newest first (`created_at DESC,
 * id DESC`), strictly after `after` (keyset pagination: stable while new
 * notifications arrive or others are marked read). Always scoped to
 * `recipientId`; nothing else can be listed.
 */
export async function listNotificationPage(
  db: DbExecutor,
  recipientId: string,
  options: { unreadOnly: boolean; limit: number; after?: NotificationKey },
): Promise<NotificationListRow[]> {
  const { after } = options;
  const rows = await db
    .select({
      id: notifications.id,
      recipientId: notifications.recipientId,
      type: notifications.type,
      scheduleId: notifications.scheduleId,
      data: notifications.data,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      exactCreatedAt,
      scheduleLabel: schedules.label,
      departmentName: departments.name,
    })
    .from(notifications)
    .leftJoin(schedules, eq(schedules.id, notifications.scheduleId))
    .leftJoin(departments, eq(departments.id, schedules.departmentId))
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
        after
          ? sql`(${notifications.createdAt}, ${notifications.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit);
  return rows.map(
    ({ exactCreatedAt: exact, scheduleLabel, departmentName, ...row }) => ({
      ...row,
      key: { createdAt: exact, id: row.id },
      schedule:
        scheduleLabel !== null && departmentName !== null
          ? { label: scheduleLabel, departmentName }
          : null,
    }),
  );
}

/** One of the recipient's own notifications; another user's reads as missing. */
export async function findNotificationForRecipient(
  db: DbExecutor,
  input: { id: string; recipientId: string },
): Promise<NotificationRecord | null> {
  const [row] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, input.id),
        eq(notifications.recipientId, input.recipientId),
      ),
    );
  return row ?? null;
}

export async function countUnreadNotifications(
  db: DbExecutor,
  recipientId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        isNull(notifications.readAt),
      ),
    );
  return row?.value ?? 0;
}

/** Marks one of the recipient's own notifications as read. */
export async function markNotificationRead(
  db: DbExecutor,
  input: { id: string; recipientId: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: input.now })
    .where(
      and(
        eq(notifications.id, input.id),
        eq(notifications.recipientId, input.recipientId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length > 0;
}

/** Marks every unread notification of the recipient as read; returns how many changed. */
export async function markAllNotificationsRead(
  db: DbExecutor,
  input: { recipientId: string; now: Date },
): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: input.now })
    .where(
      and(
        eq(notifications.recipientId, input.recipientId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
