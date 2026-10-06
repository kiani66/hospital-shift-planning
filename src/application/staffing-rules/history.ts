import type { ValidationCounts } from "../../domain/rules/validation-summary";
import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../../infrastructure/db/database";
import { listAuditEventsForEntities } from "../../infrastructure/repositories/audit";
import type { RuleSetApplicationRecord } from "../../infrastructure/repositories/staffing-rules";

/**
 * Read-only rule-set history (D110), from the append-only audit trail and
 * the Apply records. Nothing here writes.
 */

export type RuleSetHistoryKind =
  | "DRAFT_CREATED"
  | "DRAFT_UPDATED"
  | "DRAFT_DISCARDED"
  | "PUBLISHED"
  | "RETIRED";

export interface RuleSetHistoryEntry {
  readonly kind: RuleSetHistoryKind;
  readonly at: Date;
  readonly actorId: string;
  readonly versionId: string;
  readonly versionNo: number;
  /** The scope's department; null: the Hospital Default. */
  readonly departmentId: string | null;
  readonly effectiveFrom: IsoDate | null;
  /** RETIRED: REPLACED or WITHDRAWN. */
  readonly retiredReason: string | null;
  readonly replacedByVersionNo: number | null;
  readonly note: string | null;
}

export interface ApplicationHistoryEntry {
  readonly id: string;
  readonly at: Date;
  readonly actorId: string;
  readonly scheduleId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly rollback: boolean;
  readonly revisionId: string | null;
  readonly before: ValidationCounts | null;
  readonly after: ValidationCounts | null;
  readonly addedRevisionDates: readonly IsoDate[];
}

const KINDS: Record<string, RuleSetHistoryKind> = {
  "staffingRuleSet.draftCreated": "DRAFT_CREATED",
  "staffingRuleSet.draftUpdated": "DRAFT_UPDATED",
  "staffingRuleSet.draftDiscarded": "DRAFT_DISCARDED",
  "staffingRuleSet.published": "PUBLISHED",
  "staffingRuleSet.retired": "RETIRED",
};

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

/**
 * Lifecycle events of rule-set versions, newest first: of the given
 * versions, or of every version when `versionIds` is omitted (the Hospital
 * Admin's full log, including discarded drafts). `includeDrafts: false`
 * keeps published history only (what a Head Nurse reads).
 */
export async function listRuleSetHistory(
  db: DbExecutor,
  input: { versionIds?: readonly string[]; includeDrafts: boolean },
): Promise<RuleSetHistoryEntry[]> {
  const events = await listAuditEventsForEntities(db, {
    entityType: "staffing_rule_set_version",
    entityIds: input.versionIds,
  });
  return events.flatMap((e): RuleSetHistoryEntry[] => {
    const kind = KINDS[e.action];
    if (!kind) return [];
    if (!input.includeDrafts && kind.startsWith("DRAFT_")) return [];
    return [
      {
        kind,
        at: e.occurredAt,
        actorId: e.actorId,
        versionId: e.entityId!,
        versionNo: num(e.data.versionNo) ?? 0,
        departmentId: e.departmentId,
        effectiveFrom: str(e.data.effectiveFrom) as IsoDate | null,
        retiredReason: str(e.data.reason),
        replacedByVersionNo: num(e.data.replacedByVersionNo),
        note: e.reason,
      },
    ];
  });
}

/** Apply records as history entries (impact as recorded at the time). */
export const toApplicationHistory = (
  records: readonly RuleSetApplicationRecord[],
): ApplicationHistoryEntry[] =>
  records.map((r) => ({
    id: r.id,
    at: r.appliedAt,
    actorId: r.appliedBy,
    scheduleId: r.scheduleId,
    fromVersionId: r.fromVersionId,
    toVersionId: r.toVersionId,
    rollback: r.rollback,
    revisionId: r.revisionId,
    before: (r.impact.before as ValidationCounts | undefined) ?? null,
    after: (r.impact.after as ValidationCounts | undefined) ?? null,
    addedRevisionDates:
      (r.impact.addedRevisionDates as IsoDate[] | undefined) ?? [],
  }));
