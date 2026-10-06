import { authorize } from "../../domain/authz/policies";
import {
  compareIsoDates,
  parseIsoDate,
  type IsoDate,
} from "../../domain/shared/dates";
import { unwrap } from "../../domain/shared/result";
import { publishConflicts } from "../../domain/staffing-rules/lifecycle";
import type { RuleSetContent } from "../../domain/staffing-rules/model";
import {
  effectiveState,
  type EffectiveState,
} from "../../domain/staffing-rules/selection";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { listDepartments } from "../../infrastructure/repositories/departments";
import {
  countRuleSetPins,
  findRuleSetVersion,
  listAllRuleSetVersions,
  loadRuleSetContents,
  type RuleSetVersionRecord,
} from "../../infrastructure/repositories/staffing-rules";
import { listDisplayNames } from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import { listRuleSetHistory, type RuleSetHistoryEntry } from "./history";
import type { AppContext } from "../use-case";

/** A version as the rule-set screens show it. */
export interface RuleSetVersionView {
  readonly id: string;
  readonly ruleSetId: string;
  readonly departmentId: string | null;
  readonly versionNo: number;
  readonly status: RuleSetVersionRecord["status"];
  /** Derived from the dates; never stored (D105). */
  readonly state: EffectiveState;
  readonly effectiveFrom: IsoDate | null;
  readonly note: string | null;
  /** Draft edit counter (send it back when editing or publishing). */
  readonly revision: number;
  readonly legacyBaseline: boolean;
  readonly basedOnVersionId: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly publishedBy: string | null;
  readonly publishedAt: Date | null;
  readonly retiredBy: string | null;
  readonly retiredAt: Date | null;
  readonly retiredReason: RuleSetVersionRecord["retiredReason"];
  readonly replacedByVersionId: string | null;
  readonly content: RuleSetContent;
  /** Schedules pinned to it now and approved versions recorded with it. */
  readonly pins: {
    readonly schedules: number;
    readonly approvedVersions: number;
  };
}

export interface RuleSetScopeView {
  /** null: the Hospital Default. */
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly departmentCode: string | null;
  /** Newest first. */
  readonly versions: readonly RuleSetVersionView[];
  /** The version effective today, if any. */
  readonly effectiveVersionId: string | null;
  /** The open draft, if any. */
  readonly draftVersionId: string | null;
}

export interface RuleSetAdministration {
  readonly today: IsoDate;
  /** The full rule-set log, newest first, discarded drafts included (D110). */
  readonly history: readonly RuleSetHistoryEntry[];
  /** The Hospital Default first, then every active department by name. */
  readonly scopes: readonly RuleSetScopeView[];
  /** Names of the people who created, published or retired a version. */
  readonly names: ReadonlyMap<string, string>;
}

/** Turns stored versions into views (content and pins in a constant number of queries). */
export async function toVersionViews(
  ctx: AppContext,
  versions: readonly RuleSetVersionRecord[],
  today: IsoDate,
): Promise<RuleSetVersionView[]> {
  const ids = versions.map((v) => v.id);
  const [contents, pins] = await Promise.all([
    loadRuleSetContents(ctx.db, ids),
    countRuleSetPins(ctx.db, ids),
  ]);
  return versions.map((v) => ({
    id: v.id,
    ruleSetId: v.ruleSetId,
    departmentId: v.departmentId,
    versionNo: v.versionNo,
    status: v.status,
    state: effectiveState(
      v,
      versions.filter((x) => x.ruleSetId === v.ruleSetId),
      today,
    ),
    effectiveFrom: v.effectiveFrom,
    note: v.note,
    revision: v.revision,
    legacyBaseline: v.origin === "MIGRATION",
    basedOnVersionId: v.basedOnVersionId,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    publishedBy: v.publishedBy,
    publishedAt: v.publishedAt,
    retiredBy: v.retiredBy,
    retiredAt: v.retiredAt,
    retiredReason: v.retiredReason,
    replacedByVersionId: v.replacedByVersionId,
    content: contents.get(v.id)!,
    pins: pins.get(v.id)!,
  }));
}

export const peopleOf = (versions: readonly RuleSetVersionView[]) => [
  ...new Set(
    versions.flatMap((v) =>
      [v.createdBy, v.publishedBy, v.retiredBy].filter(
        (id): id is string => id !== null,
      ),
    ),
  ),
];

/**
 * The Hospital Admin's overview of every scope and version (D108,
 * `staffingRules.manage`). Others get ForbiddenError (the page turns it
 * into a 404). Constant number of queries.
 */
export async function getRuleSetAdministration(
  ctx: AppContext,
): Promise<RuleSetAdministration> {
  unwrap(authorize(ctx.actor, "staffingRules.manage", {}));
  const today = todayIn(APP_TIMEZONE, ctx.clock?.() ?? new Date());
  const [stored, departments] = await Promise.all([
    listAllRuleSetVersions(ctx.db),
    listDepartments(ctx.db),
  ]);
  const [versions, history] = await Promise.all([
    toVersionViews(ctx, stored, today),
    listRuleSetHistory(ctx.db, { includeDrafts: true }),
  ]);
  const scope = (departmentId: string | null) => {
    const own = versions
      .filter((v) => v.departmentId === departmentId)
      .sort((a, b) => b.versionNo - a.versionNo);
    return {
      versions: own,
      effectiveVersionId: own.find((v) => v.state === "EFFECTIVE")?.id ?? null,
      draftVersionId: own.find((v) => v.status === "DRAFT")?.id ?? null,
    };
  };
  const active = departments
    .filter((d) => d.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, "fa"));
  return {
    today,
    history,
    scopes: [
      {
        departmentId: null,
        departmentName: null,
        departmentCode: null,
        ...scope(null),
      },
      ...active.map((d) => ({
        departmentId: d.id,
        departmentName: d.name,
        departmentCode: d.code,
        ...scope(d.id),
      })),
    ],
    names: await listDisplayNames(ctx.db, [
      ...new Set([...peopleOf(versions), ...history.map((h) => h.actorId)]),
    ]),
  };
}

export interface PublishPreview {
  readonly effectiveFrom: IsoDate;
  readonly immediate: boolean;
  readonly inPast: boolean;
  /** PUBLISHED versions this publication would replace (retire) if confirmed. */
  readonly conflicts: readonly {
    readonly versionId: string;
    readonly versionNo: number;
    readonly effectiveFrom: IsoDate;
    readonly state: EffectiveState;
    readonly pinnedSchedules: number;
  }[];
}

/**
 * What publishing a draft on `effectiveFrom` would do, without writing
 * (K: detect and explain before anything is replaced). Pinned schedules are
 * listed so the Hospital Admin sees that their pins do not move.
 */
export async function previewRuleSetPublication(
  ctx: AppContext,
  input: { versionId: string; effectiveFrom: string },
): Promise<PublishPreview> {
  unwrap(authorize(ctx.actor, "staffingRules.manage", {}));
  const effectiveFrom = unwrap(
    parseIsoDate(input.effectiveFrom, "effectiveFrom"),
  );
  const version = await findRuleSetVersion(ctx.db, input.versionId);
  if (!version) throw new NotFoundError("Rule set version");
  const today = todayIn(APP_TIMEZONE, ctx.clock?.() ?? new Date());
  const lineage = (await listAllRuleSetVersions(ctx.db)).filter(
    (v) => v.ruleSetId === version.ruleSetId,
  );
  const conflicts = publishConflicts(lineage, effectiveFrom);
  const pins = await countRuleSetPins(
    ctx.db,
    conflicts.map((c) => c.id),
  );
  return {
    effectiveFrom,
    immediate: effectiveFrom === today,
    inPast: compareIsoDates(effectiveFrom, today) < 0,
    conflicts: conflicts.map((c) => ({
      versionId: c.id,
      versionNo: c.versionNo,
      effectiveFrom: c.effectiveFrom!,
      state: effectiveState(c, lineage, today),
      pinnedSchedules: pins.get(c.id)!.schedules,
    })),
  };
}
