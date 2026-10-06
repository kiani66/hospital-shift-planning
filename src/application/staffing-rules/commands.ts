import { z } from "zod";

import { parseIsoDate } from "../../domain/shared/dates";
import { InvalidStateError, ValidationError } from "../../domain/shared/errors";
import { unwrap } from "../../domain/shared/result";
import { COVERAGE_PERIODS } from "../../domain/shifts/shift-type";
import {
  canDiscardDraft,
  canEditDraft,
  canRetire,
  planPublish,
} from "../../domain/staffing-rules/lifecycle";
import {
  RULE_SET_NOTE_MAX_LENGTH,
  validateRuleSetContent,
  type RuleSetContent,
} from "../../domain/staffing-rules/model";
import { selectEffective } from "../../domain/staffing-rules/selection";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import {
  deleteRuleSetDraft,
  findRuleSetVersion,
  insertRuleSetDraft,
  listAllRuleSetVersions,
  loadRuleSetContent,
  lockRuleSetLineage,
  markRuleSetPublished,
  markRuleSetRetired,
  replaceRuleSetDraft,
  type RuleSetVersionRecord,
} from "../../infrastructure/repositories/staffing-rules";
import { ConflictError, NotFoundError } from "../errors";
import { defineCommand, type UnitOfWork } from "../use-case";

/**
 * Hospital Admin rule-set management (D105, D108, D110). Every command is
 * one transaction: authorize `staffingRules.manage`, lock the scope's
 * lineage (all writes of a scope are serialized on it), let the domain
 * decide, write, audit. Content changes only while a version is a DRAFT;
 * publishing and retiring change its lifecycle, never its bounds. No
 * schedule pin is ever touched here (D106): only Apply moves a pin.
 */

/** `ConflictError.reason` of a publication that would replace versions not confirmed. */
export const RULE_SET_PUBLISH_CONFLICT = "RULE_SET_PUBLISH_CONFLICT";
/** `ConflictError.reason` when the lineage already has an open draft. */
export const RULE_SET_DRAFT_EXISTS = "RULE_SET_DRAFT_EXISTS";

const bounds = z.object({
  min: z.number().int(),
  max: z.number().int().nullable(),
});

/** The editable content of a draft; the domain checks ranges, dates and duplicates. */
export const ruleSetContentInput = z.object({
  normal: z.object({ M: bounds, E: bounds, N: bounds }),
  holiday: z.object({
    M: bounds.optional(),
    E: bounds.optional(),
    N: bounds.optional(),
  }),
  exceptions: z
    .array(
      z.object({
        date: z.string(),
        period: z.enum(COVERAGE_PERIODS),
        bounds,
        note: z.string().trim().max(RULE_SET_NOTE_MAX_LENGTH).nullable(),
      }),
    )
    .max(400),
});

const note = z
  .string()
  .trim()
  .max(RULE_SET_NOTE_MAX_LENGTH)
  .nullable()
  .transform((n) => (n ? n : null));

const today = (uow: UnitOfWork) => todayIn(APP_TIMEZONE, uow.now);

const authorizeManage = (uow: UnitOfWork) =>
  uow.authorize("staffingRules.manage", {});

/** A version by id under the caller's lock of its lineage, or NotFound. */
async function loadForWrite(
  uow: UnitOfWork,
  versionId: string,
): Promise<{
  version: RuleSetVersionRecord;
  lineage: RuleSetVersionRecord[];
}> {
  const found = await findRuleSetVersion(uow.tx, versionId);
  if (!found) throw new NotFoundError("Rule set version");
  await lockRuleSetLineage(uow.tx, found.departmentId);
  // Re-read under the lock: what we decide on cannot change before commit.
  const lineage = (await listAllRuleSetVersions(uow.tx)).filter(
    (v) => v.ruleSetId === found.ruleSetId,
  );
  return { version: lineage.find((v) => v.id === versionId)!, lineage };
}

const auditBase = (version: { id: string; departmentId: string | null }) => ({
  departmentId: version.departmentId,
  entityType: "staffing_rule_set_version",
  entityId: version.id,
});

function parseContent(
  input: z.output<typeof ruleSetContentInput>,
): RuleSetContent {
  const exceptions = input.exceptions.map((e) => ({
    ...e,
    date: unwrap(parseIsoDate(e.date, "exceptions")),
  }));
  return unwrap(
    validateRuleSetContent({
      normal: input.normal,
      holiday: Object.fromEntries(
        Object.entries(input.holiday).filter(([, b]) => b),
      ),
      exceptions,
    }),
  );
}

export interface DraftOutput {
  readonly versionId: string;
  readonly versionNo: number;
  readonly revision: number;
}

/**
 * Starts a new DRAFT in a scope (null: the Hospital Default), copied from
 * `basedOnVersionId` or, without it, from the scope's version effective
 * today; a new Department Override starts from the Hospital Default
 * effective today (a complete, independent snapshot, D105). One open draft
 * per scope.
 */
export const createRuleSetDraft = defineCommand({
  name: "staffingRules.createDraft",
  input: z.object({
    departmentId: z.uuid().nullable(),
    basedOnVersionId: z.uuid().nullable().optional(),
    note: note.optional(),
  }),
  async handler(uow, input): Promise<DraftOutput> {
    authorizeManage(uow);
    if (input.departmentId) {
      const department = await findDepartmentById(uow.tx, input.departmentId);
      if (!department?.isActive) throw new NotFoundError("Department");
    }
    const lineage = await lockRuleSetLineage(uow.tx, input.departmentId);
    const all = await listAllRuleSetVersions(uow.tx);
    const own = all.filter((v) => v.ruleSetId === lineage.id);
    const hospital = all.filter((v) => v.departmentId === null);
    if (own.some((v) => v.status === "DRAFT"))
      throw new ConflictError(
        "This scope already has an open draft",
        RULE_SET_DRAFT_EXISTS,
      );

    let base: RuleSetVersionRecord | null;
    if (input.basedOnVersionId) {
      base = all.find((v) => v.id === input.basedOnVersionId) ?? null;
      // Copy only from the same lineage, or from the Hospital Default.
      if (
        !base ||
        (base.ruleSetId !== lineage.id && base.departmentId !== null)
      )
        throw new ValidationError(
          "A draft can be based on a version of the same scope or of the Hospital Default",
          "basedOnVersionId",
        );
    } else
      base =
        selectEffective(own, today(uow)) ??
        selectEffective(hospital, today(uow));
    if (!base) throw new NotFoundError("Rule set version");

    const content = await loadRuleSetContent(uow.tx, base.id);
    const versionId = await insertRuleSetDraft(uow.tx, {
      ruleSetId: lineage.id,
      basedOnVersionId: base.id,
      content,
      note: input.note ?? null,
      createdBy: uow.actor.userId,
    });
    const created = (await findRuleSetVersion(uow.tx, versionId))!;
    await uow.audit({
      ...auditBase(created),
      action: "staffingRuleSet.draftCreated",
      data: {
        versionNo: created.versionNo,
        scope: input.departmentId === null ? "HOSPITAL" : "DEPARTMENT",
        basedOnVersionId: base.id,
        basedOnVersionNo: base.versionNo,
        content,
      },
    });
    return {
      versionId,
      versionNo: created.versionNo,
      revision: created.revision,
    };
  },
});

/** Replaces a DRAFT's bounds, holiday bounds, date exceptions and note. */
export const updateRuleSetDraft = defineCommand({
  name: "staffingRules.updateDraft",
  input: z.object({
    versionId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    content: ruleSetContentInput,
    note,
  }),
  async handler(uow, input): Promise<DraftOutput> {
    authorizeManage(uow);
    const { version } = await loadForWrite(uow, input.versionId);
    unwrap(canEditDraft(version));
    if (version.revision !== input.expectedRevision) throw new ConflictError();
    const content = parseContent(input.content);
    const before = await loadRuleSetContent(uow.tx, version.id);
    const saved = await replaceRuleSetDraft(uow.tx, {
      versionId: version.id,
      expectedRevision: input.expectedRevision,
      content,
      note: input.note,
    });
    if (!saved) throw new ConflictError();
    await uow.audit({
      ...auditBase(version),
      action: "staffingRuleSet.draftUpdated",
      data: {
        versionNo: version.versionNo,
        before,
        after: content,
        noteBefore: version.note,
        noteAfter: input.note,
      },
    });
    return {
      versionId: version.id,
      versionNo: version.versionNo,
      revision: version.revision + 1,
    };
  },
});

/** Deletes a never-published DRAFT (nothing can reference it). */
export const discardRuleSetDraft = defineCommand({
  name: "staffingRules.discardDraft",
  input: z.object({
    versionId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  async handler(uow, input): Promise<{ versionId: string }> {
    authorizeManage(uow);
    const { version } = await loadForWrite(uow, input.versionId);
    unwrap(canDiscardDraft(version));
    const content = await loadRuleSetContent(uow.tx, version.id);
    if (!(await deleteRuleSetDraft(uow.tx, input))) throw new ConflictError();
    await uow.audit({
      ...auditBase(version),
      action: "staffingRuleSet.draftDiscarded",
      data: { versionNo: version.versionNo, content },
    });
    return { versionId: version.id };
  },
});

export interface PublishOutput {
  readonly versionId: string;
  readonly effectiveFrom: string;
  /** Versions retired as REPLACED by this publication (explicitly confirmed). */
  readonly replaced: readonly string[];
}

/**
 * DRAFT → PUBLISHED, effective today ("immediately") or from a future day.
 * A conflict with PUBLISHED versions effective on or after that day stops
 * the publication (CONFLICT, `RULE_SET_PUBLISH_CONFLICT`) unless the caller
 * names exactly those versions in `confirmReplaceVersionIds`; they are then
 * retired as REPLACED, each audited. No schedule pin changes (D106).
 */
export const publishRuleSetVersion = defineCommand({
  name: "staffingRules.publish",
  input: z.object({
    versionId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    effectiveFrom: z.string(),
    confirmReplaceVersionIds: z.array(z.uuid()).max(100).default([]),
  }),
  async handler(uow, input): Promise<PublishOutput> {
    authorizeManage(uow);
    const effectiveFrom = unwrap(
      parseIsoDate(input.effectiveFrom, "effectiveFrom"),
    );
    const { version, lineage } = await loadForWrite(uow, input.versionId);
    if (
      version.status === "DRAFT" &&
      version.revision !== input.expectedRevision
    )
      throw new ConflictError();
    const plan = planPublish({
      version,
      lineage,
      effectiveFrom,
      today: today(uow),
      confirmReplace: input.confirmReplaceVersionIds,
    });
    if (!plan.ok) {
      if (plan.error instanceof InvalidStateError) throw plan.error;
      if (plan.error instanceof ValidationError) throw plan.error;
      throw new ConflictError(
        "Publishing would replace scheduled versions; confirm them explicitly",
        RULE_SET_PUBLISH_CONFLICT,
      );
    }
    for (const replaced of plan.value.replace) {
      await markRuleSetRetired(uow.tx, {
        versionId: replaced.id,
        reason: "REPLACED",
        retiredBy: uow.actor.userId,
        replacedByVersionId: version.id,
        now: uow.now,
      });
      await uow.audit({
        ...auditBase(replaced),
        action: "staffingRuleSet.retired",
        data: {
          versionNo: replaced.versionNo,
          reason: "REPLACED",
          effectiveFrom: replaced.effectiveFrom,
          replacedByVersionId: version.id,
          replacedByVersionNo: version.versionNo,
        },
      });
    }
    if (
      !(await markRuleSetPublished(uow.tx, {
        versionId: version.id,
        expectedRevision: input.expectedRevision,
        effectiveFrom,
        publishedBy: uow.actor.userId,
        now: uow.now,
      }))
    )
      throw new ConflictError();
    const previous = lineage
      .filter((v) => v.status === "PUBLISHED" && v.id !== version.id)
      .sort((a, b) => b.versionNo - a.versionNo)[0];
    await uow.audit({
      ...auditBase(version),
      action: "staffingRuleSet.published",
      data: {
        versionNo: version.versionNo,
        effectiveFrom,
        immediate: effectiveFrom === today(uow),
        previousVersionId: previous?.id ?? null,
        previousVersionNo: previous?.versionNo ?? null,
        replacedVersionIds: plan.value.replace.map((v) => v.id),
        content: await loadRuleSetContent(uow.tx, version.id),
      },
    });
    return {
      versionId: version.id,
      effectiveFrom,
      replaced: plan.value.replace.map((v) => v.id),
    };
  },
});

/**
 * Withdraws a PUBLISHED version (RETIRED, reason WITHDRAWN): never selected
 * for new schedules again, still a valid pin and part of history. A Hospital
 * Default version only while it is still scheduled (D105).
 */
export const retireRuleSetVersion = defineCommand({
  name: "staffingRules.retire",
  input: z.object({ versionId: z.uuid(), note: note.optional() }),
  async handler(uow, input): Promise<{ versionId: string }> {
    authorizeManage(uow);
    const { version } = await loadForWrite(uow, input.versionId);
    unwrap(canRetire(version, today(uow)));
    await markRuleSetRetired(uow.tx, {
      versionId: version.id,
      reason: "WITHDRAWN",
      retiredBy: uow.actor.userId,
      replacedByVersionId: null,
      now: uow.now,
    });
    await uow.audit({
      ...auditBase(version),
      action: "staffingRuleSet.retired",
      reason: input.note ?? undefined,
      data: {
        versionNo: version.versionNo,
        reason: "WITHDRAWN",
        effectiveFrom: version.effectiveFrom,
      },
    });
    return { versionId: version.id };
  },
});
