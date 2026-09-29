import { and, count, desc, eq, isNull } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { notifications, type NotificationType } from "../db/schema";

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
    .orderBy(desc(notifications.createdAt))
    .limit(options.limit ?? 50);
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
