import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import { sortByPersonnelOrder } from "../../domain/identity/personnel-order";
import {
  planDailyPreferences,
  type DailyPreferenceGroupSkip,
  type DailyPreferencePlanInput,
  type DailyPreferenceReason,
  type DailyPreferenceSuggestion,
} from "../../domain/preferences/daily-assistant";
import type { Violation } from "../../domain/rules/violation";
import { assessEdits } from "../../domain/schedule/assess-edits";
import {
  assignmentKey,
  planAssignmentEdits,
} from "../../domain/schedule/assignment-editing";
import { addDays, isIsoDate, type IsoDate } from "../../domain/shared/dates";
import {
  InvalidStateError,
  RuleViolationError,
  ValidationError,
} from "../../domain/shared/errors";
import { isInPeriod } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import type { Assignment } from "../../domain/shifts/assignment";
import { isWorkingShift } from "../../domain/shifts/shift-type";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  listAdjacentAssignments,
  listRosterAssignments,
} from "../../infrastructure/repositories/assignments";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import {
  listImportPeriodMembers,
  lockImportMemberships,
} from "../../infrastructure/repositories/schedule-import";
import {
  findScheduleById,
  type ScheduleRecord,
} from "../../infrastructure/repositories/schedules";
import { NO_HOLIDAY_DATA, type HolidayCalendar } from "../calendar/holidays";
import { ConflictError, NotFoundError } from "../errors";
import {
  holidayDates,
  loadRuleSet,
  requirementsUnder,
} from "../staffing-rules/pinned";
import { defineCommand, type AppContext } from "../use-case";
import { writeAssignmentChanges } from "./edit-assignments";
import {
  loadScheduleForAssignmentUpdate,
  saveSchedule,
} from "./load-for-update";

/** Displayed nurse lists follow the shared personnel-number order (the planner's own order is by id). */
function personnelOrderOf(
  roster: readonly {
    userId: string;
    displayName: string;
    personnelNumber: string | null;
  }[],
) {
  const keys = new Map(roster.map((r) => [r.userId, { ...r, id: r.userId }]));
  return <T extends { nurseId: string }>(rows: readonly T[]): T[] =>
    sortByPersonnelOrder(rows, (r) => keys.get(r.nurseId) ?? { id: r.nurseId });
}

const uuidInput = z.uuid().transform((value) => value.toLowerCase());
export const readDailyPreferencesInput = z.object({
  scheduleId: uuidInput,
  date: z
    .string()
    .refine(isIsoDate)
    .transform((v) => v as IsoDate),
});
const proofInput = z.object({
  issuedAt: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export const acceptDailyPreferencesInput = readDailyPreferencesInput.extend({
  expectedRevision: z.number().int().nonnegative(),
  proof: proofInput,
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ONE"), nurseId: uuidInput }),
    z.object({
      kind: z.literal("BULK"),
      excludedNurseIds: z.array(uuidInput).max(500).default([]),
    }),
  ]),
});
type Target = z.output<typeof readDailyPreferencesInput>;
type Proof = z.output<typeof proofInput>;
export type DailyPreferenceOperation = z.output<
  typeof acceptDailyPreferencesInput
>["operation"];

export interface DailyPreferenceOutcome {
  readonly nurseId: string;
  readonly displayName: string | null;
  readonly preference: DailyPreferenceSuggestion["preference"];
  readonly previousAssignment: DailyPreferenceSuggestion["currentAssignment"];
  readonly outcome:
    "CREATED" | "ALREADY_ASSIGNED" | "INFORMATIONAL" | "SKIPPED";
  readonly reason:
    DailyPreferenceReason | DailyPreferenceGroupSkip["reason"] | null;
  readonly violations: readonly Violation[];
}

const stale = () =>
  new ConflictError(
    "Daily preferences changed or expired; reload before accepting",
    "DAILY_PREFERENCES_STALE",
  );
const fingerprint = (
  schedule: ScheduleRecord,
  input: DailyPreferencePlanInput,
) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        schedule,
        ...input,
        holidays: [...input.holidays].sort(),
      }),
    )
    .digest("hex");

/** Same actor-bound HMAC/fingerprint and 15-minute expiry pattern as Schedule Copy. */
function sign(
  actorId: string,
  target: Target,
  proof: Omit<Proof, "signature">,
) {
  const key = process.env.AUTH_SECRET;
  if (!key)
    throw new Error(
      "AUTH_SECRET is required to sign daily preference previews",
    );
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        "daily-preferences-v1",
        actorId,
        target.scheduleId,
        target.date,
        proof.issuedAt,
        proof.fingerprint,
      ]),
    )
    .digest("hex");
}

async function requireAuthority(
  db: DbExecutor,
  ctx: Pick<AppContext, "actor">,
  schedule: ScheduleRecord,
  now: Date,
) {
  unwrap(
    authorize(ctx.actor, "assignment.edit", {
      departmentId: schedule.departmentId,
    }),
  );
  const actor = await loadActor(
    db,
    ctx.actor.userId,
    todayIn(APP_TIMEZONE, now),
  );
  unwrap(
    authorize(actor ?? { ...ctx.actor, isActive: false }, "assignment.edit", {
      departmentId: schedule.departmentId,
    }),
  );
  const department = await findDepartmentById(db, schedule.departmentId);
  if (!department?.isActive) throw new NotFoundError("Department");
  if (schedule.status !== "DRAFT" && schedule.status !== "PLANNING")
    throw new InvalidStateError(schedule.status, "DAILY_PREFERENCES");
}

async function loadContext(
  db: DbExecutor,
  schedule: ScheduleRecord,
  date: IsoDate,
  holidays: HolidayCalendar,
) {
  if (!isInPeriod(schedule.period, date))
    throw new ValidationError(
      "The date is outside the schedule period",
      "date",
    );
  // Sequential reads on the same transaction client; no per-person queries.
  const { assignments, roster } = await listRosterAssignments(db, schedule.id);
  const preferences = await listPreferences(db, schedule.id, { date });
  const members = await listImportPeriodMembers(db, schedule.departmentId, {
    start: date,
    end: date,
  });
  const ruleSet = await loadRuleSet(db, schedule.staffingRuleSetVersionId);
  const holidaySet = await holidayDates(holidays, { start: date, end: date });
  const adjacentAssignments = await listAdjacentAssignments(db, {
    departmentId: schedule.departmentId,
    excludeScheduleId: schedule.id,
    // Includes people with no decisions in the current month (cross-period rest).
    nurseIds: roster.map((r) => r.userId),
    dates: [
      addDays(schedule.period.start, -1),
      addDays(schedule.period.end, 1),
    ],
  });
  const input = {
    date,
    period: schedule.period,
    preferences,
    assignments,
    roster,
    members,
    staffingRuleSet: {
      versionId: ruleSet.version.id,
      content: ruleSet.content,
    },
    holidays: holidaySet,
    adjacentAssignments,
  } satisfies DailyPreferencePlanInput;
  return { input, ruleSet };
}

/** One consistent, read-only snapshot; no preview rows, audit or schedule mutation. */
export async function readDailyPreferences(ctx: AppContext, raw: unknown) {
  const target = readDailyPreferencesInput.parse(raw);
  const now = ctx.clock?.() ?? new Date();
  return ctx.db.transaction(
    async (tx) => {
      const schedule = await findScheduleById(tx, target.scheduleId);
      if (!schedule) throw new NotFoundError("Schedule");
      await requireAuthority(tx, ctx, schedule, now);
      const { input } = await loadContext(
        tx,
        schedule,
        target.date,
        ctx.holidays ?? NO_HOLIDAY_DATA,
      );
      const plan = planDailyPreferences(input);
      const names = new Map(input.roster.map((r) => [r.userId, r.displayName]));
      const inOrder = personnelOrderOf(input.roster);
      const person = (row: DailyPreferenceSuggestion) => ({
        ...row,
        displayName: names.get(row.nurseId) ?? null,
      });
      const proof = {
        issuedAt: now.getTime(),
        fingerprint: fingerprint(schedule, input),
      };
      return {
        ...plan,
        scheduleId: schedule.id,
        revision: schedule.revision,
        proof: { ...proof, signature: sign(ctx.actor.userId, target, proof) },
        groups: plan.groups.map((g) => ({
          ...g,
          bulkEligible: !plan.skippedGroups.some((s) => s.shift === g.shift),
          suggestions: inOrder(g.suggestions).map(person),
        })),
        offPreferences: inOrder(plan.offPreferences).map(person),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type DailyPreferencePreview = Awaited<
  ReturnType<typeof readDailyPreferences>
>;

/** Insertion only, fully revalidated inside one assignment/boundary-lock transaction. */
export const acceptDailyPreferences = defineCommand({
  name: "schedule.acceptDailyPreferences",
  input: acceptDailyPreferencesInput,
  async handler(uow, raw) {
    const target = readDailyPreferencesInput.parse(raw);
    const schedule = await loadScheduleForAssignmentUpdate(
      uow,
      target.scheduleId,
    );
    uow.authorize("assignment.edit", { departmentId: schedule.departmentId });
    // Established lock order: schedules first, then shared identity/membership locks.
    await lockImportMemberships(uow.tx);
    await requireAuthority(uow.tx, uow, schedule, uow.now);
    if (schedule.revision !== raw.expectedRevision) throw new ConflictError();
    const proof = raw.proof;
    if (
      uow.now.getTime() < proof.issuedAt ||
      uow.now.getTime() - proof.issuedAt > 15 * 60 * 1000 ||
      !timingSafeEqual(
        Buffer.from(sign(uow.actor.userId, target, proof), "hex"),
        Buffer.from(proof.signature, "hex"),
      )
    )
      throw stale();
    const { input, ruleSet } = await loadContext(
      uow.tx,
      schedule,
      target.date,
      uow.holidays,
    );
    if (fingerprint(schedule, input) !== proof.fingerprint) throw stale();
    const operation = raw.operation;
    const excluded = new Set(
      operation.kind === "BULK" ? operation.excludedNurseIds : [],
    );
    const plan = planDailyPreferences({ ...input, excludedNurseIds: excluded });
    const rows = [
      ...plan.groups.flatMap((g) => g.suggestions),
      ...plan.offPreferences,
    ];
    let proposed: readonly Assignment[];
    let selectedRows: readonly DailyPreferenceSuggestion[];
    if (operation.kind === "ONE") {
      const row = rows.find((r) => r.nurseId === operation.nurseId);
      if (!row)
        throw new ValidationError(
          "No current preference for this nurse",
          "nurseId",
          "NO_PREFERENCE",
        );
      if (row.assessment?.blocked)
        throw new RuleViolationError(row.assessment.blocking);
      if (row.status !== "ELIGIBLE" && row.status !== "ALREADY_ASSIGNED")
        throw new ValidationError(
          "This preference cannot be accepted directly",
          "nurseId",
          row.reason!,
        );
      proposed =
        row.status === "ELIGIBLE" && isWorkingShift(row.preference)
          ? [{ nurseId: row.nurseId, date: target.date, shift: row.preference }]
          : [];
      selectedRows = [row];
    } else {
      if (plan.assessment.blocked)
        throw new RuleViolationError(plan.assessment.blocking);
      proposed = plan.proposed;
      selectedRows = rows;
    }
    // Assess the exact intended batch again (ONE may deliberately choose from
    // a contended group); never inherit the permissive manual/monthly save policy.
    const { after, assessment } = assessEdits({
      period: schedule.period,
      assignments: input.assignments,
      edits: proposed,
      adjacentAssignments: input.adjacentAssignments,
      staffingNurseIds: input.roster
        .filter((r) => r.role !== "SECRETARY")
        .map((r) => r.userId),
      staffingRequirements: requirementsUnder(
        ruleSet,
        [target.date],
        input.holidays,
      ),
    });
    if (assessment.blocked) throw new RuleViolationError(assessment.blocking);
    let revision = schedule.revision;
    if (proposed.length) {
      const changes = unwrap(
        planAssignmentEdits({
          edits: proposed,
          current: new Map(
            input.assignments.map((a) => [
              assignmentKey(a.nurseId, a.date),
              a.shift,
            ]),
          ),
          rosterNurseIds: new Set(input.roster.map((r) => r.userId)),
          schedule: {
            status: schedule.status,
            period: schedule.period,
            revisionDates: null,
          },
        }),
      );
      await writeAssignmentChanges(uow, schedule, changes, {
        insertOnly: true,
        source: "PREFILL",
      });
      revision = (await saveSchedule(uow, schedule, {})).revision;
      await uow.audit({
        action: "schedule.dailyPreferencesAccepted",
        entityType: "schedule",
        entityId: schedule.id,
        scheduleId: schedule.id,
        departmentId: schedule.departmentId,
        data: {
          date: target.date,
          operation: operation.kind,
          assignmentCount: changes.length,
        },
      });
    }
    const currentPlan = planDailyPreferences({
      ...input,
      assignments: after,
      excludedNurseIds: excluded,
    });
    const created = new Set(proposed.map((a) => a.nurseId));
    const names = new Map(input.roster.map((r) => [r.userId, r.displayName]));
    const outcomes = personnelOrderOf(input.roster)(selectedRows).map(
      (r): DailyPreferenceOutcome => {
        let outcome: DailyPreferenceOutcome["outcome"] = "SKIPPED";
        let reason: DailyPreferenceOutcome["reason"] = r.reason;
        if (created.has(r.nurseId)) {
          outcome = "CREATED";
          reason = null;
        } else if (r.status === "ALREADY_ASSIGNED")
          outcome = "ALREADY_ASSIGNED";
        else if (r.status === "INFORMATIONAL") outcome = "INFORMATIONAL";
        else if (reason === null)
          reason = excluded.has(r.nurseId)
            ? "SESSION_EXCLUDED"
            : (plan.skippedGroups.find((s) => s.shift === r.preference)
                ?.reason ?? null);
        return {
          nurseId: r.nurseId,
          displayName: names.get(r.nurseId) ?? null,
          preference: r.preference,
          previousAssignment: r.currentAssignment,
          outcome,
          reason,
          violations: r.assessment?.blocking ?? [],
        };
      },
    );
    return {
      scheduleId: schedule.id,
      date: target.date,
      revision,
      createdAssignmentCount: proposed.length,
      alreadyAssignedCount: outcomes.filter(
        (o) => o.outcome === "ALREADY_ASSIGNED",
      ).length,
      outcomes,
      skippedSuggestions: outcomes.filter(
        (o) => o.outcome === "SKIPPED" || o.outcome === "INFORMATIONAL",
      ),
      skippedGroups: operation.kind === "BULK" ? plan.skippedGroups : [],
      groupsRequiringManualSelection: currentPlan.groups
        .filter((g) => g.manualSelectionRequired)
        .map((g) => g.shift),
      hardRuleConflicts: outcomes
        .filter((o) => o.violations.length > 0)
        .map((o) => ({ nurseId: o.nurseId, violations: o.violations })),
      // Actual post-command coverage, never the next hypothetical bulk plan.
      coverage: currentPlan.coverage.map((c) => ({
        period: c.period,
        source: c.source,
        covered: c.current,
        minimum: c.minimum,
        maximum: c.maximum,
        availableCapacity: c.availableCapacity,
        remainingShortage: c.currentShortage,
      })),
    };
  },
});
export type DailyPreferenceAcceptanceResult = Awaited<
  ReturnType<typeof acceptDailyPreferences>
>;
