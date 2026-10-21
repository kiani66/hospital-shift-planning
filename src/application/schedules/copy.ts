import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import {
  assignmentKey,
  planAssignmentEdits,
} from "../../domain/schedule/assignment-editing";
import { planScheduleCopy } from "../../domain/schedule/copy";
import { addDays, isIsoDate, type IsoDate } from "../../domain/shared/dates";
import {
  RuleViolationError,
  ValidationError,
} from "../../domain/shared/errors";
import { periodDays } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import type { DbExecutor } from "../../infrastructure/db/database";
import {
  listAdjacentAssignments,
  listAssignments,
  listRosterAssignments,
} from "../../infrastructure/repositories/assignments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { listPreferences } from "../../infrastructure/repositories/preferences";
import { findOpenRevision } from "../../infrastructure/repositories/revisions";
import { sortPeople } from "../../infrastructure/repositories/personnel-order";
import { listRoster } from "../../infrastructure/repositories/roster";
import {
  listImportPeriodMembers,
  lockImportMemberships,
} from "../../infrastructure/repositories/schedule-import";
import {
  findScheduleById,
  lockScheduleForAssignmentUpdate,
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
import { saveSchedule } from "./load-for-update";

const day = z
  .string()
  .refine(isIsoDate)
  .transform((v) => v as IsoDate);
export const scheduleCopyInput = z.object({
  sourceScheduleId: z.uuid(),
  targetScheduleId: z.uuid(),
  scope: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("MONTH") }),
    z.object({ mode: z.literal("DAY"), sourceDate: day, targetDate: day }),
    z.object({
      mode: z.literal("RANGE"),
      sourceStart: day,
      sourceEnd: day,
      targetStart: day,
    }),
  ]),
  selection: z
    .object({
      nurseIds: z.array(z.uuid()).min(1).max(500).optional(),
      sourceCells: z
        .array(z.object({ nurseId: z.uuid(), date: day }))
        .min(1)
        .max(31000)
        .optional(),
    })
    .default({}),
});
export type ScheduleCopyInput = z.output<typeof scheduleCopyInput>;
const proofSchema = z.object({
  issuedAt: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export const applyScheduleCopyInput = scheduleCopyInput.extend({
  proof: proofSchema,
  confirm: z.literal(true),
});
type Proof = z.output<typeof proofSchema>;

const stale = () =>
  new ConflictError(
    "پیش‌نمایش تغییر کرده یا منقضی شده است؛ دوباره بررسی کنید.",
    "SCHEDULE_COPY_STALE",
  );
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function sign(
  actorId: string,
  input: ScheduleCopyInput,
  proof: Omit<Proof, "signature">,
) {
  const key = process.env.AUTH_SECRET;
  if (!key)
    throw new Error("AUTH_SECRET is required to sign schedule copy previews");
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        "schedule-copy-v1",
        actorId,
        input,
        proof.issuedAt,
        proof.fingerprint,
      ]),
    )
    .digest("hex");
}

/** Re-read authority, including during apply, rather than trusting caller-held claims. */
async function requireAuthority(
  db: DbExecutor,
  ctx: Pick<AppContext, "actor">,
  input: ScheduleCopyInput,
  now: Date,
) {
  const target = await findScheduleById(db, input.targetScheduleId);
  if (!target) throw new NotFoundError("Schedule");
  unwrap(
    authorize(ctx.actor, "assignment.edit", {
      departmentId: target.departmentId,
    }),
  );
  const actor = await loadActor(
    db,
    ctx.actor.userId,
    todayIn(APP_TIMEZONE, now),
  );
  unwrap(
    authorize(actor ?? { ...ctx.actor, isActive: false }, "assignment.edit", {
      departmentId: target.departmentId,
    }),
  );
  const source =
    input.sourceScheduleId === target.id
      ? target
      : await findScheduleById(db, input.sourceScheduleId);
  if (!source) throw new NotFoundError("Schedule");
  unwrap(
    authorize(actor!, "schedule.viewDepartment", {
      departmentId: source.departmentId,
      status: source.status,
    }),
  );
  if (source.departmentId !== target.departmentId)
    throw new ValidationError(
      "Copy requires the same department",
      "sourceScheduleId",
      "CROSS_DEPARTMENT_COPY",
    );
  return { source, target };
}

async function buildPlan(
  db: DbExecutor,
  ctx: Pick<AppContext, "actor">,
  input: ScheduleCopyInput,
  now: Date,
  holidays: HolidayCalendar,
) {
  const { source, target } = await requireAuthority(db, ctx, input, now);
  const sourceAssignments = await listAssignments(db, source.id);
  const { assignments, roster } = await listRosterAssignments(db, target.id);
  const members = await listImportPeriodMembers(
    db,
    target.departmentId,
    target.period,
  );
  const preferences = await listPreferences(db, target.id);
  const revision = await findOpenRevision(db, target.id);
  const ruleSet = await loadRuleSet(db, target.staffingRuleSetVersionId);
  const requirements = requirementsUnder(
    ruleSet,
    periodDays(target.period),
    await holidayDates(holidays, target.period),
  );
  // Includes roster members with no target assignments yet (cross-month N→work).
  const adjacent = await listAdjacentAssignments(db, {
    departmentId: target.departmentId,
    excludeScheduleId: target.id,
    nurseIds: roster.map((r) => r.userId),
    dates: [addDays(target.period.start, -1), addDays(target.period.end, 1)],
  });
  const eligibleCells = new Set<string>();
  for (const m of members)
    if (m.isActive)
      for (const date of periodDays(target.period))
        if (m.startedOn <= date && (!m.endedOn || m.endedOn >= date))
          eligibleCells.add(assignmentKey(m.userId, date));
  const targetContext = {
    ...target,
    assignments,
    revisionDates: revision ? new Set(revision.dates) : null,
  };
  const plan = planScheduleCopy({
    scope: input.scope,
    selection: input.selection,
    source: { ...source, assignments: sourceAssignments },
    target: targetContext,
    rosterNurseIds: new Set(roster.map((r) => r.userId)),
    eligibleCells,
    preferences: new Map(
      preferences.map((p) => [assignmentKey(p.userId, p.date), p.value]),
    ),
    adjacentAssignments: adjacent,
    staffingNurseIds: roster
      .filter((r) => r.role !== "SECRETARY")
      .map((r) => r.userId),
    staffingRequirements: requirements,
  });
  // Fingerprint all inputs to the decision, not just proposed rows. Preferences,
  // membership eligibility, boundary shifts and holidays can change independently.
  const fingerprint = digest({
    input,
    source,
    target,
    sourceAssignments,
    assignments,
    roster,
    members,
    preferences,
    revision,
    adjacent,
    requirements: [...requirements],
    plan,
  });
  return { plan, fingerprint, source, target, targetContext, roster };
}

/** A consistent read-only transaction: no rows, audits or preview tables are written. */
export async function previewScheduleCopy(ctx: AppContext, raw: unknown) {
  const input = scheduleCopyInput.parse(raw);
  const now = ctx.clock?.() ?? new Date();
  return ctx.db.transaction(
    async (tx) => {
      const result = await buildPlan(
        tx,
        ctx,
        input,
        now,
        ctx.holidays ?? NO_HOLIDAY_DATA,
      );
      const proof = {
        issuedAt: now.getTime(),
        fingerprint: result.fingerprint,
      };
      return {
        ...result.plan,
        // In personnel-number order; the panel lists each day's rows by it.
        nurses: sortPeople(
          [
            ...new Map(
              [
                ...(await listRoster(tx, input.sourceScheduleId)),
                ...result.roster,
              ].map((nurse) => [nurse.userId, nurse]),
            ).values(),
          ],
          (nurse) => nurse.userId,
        ),
        sourceLabel: result.source.label,
        targetLabel: result.target.label,
        payload: {
          ...input,
          proof: { ...proof, signature: sign(ctx.actor.userId, input, proof) },
          confirm: true as const,
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type ScheduleCopyPreview = Awaited<
  ReturnType<typeof previewScheduleCopy>
>;

/** Revalidate the exact reviewed plan under locks and persist it atomically. */
export const applyScheduleCopy = defineCommand({
  name: "schedule.copied",
  input: applyScheduleCopyInput,
  async handler(uow, raw) {
    const input = scheduleCopyInput.parse(raw);
    // Target + boundary schedules + source in ONE global UUID order; no
    // source lock after a target lock (opposite-direction copies cannot deadlock).
    const target = await lockScheduleForAssignmentUpdate(
      uow.tx,
      input.targetScheduleId,
      [input.sourceScheduleId],
    );
    if (!target) throw new NotFoundError("Schedule");
    uow.authorize("assignment.edit", { departmentId: target.departmentId });
    // Reuse import's short shared account/membership/department locks: authority
    // and eligibility remain valid through commit, including future memberships.
    await lockImportMemberships(uow.tx);
    await requireAuthority(uow.tx, uow, input, uow.now);
    const proof = raw.proof;
    const expected = sign(uow.actor.userId, input, proof);
    if (
      uow.now.getTime() < proof.issuedAt ||
      uow.now.getTime() - proof.issuedAt > 15 * 60 * 1000 ||
      !timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(proof.signature, "hex"),
      )
    )
      throw stale();
    const result = await buildPlan(uow.tx, uow, input, uow.now, uow.holidays);
    if (proof.fingerprint !== result.fingerprint) throw stale();
    if (result.plan.blockingViolations.length)
      throw new RuleViolationError(result.plan.blockingViolations);
    if (!result.plan.canApply)
      throw new ValidationError(
        "No applicable assignments",
        "scope",
        "NOTHING_TO_COPY",
      );
    // Final reuse of the ordinary editor's roster/state/revision invariants.
    const changes = unwrap(
      planAssignmentEdits({
        edits: result.plan.proposed,
        current: new Map(
          result.targetContext.assignments.map((a) => [
            assignmentKey(a.nurseId, a.date),
            a.shift,
          ]),
        ),
        rosterNurseIds: new Set(result.roster.map((r) => r.userId)),
        schedule: result.targetContext,
      }),
    );
    await writeAssignmentChanges(uow, result.target, changes, {
      insertOnly: true,
    });
    const saved = await saveSchedule(uow, result.target, {});
    await uow.audit({
      action: "schedule.copied",
      entityType: "schedule",
      entityId: saved.id,
      departmentId: saved.departmentId,
      scheduleId: saved.id,
      data: {
        sourceScheduleId: input.sourceScheduleId,
        targetScheduleId: saved.id,
        scope: input.scope,
        selection: input.selection,
        targetDates: result.plan.targetDates,
        assignmentCount: changes.length,
        excludedCount: result.plan.rows.length - changes.length,
        fingerprint: proof.fingerprint,
      },
    });
    return {
      scheduleId: saved.id,
      revision: saved.revision,
      assignmentCount: changes.length,
      excludedCount: result.plan.skippedCount + result.plan.conflictCount,
      correctableViolations: result.plan.correctableViolations,
    };
  },
});

/** Source selector details, using the same department and read permissions as preview. */
export async function getScheduleCopySource(ctx: AppContext, raw: unknown) {
  const input = scheduleCopyInput.parse(raw);
  await requireAuthority(ctx.db, ctx, input, ctx.clock?.() ?? new Date());
  return listRoster(ctx.db, input.sourceScheduleId);
}
