import { authorize } from "../../domain/authz/policies";
import { unwrap } from "../../domain/shared/result";
import type { NotificationType } from "../../infrastructure/db/schema";
import {
  countUnreadNotifications,
  listNotificationPage,
} from "../../infrastructure/repositories/notifications";
import type { AppContext } from "../use-case";
import { decodeNotificationCursor, encodeNotificationCursor } from "./cursor";

export type { NotificationType };

/** Newest-first page size: bounded, never the whole history. */
export const NOTIFICATION_PAGE_SIZE = 25;

export type NotificationFilter = "all" | "unread";

export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly createdAt: Date;
  readonly read: boolean;
  /** The schedule it refers to, if any (as its creator wrote it). */
  readonly scheduleId: string | null;
  /** Current schedule label and department name, when the schedule exists. */
  readonly context: {
    readonly scheduleLabel: string;
    readonly departmentName: string;
  } | null;
  /** Structured payload written with the notification; rendered by the UI. */
  readonly data: Readonly<Record<string, unknown>>;
}

export interface NotificationPage {
  readonly items: readonly NotificationItem[];
  /** Cursor for the next (older) page, or null on the last page. */
  readonly nextCursor: string | null;
  /** The requested cursor was malformed and the first page is shown instead. */
  readonly invalidCursor: boolean;
}

/** Ownership is the whole policy; this also denies a deactivated actor. */
function authorizeOwn(ctx: AppContext): string {
  unwrap(
    authorize(ctx.actor, "notification.access", {
      recipientId: ctx.actor.userId,
    }),
  );
  return ctx.actor.userId;
}

/**
 * One page of the actor's own notifications, newest first, with keyset
 * pagination (`created_at DESC, id DESC`). The recipient is always the
 * trusted actor; no user id is ever taken from the caller.
 */
export async function listNotifications(
  ctx: AppContext,
  input: {
    filter: NotificationFilter;
    cursor?: string;
    limit?: number;
  },
): Promise<NotificationPage> {
  const recipientId = authorizeOwn(ctx);
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? NOTIFICATION_PAGE_SIZE), 1),
    100,
  );
  const after = input.cursor
    ? decodeNotificationCursor(input.cursor)
    : undefined;

  // One extra row tells whether an older page exists.
  const rows = await listNotificationPage(ctx.db, recipientId, {
    unreadOnly: input.filter === "unread",
    limit: limit + 1,
    after: after ?? undefined,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      read: row.readAt !== null,
      scheduleId: row.scheduleId,
      context: row.schedule && {
        scheduleLabel: row.schedule.label,
        departmentName: row.schedule.departmentName,
      },
      data: row.data,
    })),
    nextCursor:
      rows.length > limit && last ? encodeNotificationCursor(last.key) : null,
    invalidCursor: after === null,
  };
}

/** The shell badge: a single COUNT over the actor's unread notifications. */
export async function getUnreadNotificationCount(
  ctx: AppContext,
): Promise<number> {
  return countUnreadNotifications(ctx.db, authorizeOwn(ctx));
}
