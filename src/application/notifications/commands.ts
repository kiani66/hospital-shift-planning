import { z } from "zod";

import type { NotificationType } from "../../infrastructure/db/schema";
import {
  findNotificationForRecipient,
  markAllNotificationsRead as markAllRead,
  markNotificationRead as markRead,
} from "../../infrastructure/repositories/notifications";
import { findScheduleDepartmentCode } from "../../infrastructure/repositories/schedules";
import { NotFoundError } from "../errors";
import { defineCommand } from "../use-case";

/**
 * Read state is the recipient's own UI state, not a schedule change: these
 * commands write no audit event (see docs/decisions.md, D32). They still run
 * through `defineCommand` (one transaction, mandatory authorization, stable
 * error mapping).
 */

export interface MarkNotificationReadOutput {
  readonly id: string;
  readonly type: NotificationType;
  readonly scheduleId: string | null;
  /** The code of the schedule's department, for the destination link. */
  readonly departmentCode: string | null;
  /** False when it was already read (the call is idempotent). */
  readonly changed: boolean;
}

/**
 * Marks one of the actor's own notifications as read. The update is scoped
 * to `recipient_id = actor` and `read_at IS NULL`, so it is idempotent (the
 * first read time is kept) and concurrent calls cannot conflict. An unknown
 * id and another user's id both answer NOT_FOUND: nothing reveals whether
 * someone else's notification exists.
 */
export const markNotificationRead = defineCommand({
  name: "notification.markRead",
  input: z.object({ notificationId: z.uuid() }),
  async handler(uow, input): Promise<MarkNotificationReadOutput> {
    const recipientId = uow.actor.userId;
    uow.authorize("notification.access", { recipientId });

    const changed = await markRead(uow.tx, {
      id: input.notificationId,
      recipientId,
      now: uow.now,
    });
    const notification = await findNotificationForRecipient(uow.tx, {
      id: input.notificationId,
      recipientId,
    });
    if (!notification) throw new NotFoundError("Notification");
    // Defense in depth: the query is already scoped to the actor.
    uow.authorize("notification.access", {
      recipientId: notification.recipientId,
    });

    return {
      id: notification.id,
      type: notification.type,
      scheduleId: notification.scheduleId,
      departmentCode: notification.scheduleId
        ? await findScheduleDepartmentCode(uow.tx, notification.scheduleId)
        : null,
      changed,
    };
  },
});

/**
 * Marks every unread notification of the actor as read (only theirs). Safe
 * to repeat: a second call changes nothing and reports 0.
 */
export const markAllNotificationsRead = defineCommand({
  name: "notification.markAllRead",
  input: z.object({}),
  async handler(uow): Promise<{ readonly changed: number }> {
    const recipientId = uow.actor.userId;
    uow.authorize("notification.access", { recipientId });
    return {
      changed: await markAllRead(uow.tx, { recipientId, now: uow.now }),
    };
  },
});
