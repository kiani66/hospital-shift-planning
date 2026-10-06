import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";

import { createSchedule } from "../../src/application/schedules/create-schedule";
import {
  createRuleSetDraft,
  discardRuleSetDraft,
  publishRuleSetVersion,
  retireRuleSetVersion,
  RULE_SET_DRAFT_EXISTS,
  RULE_SET_PUBLISH_CONFLICT,
  ruleSetContentInput,
  updateRuleSetDraft,
} from "../../src/application/staffing-rules/commands";
import {
  getRuleSetAdministration,
  previewRuleSetPublication,
} from "../../src/application/staffing-rules/queries";
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
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import {
  findRuleSetVersion,
  loadRuleSetContent,
} from "../../src/infrastructure/repositories/staffing-rules";
import { setupTestDatabase } from "./support/database";

/**
 * Hospital Admin rule-set management (D105, D108, D110): drafts, immutable
 * publications, conflicting scheduled versions, withdrawal, and that no
 * schedule pin ever moves as a side effect.
 */

const { db } = setupTestDatabase();
const now = new Date("2026-10-01T08:00:00Z"); // Tehran: 2026-10-01
const today = isoDate("2026-10-01");

const ok = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};
const error = (result: ActionResult<unknown>) => {
  if (result.ok) throw new Error("expected a failure");
  return result.error;
};
const ctx = async (userId: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, userId, today))!,
  clock: () => now,
});

type ContentInput = z.input<typeof ruleSetContentInput>;

const pilot = (overrides: Partial<ContentInput> = {}): ContentInput => ({
  normal: {
    M: { min: 3, max: 6 },
    E: { min: 3, max: 6 },
    N: { min: 3, max: 6 },
  },
  holiday: {},
  exceptions: [],
  ...overrides,
});

let admin: AppContext;
let head: AppContext;
let supervisor: AppContext;

beforeEach(async () => {
  // Test data: the ER Head Nurse's account also holds Hospital Admin authority here.
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.erHead.id));
  admin = await ctx(U.erHead.id);
  head = await ctx(U.icuHead.id);
  supervisor = await ctx(U.supervisor.id);
});

async function draft(departmentId: string | null, basedOnVersionId?: string) {
  return ok(
    await createRuleSetDraft(admin, { departmentId, basedOnVersionId }),
  );
}
async function edit(
  versionId: string,
  content = pilot(),
  note: string | null = null,
) {
  const version = (await findRuleSetVersion(db, versionId))!;
  return updateRuleSetDraft(admin, {
    versionId,
    expectedRevision: version.revision,
    content,
    note,
  });
}
async function publish(
  versionId: string,
  effectiveFrom: string,
  confirmReplaceVersionIds: string[] = [],
) {
  const version = (await findRuleSetVersion(db, versionId))!;
  return publishRuleSetVersion(admin, {
    versionId,
    expectedRevision: version.revision,
    effectiveFrom,
    confirmReplaceVersionIds,
  });
}

describe("drafts", () => {
  it("copies the Hospital Default into a new draft and edits it", async () => {
    const created = await draft(null);
    expect(created.versionNo).toBe(2);
    expect(await loadRuleSetContent(db, created.versionId)).toEqual({
      normal: {
        M: { min: 1, max: null },
        E: { min: 1, max: null },
        N: { min: 1, max: null },
      },
      holiday: {},
      exceptions: [],
    });
    ok(
      await edit(created.versionId, {
        ...pilot(),
        holiday: { N: { min: 2, max: 4 } },
        exceptions: [
          {
            date: "2026-11-01",
            period: "M",
            bounds: { min: 4, max: 6 },
            note: "x",
          },
        ],
      }),
    );
    expect(await loadRuleSetContent(db, created.versionId)).toEqual({
      normal: pilot().normal,
      holiday: { N: { min: 2, max: 4 } },
      exceptions: [
        {
          date: "2026-11-01",
          period: "M",
          bounds: { min: 4, max: 6 },
          note: "x",
        },
      ],
    });
  });

  it("allows one open draft per scope", async () => {
    await draft(null);
    expect(
      error(await createRuleSetDraft(admin, { departmentId: null })),
    ).toMatchObject({
      code: "CONFLICT",
      reason: RULE_SET_DRAFT_EXISTS,
    });
    // Another scope is independent.
    expect((await draft(DEMO_ICU.id)).versionNo).toBe(1);
  });

  it("rejects invalid bounds and stale edits", async () => {
    const { versionId } = await draft(null);
    expect(
      error(
        await edit(versionId, {
          ...pilot(),
          normal: { ...pilot().normal, N: { min: 5, max: 4 } },
        }),
      ).code,
    ).toBe("VALIDATION");
    const stale = await updateRuleSetDraft(admin, {
      versionId,
      expectedRevision: 99,
      content: pilot(),
      note: null,
    });
    expect(error(stale).code).toBe("CONFLICT");
  });

  it("discards a draft (and only a draft)", async () => {
    const { versionId } = await draft(null);
    ok(await discardRuleSetDraft(admin, { versionId, expectedRevision: 0 }));
    expect(await findRuleSetVersion(db, versionId)).toBeNull();
    expect(
      error(
        await discardRuleSetDraft(admin, {
          versionId: LEGACY_BASELINE_VERSION_ID,
          expectedRevision: 0,
        }),
      ).code,
    ).toBe("INVALID_STATE");
  });
});

describe("publication", () => {
  it("publishes immediately; the version is then immutable", async () => {
    const { versionId } = await draft(null);
    ok(await edit(versionId));
    ok(await publish(versionId, "2026-10-01"));
    const published = (await findRuleSetVersion(db, versionId))!;
    expect(published).toMatchObject({
      status: "PUBLISHED",
      effectiveFrom: "2026-10-01",
      publishedBy: U.erHead.id,
    });
    expect(error(await edit(versionId, pilot({ holiday: {} }))).code).toBe(
      "INVALID_STATE",
    );
    expect(error(await publish(versionId, "2026-12-01")).code).toBe(
      "INVALID_STATE",
    );
    expect(await loadRuleSetContent(db, versionId)).toMatchObject({
      normal: pilot().normal,
    });
  });

  it("never publishes in the past", async () => {
    const { versionId } = await draft(null);
    expect(error(await publish(versionId, "2026-09-30"))).toMatchObject({
      code: "VALIDATION",
      reason: "EFFECTIVE_FROM_IN_PAST",
    });
  });

  it("stops on a conflicting scheduled version and replaces it only when confirmed", async () => {
    const first = await draft(null);
    ok(await publish(first.versionId, "2026-12-22"));
    const second = await draft(null);
    ok(await edit(second.versionId));

    const preview = await previewRuleSetPublication(admin, {
      versionId: second.versionId,
      effectiveFrom: "2026-11-22",
    });
    expect(preview.conflicts).toEqual([
      expect.objectContaining({
        versionId: first.versionId,
        effectiveFrom: "2026-12-22",
        state: "SCHEDULED",
      }),
    ]);
    expect(error(await publish(second.versionId, "2026-11-22"))).toMatchObject({
      code: "CONFLICT",
      reason: RULE_SET_PUBLISH_CONFLICT,
    });
    // A confirmation naming another version is stale: still refused.
    expect(
      error(
        await publish(second.versionId, "2026-11-22", [
          LEGACY_BASELINE_VERSION_ID,
        ]),
      ).code,
    ).toBe("CONFLICT");
    expect((await findRuleSetVersion(db, first.versionId))!.status).toBe(
      "PUBLISHED",
    );

    ok(await publish(second.versionId, "2026-11-22", [first.versionId]));
    expect(await findRuleSetVersion(db, first.versionId)).toMatchObject({
      status: "RETIRED",
      retiredReason: "REPLACED",
      replacedByVersionId: second.versionId,
    });
  });

  it("does not move any schedule pin and audits each step", async () => {
    const before = (await findScheduleById(db, DEMO_SCHEDULE.id))!;
    const { versionId } = await draft(DEMO_ICU.id);
    ok(await edit(versionId));
    ok(await publish(versionId, "2026-10-01"));
    const after = (await findScheduleById(db, DEMO_SCHEDULE.id))!;
    expect(after.staffingRuleSetVersionId).toBe(LEGACY_BASELINE_VERSION_ID);
    expect(after.revision).toBe(before.revision);

    const { rows } = await db.execute<{ action: string; actor_id: string }>(
      sql`select action, actor_id from audit_events where entity_type = 'staffing_rule_set_version' and entity_id = ${versionId} order by id`,
    );
    expect(rows.map((r) => r.action)).toEqual([
      "staffingRuleSet.draftCreated",
      "staffingRuleSet.draftUpdated",
      "staffingRuleSet.published",
    ]);
    expect(new Set(rows.map((r) => r.actor_id))).toEqual(
      new Set([U.erHead.id]),
    );
    expect(await listAuditEventsForSchedule(db, DEMO_SCHEDULE.id)).toEqual([]);
  });
});

describe("department overrides (D105, D106)", () => {
  it("is a complete snapshot: later Hospital Default versions do not change it", async () => {
    const nicu = await draft(DEMO_ICU.id);
    ok(
      await edit(
        nicu.versionId,
        pilot({
          normal: {
            M: { min: 3, max: 6 },
            E: { min: 3, max: 6 },
            N: { min: 4, max: 6 },
          },
        }),
      ),
    );
    ok(await publish(nicu.versionId, "2026-10-01"));

    const hospital = await draft(null);
    ok(
      await edit(
        hospital.versionId,
        pilot({
          normal: {
            M: { min: 2, max: 9 },
            E: { min: 2, max: 9 },
            N: { min: 2, max: 9 },
          },
        }),
      ),
    );
    ok(await publish(hospital.versionId, "2026-10-01"));

    expect((await loadRuleSetContent(db, nicu.versionId)).normal.N).toEqual({
      min: 4,
      max: 6,
    });
  });

  it("pins new schedules of that department only; others fall back to the Hospital Default", async () => {
    const nicu = await draft(DEMO_ICU.id);
    ok(await edit(nicu.versionId));
    ok(await publish(nicu.versionId, "2026-10-01"));
    const icu = ok(
      await createSchedule(head, {
        departmentId: DEMO_ICU.id,
        periodStart: "2026-12-22",
        periodEnd: "2026-12-23",
        label: "ICU",
      }),
    );
    expect(icu.staffingRuleSetVersionId).toBe(nicu.versionId);
    const er = ok(
      await createSchedule(await ctx(U.erHead.id), {
        departmentId: DEMO_ER.id,
        periodStart: "2026-12-22",
        periodEnd: "2026-12-23",
        label: "ER",
      }),
    );
    expect(er.staffingRuleSetVersionId).toBe(LEGACY_BASELINE_VERSION_ID);
  });
});

describe("withdrawal", () => {
  it("withdraws a department override at any time; its department falls back", async () => {
    const nicu = await draft(DEMO_ICU.id);
    ok(await publish(nicu.versionId, "2026-10-01"));
    ok(await retireRuleSetVersion(admin, { versionId: nicu.versionId }));
    expect(await findRuleSetVersion(db, nicu.versionId)).toMatchObject({
      status: "RETIRED",
      retiredReason: "WITHDRAWN",
    });
  });

  it("withdraws a Hospital Default version only while it is scheduled", async () => {
    expect(
      error(
        await retireRuleSetVersion(admin, {
          versionId: LEGACY_BASELINE_VERSION_ID,
        }),
      ).reason,
    ).toBe("RETIRE_EFFECTIVE_HOSPITAL_DEFAULT");
    const future = await draft(null);
    ok(await publish(future.versionId, "2027-01-01"));
    ok(await retireRuleSetVersion(admin, { versionId: future.versionId }));
  });
});

describe("authorization (D108)", () => {
  it.each(["head", "supervisor"] as const)(
    "a %s cannot create, edit, publish or retire rule sets",
    async (who) => {
      const context = who === "head" ? head : supervisor;
      expect(
        error(await createRuleSetDraft(context, { departmentId: DEMO_ICU.id }))
          .code,
      ).toBe("FORBIDDEN");
      const { versionId } = await draft(DEMO_ICU.id);
      expect(
        error(
          await updateRuleSetDraft(context, {
            versionId,
            expectedRevision: 0,
            content: pilot(),
            note: null,
          }),
        ).code,
      ).toBe("FORBIDDEN");
      expect(
        error(
          await publishRuleSetVersion(context, {
            versionId,
            expectedRevision: 0,
            effectiveFrom: "2026-10-01",
            confirmReplaceVersionIds: [],
          }),
        ).code,
      ).toBe("FORBIDDEN");
      expect(
        error(
          await retireRuleSetVersion(context, {
            versionId: LEGACY_BASELINE_VERSION_ID,
          }),
        ).code,
      ).toBe("FORBIDDEN");
      await expect(getRuleSetAdministration(context)).rejects.toMatchObject({
        name: "ForbiddenError",
      });
    },
  );

  it("shows the admin every scope with derived states and pin counts", async () => {
    const overview = await getRuleSetAdministration(admin);
    expect(overview.scopes[0]).toMatchObject({
      departmentId: null,
      effectiveVersionId: LEGACY_BASELINE_VERSION_ID,
      versions: [
        expect.objectContaining({
          id: LEGACY_BASELINE_VERSION_ID,
          state: "EFFECTIVE",
          legacyBaseline: true,
          pins: expect.objectContaining({ schedules: 1 }),
        }),
      ],
    });
    expect(overview.scopes.map((s) => s.departmentId)).toEqual(
      expect.arrayContaining([DEMO_ICU.id, DEMO_ER.id]),
    );
  });
});
