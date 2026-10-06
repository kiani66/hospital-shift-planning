import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { instant } from "./columns";
import { departments, users } from "./identity";
import { schedules } from "./schedules";

/** Append-only audit trail. The application only ever inserts. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: instant().notNull().defaultNow(),
    actorId: uuid()
      .notNull()
      .references(() => users.id),
    departmentId: uuid().references(() => departments.id),
    scheduleId: uuid().references(() => schedules.id),
    /** e.g. "schedule.finalized", "assignment.set". */
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    /** Structured details: { before, after } or a summary. Sensitive keys are redacted. */
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    reason: text(),
  },
  (t) => [
    index("audit_events_schedule_idx").on(t.scheduleId, t.occurredAt),
    index("audit_events_department_idx").on(t.departmentId, t.occurredAt),
    // Rule-set history (D110) is read by entity, not by schedule or department.
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
  ],
);
