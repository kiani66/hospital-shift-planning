import { index, jsonb, pgTable, uuid } from "drizzle-orm/pg-core";

import { createdAt, id, instant } from "./columns";
import { notificationType } from "./enums";
import { users } from "./identity";
import { schedules } from "./schedules";

/** In-app notifications, written in the same transaction as the change they describe. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    recipientId: uuid()
      .notNull()
      .references(() => users.id),
    type: notificationType().notNull(),
    scheduleId: uuid().references(() => schedules.id),
    /** Structured payload (dates, labels); rendered to text at display time. */
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    readAt: instant(),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientId, t.createdAt.desc()),
  ],
);
