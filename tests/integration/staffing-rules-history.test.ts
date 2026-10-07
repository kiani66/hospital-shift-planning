import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createRuleSetDraft,
  discardRuleSetDraft,
  publishRuleSetVersion,
} from "../../src/application/staffing-rules/commands";
import { applyRuleSetToSchedule } from "../../src/application/staffing-rules/apply";
import { getDepartmentCoverageRules } from "../../src/application/staffing-rules/department";
import { getRuleSetAdministration } from "../../src/application/staffing-rules/queries";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import {
  LEGACY_BASELINE_VERSION_ID,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { setupTestDatabase } from "./support/database";

/** Read-only rule-set history and who sees what of it (D110, D108). */

const { db } = setupTestDatabase();
const now = new Date("2026-10-01T08:00:00Z");
const today = isoDate("2026-10-01");
const ok = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};
const ctx = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});

let admin: AppContext;
let head: AppContext;
let supervisor: AppContext;
let published: string;

beforeEach(async () => {
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.erHead.id));
  admin = await ctx(U.erHead.id);
  head = await ctx(U.icuHead.id);
  supervisor = await ctx(U.supervisor.id);

  // ICU: a published override, then a draft that is still open.
  published = ok(
    await createRuleSetDraft(admin, { departmentId: DEMO_ICU.id }),
  ).versionId;
  ok(
    await publishRuleSetVersion(admin, {
      versionId: published,
      expectedRevision: 0,
      effectiveFrom: "2026-10-01",
      confirmReplaceVersionIds: [],
    }),
  );
  ok(await createRuleSetDraft(admin, { departmentId: DEMO_ICU.id }));
  // ER: a discarded draft (visible only in the admin's full log).
  const er = ok(await createRuleSetDraft(admin, { departmentId: DEMO_ER.id }));
  ok(
    await discardRuleSetDraft(admin, {
      versionId: er.versionId,
      expectedRevision: 0,
    }),
  );
  // An Apply to the ICU demo schedule.
  const schedule = (await findScheduleById(db, DEMO_SCHEDULE.id))!;
  ok(
    await applyRuleSetToSchedule(supervisor, {
      scheduleId: schedule.id,
      expectedRevision: schedule.revision,
      fromVersionId: LEGACY_BASELINE_VERSION_ID,
      toVersionId: published,
      confirm: true,
    }),
  );
});

describe("department history", () => {
  it("gives the Head Nurse the published history and the Apply, never drafts", async () => {
    const data = await getDepartmentCoverageRules(head, {
      departmentId: DEMO_ICU.id,
    });
    expect(data.history.map((h) => h.kind)).toEqual(["PUBLISHED"]);
    expect(data.versions.some((v) => v.status === "DRAFT")).toBe(false);
    expect(data.applications).toEqual([
      expect.objectContaining({
        scheduleId: DEMO_SCHEDULE.id,
        fromVersionId: LEGACY_BASELINE_VERSION_ID,
        toVersionId: published,
        actorId: U.supervisor.id,
        rollback: false,
      }),
    ]);
    expect(data.names.get(U.supervisor.id)).toBe(U.supervisor.displayName);
  });

  it("gives the Supervisor the full history of the department's rules, drafts included", async () => {
    const data = await getDepartmentCoverageRules(supervisor, {
      departmentId: DEMO_ICU.id,
    });
    expect(data.history.map((h) => h.kind)).toEqual([
      "DRAFT_CREATED",
      "PUBLISHED",
      "DRAFT_CREATED",
    ]);
    // Never another department's events.
    expect(data.history.every((h) => h.departmentId !== DEMO_ER.id)).toBe(true);
  });

  it("does not show one department's Applies on another's page", async () => {
    const er = await getDepartmentCoverageRules(admin, {
      departmentId: DEMO_ER.id,
    });
    expect(er.applications).toEqual([]);
  });
});

describe("administration log", () => {
  it("lists every event, discarded drafts included", async () => {
    const { history } = await getRuleSetAdministration(admin);
    expect(history.map((h) => [h.kind, h.departmentId])).toEqual(
      expect.arrayContaining([
        ["DRAFT_DISCARDED", DEMO_ER.id],
        ["DRAFT_CREATED", DEMO_ER.id],
        ["PUBLISHED", DEMO_ICU.id],
      ]),
    );
  });
});
