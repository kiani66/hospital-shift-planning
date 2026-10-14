import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import { normalizeDisplayName } from "../../domain/identity/normalize";
import { parsePersonnelNumber } from "../../domain/identity/personnel-number";
import { validateSchedule } from "../../domain/rules/validate-schedule";
import { summarizeScheduleDays } from "../../domain/schedule/day-health";
import { addDays, isIsoDate, type IsoDate } from "../../domain/shared/dates";
import { ValidationError } from "../../domain/shared/errors";
import { createPeriod, periodDays } from "../../domain/shared/period";
import { unwrap } from "../../domain/shared/result";
import type { Assignment } from "../../domain/shifts/assignment";
import { ASSIGNMENT_CODES } from "../../domain/shifts/shift-type";
import { selectForSchedule } from "../../domain/staffing-rules/selection";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import type { DbExecutor } from "../../infrastructure/db/database";
import { listAdjacentAssignments } from "../../infrastructure/repositories/assignments";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { readMonthlyPlanningCounts } from "../../infrastructure/repositories/monthly-reset";
import { findAccountsByPersonnelNumbers } from "../../infrastructure/repositories/personnel-import";
import {
  listRoster,
  snapshotRosterFromMemberships,
} from "../../infrastructure/repositories/roster";
import {
  importRoster,
  insertImportedAssignments,
  listImportPeriodMembers,
  lockImportMemberships,
  lockImportSchedules,
} from "../../infrastructure/repositories/schedule-import";
import {
  createSchedule,
  findOverlappingSchedule,
} from "../../infrastructure/repositories/schedules";
import { listApplicableRuleSetVersions } from "../../infrastructure/repositories/staffing-rules";
import { NO_HOLIDAY_DATA, type HolidayCalendar } from "../calendar/holidays";
import { ConflictError, NotFoundError } from "../errors";
import { saveSchedule } from "../schedules/load-for-update";
import {
  auditRosterSummary,
  summarizeRoster,
} from "../schedules/roster-summary";
import {
  holidayDates,
  loadRuleSet,
  requirementsUnder,
} from "../staffing-rules/pinned";
import { defineCommand, type AppContext } from "../use-case";
import { parseScheduleWorkbook, type ParsedWorkbook } from "./workbook";

const day = z
  .string()
  .refine(isIsoDate)
  .transform((v) => v as IsoDate);
export const scheduleImportTarget = z.object({
  departmentId: z.uuid(),
  periodStart: day,
  periodEnd: day,
  label: z.string().trim().min(1).max(60),
});
type ImportTarget = z.output<typeof scheduleImportTarget>;
const rowSchema = z.object({
  line: z.number().int().min(2).max(501),
  personnelNumber: z.string().min(1).max(20),
  displayName: z.string().trim().min(1).max(200),
  days: z.array(z.enum(ASSIGNMENT_CODES)).min(29).max(31),
});
const proofSchema = z.object({
  issuedAt: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export const commitScheduleImportInput = scheduleImportTarget.extend({
  rows: z.array(rowSchema).min(1).max(500),
  proof: proofSchema,
  confirm: z.literal(true),
});

async function requireAuthority(
  db: DbExecutor,
  ctx: Pick<AppContext, "actor">,
  departmentId: string,
  now: Date,
) {
  unwrap(authorize(ctx.actor, "assignment.edit", { departmentId }));
  const current = await loadActor(
    db,
    ctx.actor.userId,
    todayIn(APP_TIMEZONE, now),
  );
  unwrap(
    authorize(current ?? { ...ctx.actor, isActive: false }, "assignment.edit", {
      departmentId,
    }),
  );
  const department = await findDepartmentById(db, departmentId);
  if (!department?.isActive) throw new NotFoundError("Department");
  return department;
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function signature(
  actorId: string,
  target: ImportTarget,
  rows: ParsedWorkbook["rows"],
  issuedAt: number,
  fingerprint: string,
) {
  const key = process.env.AUTH_SECRET;
  if (!key)
    throw new Error("AUTH_SECRET is required to sign monthly import previews");
  return createHmac("sha256", key)
    .update(
      JSON.stringify([
        "monthly-schedule-import-v1",
        actorId,
        target,
        rows,
        issuedAt,
        fingerprint,
      ]),
    )
    .digest("hex");
}
const stale = () =>
  new ConflictError(
    "پیش‌نمایش تغییر کرده یا منقضی شده است؛ فایل را دوباره بررسی کنید.",
    "SCHEDULE_IMPORT_STALE",
  );

async function buildPlan(
  db: DbExecutor,
  target: ImportTarget,
  parsed: ParsedWorkbook,
  holidays: HolidayCalendar,
) {
  const period = unwrap(createPeriod(target.periodStart, target.periodEnd));
  const dates = periodDays(period);
  if (![29, 30, 31].includes(dates.length))
    throw new ValidationError("طول ماه معتبر نیست.", "period");
  const issues = parsed.issues.map((i) => ({
    ...i,
    date: i.day ? dates[i.day - 1] : undefined,
  }));
  const blocking: string[] = [];
  const schedule = await findOverlappingSchedule(
    db,
    target.departmentId,
    period,
  );
  if (schedule) {
    if (
      schedule.period.start !== period.start ||
      schedule.period.end !== period.end
    )
      blocking.push("بخشی از این ماه با برنامه دیگری هم‌پوشانی دارد.");
    const counts = await readMonthlyPlanningCounts(db, schedule.id);
    if (
      (schedule.status !== "DRAFT" && schedule.status !== "PLANNING") ||
      schedule.currentVersionId ||
      counts.protectedHistory ||
      counts.assignments ||
      counts.changes ||
      counts.changeCells
    )
      blocking.push(
        "ورود فقط برای برنامه خالی در وضعیت پیش‌نویس یا برنامه‌ریزی و بدون سابقه ارسال، تأیید یا تغییر مجاز است؛ داده موجود بازنویسی نمی‌شود.",
      );
  }
  const members = await listImportPeriodMembers(
    db,
    target.departmentId,
    period,
  );
  const eligible = importRoster(members);
  const roster = schedule ? await listRoster(db, schedule.id) : eligible;
  if (!roster.length)
    blocking.push("هیچ عضو فعالی در بازه این ماه وجود ندارد.");
  const accounts = await findAccountsByPersonnelNumbers(
    db,
    parsed.rows.map((r) => r.personnelNumber),
  );
  const byNumber = new Map(accounts.map((a) => [a.personnelNumber, a]));
  const seen = new Set<string>();
  const lines = new Set<number>();
  const rows = parsed.rows.map((row) => {
    const errors: string[] = [];
    if (parsed.issues.some((i) => i.row === row.line))
      errors.push("ردیف دارای خطای خانه است؛ جزئیات را بررسی کنید.");
    const number = parsePersonnelNumber(row.personnelNumber);
    if (!number.ok || number.value !== row.personnelNumber)
      errors.push("شماره پرسنلی معتبر نیست.");
    if (seen.has(row.personnelNumber) || lines.has(row.line))
      errors.push("شماره پرسنلی یا ردیف در فایل تکرار شده است.");
    seen.add(row.personnelNumber);
    lines.add(row.line);
    if (row.days.length !== dates.length)
      errors.push("تعداد روزها با ماه انتخاب‌شده برابر نیست.");
    const account = byNumber.get(row.personnelNumber);
    if (!account)
      errors.push(
        "حساب این شماره پرسنلی یافت نشد؛ ابتدا از ورود مجاز پرسنل استفاده کنید.",
      );
    else {
      if (!account.isActive) errors.push("حساب غیرفعال است.");
      if (
        normalizeDisplayName(account.displayName) !==
        normalizeDisplayName(row.displayName)
      )
        errors.push(`نام با حساب موجود مطابقت ندارد: ${account.displayName}`);
      const relations = members.filter((m) => m.userId === account.id);
      if (
        !dates.every((date) =>
          relations.some(
            (m) => m.startedOn <= date && (!m.endedOn || m.endedOn >= date),
          ),
        )
      )
        errors.push(
          "عضویت این بخش برای همه روزهای فایل معتبر نیست؛ تاریخ عضویت باید بررسی شود.",
        );
      const entry = roster.find((r) => r.userId === account.id);
      if (!entry)
        errors.push(
          "این فرد در فهرست پرسنل برنامه نیست؛ ابتدا از افزودن مجاز پرسنل به برنامه استفاده کنید.",
        );
      if (
        entry &&
        relations.some(
          (m) => (m.role === "SECRETARY") !== (entry.role === "SECRETARY"),
        )
      )
        errors.push(
          "نقش پرستاری/منشی در این بازه با تصویر فهرست برنامه سازگار نیست؛ تاریخ نقش را بررسی کنید.",
        );
    }
    return {
      ...row,
      userId: account?.id ?? null,
      role: roster.find((r) => r.userId === account?.id)?.role ?? null,
      errors,
    };
  });
  let ruleSetId = schedule?.staffingRuleSetVersionId;
  if (!ruleSetId) {
    const versions = await listApplicableRuleSetVersions(
      db,
      target.departmentId,
    );
    ruleSetId = unwrap(
      selectForSchedule({
        department: versions.filter(
          (v) => v.departmentId === target.departmentId,
        ),
        hospital: versions.filter((v) => v.departmentId === null),
        periodStart: period.start,
      }),
    ).id;
  }
  const ruleSet = await loadRuleSet(db, ruleSetId);
  const requirements = requirementsUnder(
    ruleSet,
    dates,
    await holidayDates(holidays, period),
  );
  const assignments: Assignment[] = rows.flatMap((r) =>
    r.userId && r.errors.length === 0
      ? dates.map((date, i) => ({
          nurseId: r.userId!,
          date,
          shift: r.days[i]!,
        }))
      : [],
  );
  const adjacent = await listAdjacentAssignments(db, {
    departmentId: target.departmentId,
    excludeScheduleId: schedule?.id ?? "00000000-0000-0000-0000-000000000000",
    nurseIds: roster.map((r) => r.userId),
    dates: [addDays(period.start, -1), addDays(period.end, 1)],
  });
  const staffingNurseIds = roster
    .filter((r) => r.role !== "SECRETARY")
    .map((r) => r.userId);
  const violations = validateSchedule({
    period,
    assignments,
    rosterNurseIds: roster.map((r) => r.userId),
    staffingNurseIds,
    adjacentAssignments: adjacent,
    staffingRequirements: requirements,
  });
  const summary = summarizeScheduleDays({
    period,
    assignments,
    violations,
    staffingNurseIds,
  });
  const counts = Object.fromEntries(
    ASSIGNMENT_CODES.map((code) => [
      code,
      assignments.filter((a) => a.shift === code).length,
    ]),
  ) as Record<(typeof ASSIGNMENT_CODES)[number], number>;
  const committable =
    !blocking.length && !issues.length && rows.every((r) => !r.errors.length);
  const fingerprint = digest({
    target,
    parsed,
    schedule,
    members,
    accounts: accounts.toSorted((a, b) => a.id.localeCompare(b.id)),
    roster,
    requirements: [...requirements],
    adjacent,
    violations,
    blocking,
    rows,
  });
  return {
    period,
    dates,
    schedule,
    roster,
    rows,
    assignments,
    violations,
    blocking,
    issues,
    committable,
    summary,
    counts,
    ruleSetId,
    fingerprint,
  };
}

/** Read-only consistent preview; scheduling findings keep the ordinary planning policy. */
export async function previewScheduleImport(
  ctx: AppContext,
  rawTarget: unknown,
  bytes: Uint8Array,
) {
  const target = scheduleImportTarget.parse(rawTarget);
  const now = ctx.clock?.() ?? new Date();
  // Authorization precedes decompression and identity reads.
  await requireAuthority(ctx.db, ctx, target.departmentId, now);
  const period = unwrap(createPeriod(target.periodStart, target.periodEnd));
  const parsed = await parseScheduleWorkbook(bytes, periodDays(period).length);
  return ctx.db.transaction(
    async (tx) => {
      const department = await requireAuthority(
        tx,
        ctx,
        target.departmentId,
        now,
      );
      const plan = await buildPlan(
        tx,
        target,
        parsed,
        ctx.holidays ?? NO_HOLIDAY_DATA,
      );
      const proof = {
        issuedAt: now.getTime(),
        fingerprint: plan.fingerprint,
        signature: signature(
          ctx.actor.userId,
          target,
          parsed.rows,
          now.getTime(),
          plan.fingerprint,
        ),
      };
      return {
        department: {
          id: department.id,
          code: department.code,
          name: department.name,
        },
        label: target.label,
        dates: plan.dates,
        rows: plan.rows,
        issues: plan.issues,
        blocking: plan.blocking,
        violations: plan.violations,
        committable: plan.committable,
        createsSchedule: !plan.schedule,
        personnel: summarizeRoster(
          plan.rows.flatMap((r) => (r.role ? [{ role: r.role }] : [])),
        ),
        assignments: plan.assignments.length,
        counts: plan.counts,
        coverage: plan.summary.days.map((d) => ({
          date: d.date,
          coverage: d.coverage,
        })),
        payload: {
          ...target,
          rows: parsed.rows,
          proof,
          confirm: true as const,
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type ScheduleImportPreview = Awaited<
  ReturnType<typeof previewScheduleImport>
>;

/** One controlled transaction: no approval, publication, reset, upsert, or implicit transition. */
export const commitScheduleImport = defineCommand({
  name: "schedule.imported",
  input: commitScheduleImportInput,
  async handler(uow, input) {
    const { rows, proof } = input;
    const target = scheduleImportTarget.parse(input);
    uow.authorize("assignment.edit", { departmentId: target.departmentId });
    const expected = signature(
      uow.actor.userId,
      target,
      rows,
      proof.issuedAt,
      proof.fingerprint,
    );
    if (
      uow.now.getTime() < proof.issuedAt ||
      uow.now.getTime() - proof.issuedAt > 15 * 60 * 1000 ||
      !timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(proof.signature, "hex"),
      )
    )
      throw stale();
    const period = unwrap(createPeriod(target.periodStart, target.periodEnd));
    await lockImportSchedules(uow.tx, target.departmentId, period);
    await lockImportMemberships(uow.tx);
    await requireAuthority(uow.tx, uow, target.departmentId, uow.now);
    const plan = await buildPlan(
      uow.tx,
      target,
      { rows, issues: [] },
      uow.holidays,
    );
    if (plan.fingerprint !== proof.fingerprint) throw stale();
    if (!plan.committable)
      throw new ValidationError(
        "پیش‌نمایش خطا دارد؛ هیچ تغییری ثبت نشد.",
        "rows",
        "SCHEDULE_IMPORT_ERRORS",
      );
    let schedule = plan.schedule;
    if (!schedule) {
      schedule = await createSchedule(uow.tx, {
        departmentId: target.departmentId,
        period,
        label: target.label,
        createdBy: uow.actor.userId,
        staffingRuleSetVersionId: plan.ruleSetId,
      });
      await snapshotRosterFromMemberships(uow.tx, {
        scheduleId: schedule.id,
        addedBy: uow.actor.userId,
      });
      await uow.audit({
        action: "schedule.created",
        entityType: "schedule",
        entityId: schedule.id,
        departmentId: schedule.departmentId,
        scheduleId: schedule.id,
        data: {
          periodStart: period.start,
          periodEnd: period.end,
          label: target.label,
          status: schedule.status,
          roster: auditRosterSummary(summarizeRoster(plan.roster)),
          staffingRuleSetVersionId: plan.ruleSetId,
          source: "excel-import",
        },
      });
    }
    await insertImportedAssignments(
      uow.tx,
      schedule.id,
      uow.actor.userId,
      plan.assignments,
    );
    const saved = await saveSchedule(uow, schedule, {});
    await uow.audit({
      action: "schedule.imported",
      entityType: "schedule",
      entityId: schedule.id,
      departmentId: schedule.departmentId,
      scheduleId: schedule.id,
      data: {
        periodStart: period.start,
        periodEnd: period.end,
        personnel: auditRosterSummary(
          summarizeRoster(plan.rows.map((r) => ({ role: r.role! }))),
        ),
        assignments: plan.assignments.length,
        counts: plan.counts,
        fingerprint: proof.fingerprint,
        schedulingFindings: plan.violations.length,
        created: !plan.schedule,
      },
    });
    return {
      scheduleId: saved.id,
      revision: saved.revision,
      assignments: plan.assignments.length,
      status: saved.status,
    };
  },
});
