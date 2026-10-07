import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { auditEvents } from "../db/schema";

/**
 * Append-only audit trail: this module only inserts and reads. Call
 * `recordAuditEvent` inside the business transaction so the event commits or
 * rolls back together with the change it describes.
 */

export interface NewAuditEvent {
  readonly actorId: string;
  /** e.g. "schedule.finalized". */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly departmentId?: string | null;
  readonly scheduleId?: string | null;
  readonly data?: Record<string, unknown>;
  readonly reason?: string | null;
}

export interface AuditEventRecord extends Required<
  Omit<NewAuditEvent, "data">
> {
  readonly id: number;
  readonly occurredAt: Date;
  readonly data: Record<string, unknown>;
}

const SENSITIVE_KEY = /password|secret|token|hash/i;

/** Replaces values under sensitive-looking keys, at any depth. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) ? "[redacted]" : redactSensitive(v),
      ]),
    );
  }
  return value;
}

export async function recordAuditEvent(
  db: DbExecutor,
  event: NewAuditEvent,
): Promise<void> {
  await db.insert(auditEvents).values({
    actorId: event.actorId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId ?? null,
    departmentId: event.departmentId ?? null,
    scheduleId: event.scheduleId ?? null,
    data: redactSensitive(event.data ?? {}) as Record<string, unknown>,
    reason: event.reason ?? null,
  });
}

export async function listAuditEventsForSchedule(
  db: DbExecutor,
  scheduleId: string,
): Promise<AuditEventRecord[]> {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.scheduleId, scheduleId))
    .orderBy(asc(auditEvents.id));
}

/**
 * Events of one entity type, newest first: of the given entity ids, or of
 * every entity of that type when `entityIds` is omitted (one query, uses
 * `audit_events_entity_idx`).
 */
export async function listAuditEventsForEntities(
  db: DbExecutor,
  input: { entityType: string; entityIds?: readonly string[] },
): Promise<AuditEventRecord[]> {
  if (input.entityIds && input.entityIds.length === 0) return [];
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, input.entityType),
        input.entityIds
          ? inArray(auditEvents.entityId, [...input.entityIds])
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.id));
}
