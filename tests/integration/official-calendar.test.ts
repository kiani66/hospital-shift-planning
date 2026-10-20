import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  initializeOfficialCalendar,
  importOfficialCalendar,
  confirmOfficialCalendar,
} from "../../src/application/calendar/commands";
import {
  getOfficialCalendarYear,
  getOfficialCalendarVersion,
} from "../../src/application/calendar/queries";
import { previewFullReset } from "../../src/application/reset/preview";
import { executeFullReset } from "../../src/application/reset/execute";
import type { ActionResult } from "../../src/application/result";
import { FULL_OPERATIONAL_CATEGORIES } from "../../src/domain/reset/categories";
import { isoDate } from "../../src/domain/shared/dates";
import {
  calendarHorizon,
  calendarYearPeriod,
} from "../../src/infrastructure/calendar/base";
import { APP_TIMEZONE, todayIn } from "../../src/infrastructure/auth/actor";
import { seedDemoData } from "../../src/infrastructure/db/seed/seed";
import {
  users,
  schedules,
  auditEvents,
  officialCalendarYears,
  officialCalendarVersions,
  officialCalendarVersionDays,
  officialCalendarAuditEvents,
} from "../../src/infrastructure/db/schema";
import { DEMO_USERS as U } from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  PROTECTED_CALENDAR_TABLES,
  RESET_TABLES,
  resetSchemaBlockers,
} from "../../src/infrastructure/repositories/reset-inventory";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const now = new Date("2026-10-20T10:00:00Z");
let year = 1320;
beforeEach(async () => {
  // Protected history intentionally survives setupTestDatabase's demo seeding. Give each test a distinct lineage.
  year++;
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.icuHead.id));
});
const context = async (id: string = U.icuHead.id) => ({
  db,
  actor: (await loadActor(db, id, isoDate("2026-10-20")))!,
  clock: () => now,
});
function success<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
}
const fixture = (calendarYear: number, active: string | null = null) => ({
  year: calendarYear,
  expectedActiveVersionId: active,
  completeness: "COMPLETE",
  reason: "Synthetic integration fixture",
  source: {
    publisher: "Synthetic fixture publisher",
    title: "Test publication",
    url: "https://calendar.example.invalid/test",
    documentSha256: "a".repeat(64),
    retrievedOn: "2026-10-20",
    verificationNote: "Synthetic test evidence only",
    verified: true,
  },
  holidays: [
    {
      date: calendarYearPeriod(calendarYear).start,
      names: ["Synthetic fixture event"],
      provisional: false,
    },
  ],
});
async function imported(calendarYear = year, active: string | null = null) {
  return success(
    await importOfficialCalendar(
      await context(),
      fixture(calendarYear, active),
    ),
  );
}
async function confirmed(calendarYear = year) {
  const version = await imported(calendarYear);
  success(
    await confirmOfficialCalendar(await context(), {
      versionId: version.versionId,
      expectedActiveVersionId: null,
    }),
  );
  return version;
}
async function snapshot(calendarYear = year) {
  const ctx = await context();
  const lineage = (await getOfficialCalendarYear(ctx, calendarYear))!;
  return {
    lineage,
    versions: await Promise.all(
      lineage.versions.map((v) => getOfficialCalendarVersion(ctx, v.id)),
    ),
  };
}

describe("protected official calendar infrastructure", () => {
  it("creates a missing year with every ISO day and no invented official holidays", async () => {
    const ctx = await context();
    expect(await getOfficialCalendarYear(ctx, year)).toBeNull();
    success(await initializeOfficialCalendar(ctx, { year }));
    const data = await snapshot();
    expect(data.lineage).toMatchObject({
      confirmationStatus: "UNCONFIRMED",
      activeVersionId: null,
    });
    expect(data.versions).toHaveLength(1);
    const base = data.versions[0]!;
    expect(base).toMatchObject({
      versionNo: 1,
      origin: "GENERATED",
      completeness: "UNKNOWN",
      source: null,
      confirmedAt: null,
      confirmedBy: null,
    });
    expect(base.days.length).toBeGreaterThanOrEqual(365);
    expect(
      base.days.every(
        (d) => d.officialStatus === "UNKNOWN" && d.holidayNames.length === 0,
      ),
    ).toBe(true);
    expect(base.audit.map((a) => a.action)).toEqual(["GENERATED"]);
    expect(
      await confirmOfficialCalendar(ctx, {
        versionId: base.id,
        expectedActiveVersionId: null,
      }),
    ).toMatchObject({ ok: false, error: { reason: "CALENDAR_INCOMPLETE" } });
  });

  it("derives the ten-year horizon from the injected runtime Tehran date and initializes additively", async () => {
    const ctx = await context();
    const expected = calendarHorizon(todayIn(APP_TIMEZONE, now));
    expect(success(await initializeOfficialCalendar(ctx, {})).years).toEqual(
      expected,
    );
    const before = await Promise.all(expected.map((y) => snapshot(y)));
    success(await initializeOfficialCalendar(ctx, {}));
    expect(await Promise.all(expected.map((y) => snapshot(y)))).toEqual(before);
  });

  it("initialization never overwrites confirmed versions, replacements or audits", async () => {
    const active = await confirmed();
    await imported(year, active.versionId);
    const before = await snapshot();
    for (let i = 0; i < 3; i++)
      success(await initializeOfficialCalendar(await context(), { year }));
    expect(await snapshot()).toEqual(before);
  });

  it("keeps the prior confirmed version active until a replacement is explicitly confirmed", async () => {
    const first = await confirmed();
    const original = await getOfficialCalendarVersion(
      await context(),
      first.versionId,
    );
    const replacement = success(
      await importOfficialCalendar(await context(), {
        ...fixture(year, first.versionId),
        holidays: [],
        reason: "Corrected synthetic fixture",
      }),
    );
    expect(
      (await getOfficialCalendarYear(await context(), year))!.activeVersionId,
    ).toBe(first.versionId);
    success(
      await confirmOfficialCalendar(await context(), {
        versionId: replacement.versionId,
        expectedActiveVersionId: first.versionId,
      }),
    );
    const after = await snapshot();
    expect(after.lineage.activeVersionId).toBe(replacement.versionId);
    expect(after.lineage.confirmationStatus).toBe("CONFIRMED");
    expect(after.versions).toHaveLength(3);
    expect(
      await getOfficialCalendarVersion(await context(), first.versionId),
    ).toEqual(original);
    expect(after.versions[0]).toMatchObject({
      basedOnVersionId: first.versionId,
      confirmedAt: now,
      confirmedBy: { kind: "USER", userId: U.icuHead.id },
    });
    expect(
      after.versions[0]!.days.every((d) => d.officialStatus === "NONE"),
    ).toBe(true);
    expect(
      await confirmOfficialCalendar(await context(), {
        versionId: first.versionId,
        expectedActiveVersionId: replacement.versionId,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } });
  });

  it("preserves provisional lunar entries without permitting confirmation", async () => {
    const draft = success(
      await importOfficialCalendar(await context(), {
        ...fixture(year),
        completeness: "PARTIAL",
        source: { ...fixture(year).source, verified: false },
        holidays: [{ ...fixture(year).holidays[0]!, provisional: true }],
      }),
    );
    const stored = await getOfficialCalendarVersion(
      await context(),
      draft.versionId,
    );
    expect(stored.days[0]!.officialStatus).toBe("PROVISIONAL");
    expect(stored.days[1]!.officialStatus).toBe("UNKNOWN");
    expect(
      await confirmOfficialCalendar(await context(), {
        versionId: draft.versionId,
        expectedActiveVersionId: null,
      }),
    ).toMatchObject({ ok: false, error: { reason: "CALENDAR_INCOMPLETE" } });
    expect(
      (await getOfficialCalendarYear(await context(), year))!.activeVersionId,
    ).toBeNull();
  });

  it("rejects malformed input, invalid sources and dates outside the selected year without writes", async () => {
    for (const bad of [
      { ...fixture(year), year: 1299 },
      { ...fixture(year), reason: "" },
      {
        ...fixture(year),
        source: { ...fixture(year).source, url: "not a URL" },
      },
      {
        ...fixture(year),
        source: { ...fixture(year).source, verified: false },
      },
      {
        ...fixture(year),
        source: { ...fixture(year).source, documentSha256: "invalid" },
      },
      {
        ...fixture(year),
        source: {
          ...fixture(year).source,
          url: "http://calendar.example.invalid",
        },
      },
      {
        ...fixture(year),
        holidays: [{ ...fixture(year).holidays[0]!, date: "2026-02-30" }],
      },
      {
        ...fixture(year),
        holidays: [{ ...fixture(year).holidays[0]!, date: "2026-10-20" }],
      },
      {
        ...fixture(year),
        holidays: [...fixture(year).holidays, ...fixture(year).holidays],
      },
    ])
      expect(await importOfficialCalendar(await context(), bad)).toMatchObject({
        ok: false,
        error: { code: "VALIDATION" },
      });
    expect(await getOfficialCalendarYear(await context(), year)).toBeNull();
  });

  it("requires active system admin authority for writes and history reads", async () => {
    const version = await confirmed();
    for (const id of [U.icuNurse1.id, U.erHead.id, U.supervisor.id]) {
      const ctx = await context(id);
      expect(await initializeOfficialCalendar(ctx, { year })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(
        await importOfficialCalendar(ctx, fixture(year, version.versionId)),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(
        await confirmOfficialCalendar(ctx, {
          versionId: version.versionId,
          expectedActiveVersionId: version.versionId,
        }),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      await expect(getOfficialCalendarYear(ctx, year)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        getOfficialCalendarVersion(ctx, version.versionId),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const admin = await context();
    expect(
      await initializeOfficialCalendar(
        { ...admin, actor: { ...admin.actor, isActive: false } },
        { year },
      ),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("serializes concurrent missing-year initialization without duplicates", async () => {
    const ctx = await context();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        initializeOfficialCalendar(ctx, { year }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    const data = await snapshot();
    expect(data.lineage.versions).toHaveLength(1);
    expect(data.lineage.audit).toHaveLength(1);
  });

  it("rechecks administrator authority after an account is revoked", async () => {
    const staleContext = await context();
    await db
      .update(users)
      .set({ isHospitalAdmin: false })
      .where(eq(users.id, U.icuHead.id));
    expect(
      await initializeOfficialCalendar(staleContext, { year }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await importOfficialCalendar(staleContext, fixture(year)),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("serializes competing confirmations and rejects stale replacements and imports", async () => {
    const a = await imported(),
      b = await imported();
    const ctx = await context();
    const results = await Promise.all(
      [a, b].map((v) =>
        confirmOfficialCalendar(ctx, {
          versionId: v.versionId,
          expectedActiveVersionId: null,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([
      { error: { reason: "CALENDAR_ACTIVE_CHANGED" } },
    ]);
    const active = (await getOfficialCalendarYear(ctx, year))!.activeVersionId;
    expect([a.versionId, b.versionId]).toContain(active);
    const before = await snapshot();
    expect(await importOfficialCalendar(ctx, fixture(year))).toMatchObject({
      ok: false,
      error: { reason: "CALENDAR_ACTIVE_CHANGED" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back confirmation metadata, active switching and audit together on failure", async () => {
    const first = await confirmed();
    const replacement = await imported(year, first.versionId);
    const before = await snapshot();
    // Reject the final audit INSERT after both metadata writes to exercise rollback.
    await db.execute(
      sql`create function calendar_test_reject_confirmation() returns trigger language plpgsql as $$ begin if new.action = 'CONFIRMED' then raise exception 'synthetic audit failure'; end if; return new; end $$`,
    );
    await db.execute(
      sql`create trigger calendar_test_audit_failure before insert on official_calendar_audit_events for each row execute function calendar_test_reject_confirmation()`,
    );
    try {
      expect(
        await confirmOfficialCalendar(await context(), {
          versionId: replacement.versionId,
          expectedActiveVersionId: first.versionId,
        }),
      ).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.execute(
        sql`drop trigger calendar_test_audit_failure on official_calendar_audit_events`,
      );
      await db.execute(sql`drop function calendar_test_reject_confirmation()`);
    }
  });

  it("preserves complete history and audit evidence across repeated demo seeding", async () => {
    const first = await confirmed();
    await imported(year, first.versionId);
    const before = await snapshot();
    for (let i = 0; i < 2; i++) {
      await seedDemoData(db);
      await db
        .update(users)
        .set({ isHospitalAdmin: true })
        .where(eq(users.id, U.icuHead.id));
      expect(await snapshot()).toEqual(before);
      expect(await db.select().from(schedules)).toHaveLength(1);
      expect(await db.select().from(auditEvents)).toHaveLength(0);
    }
  });

  it("keeps actor snapshots after direct account deletion without a user FK", async () => {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      displayName: "Historical fixture administrator",
      personnelNumber: "990099",
      isHospitalAdmin: true,
    });
    const ctx = await context(id);
    const v = success(await importOfficialCalendar(ctx, fixture(year)));
    success(
      await confirmOfficialCalendar(ctx, {
        versionId: v.versionId,
        expectedActiveVersionId: null,
      }),
    );
    const before = await snapshot();
    await db.delete(users).where(eq(users.id, id));
    expect(await snapshot()).toEqual(before);
    expect(before.versions[0]).toMatchObject({
      createdBy: {
        userId: id,
        displayName: "Historical fixture administrator",
        personnelNumber: "990099",
      },
      confirmedBy: { userId: id },
    });
    expect(
      before.lineage.audit.some(
        (a) => a.actor.kind === "USER" && a.actor.userId === id,
      ),
    ).toBe(true);
  });

  it("Full Reset preserves reference history and removes its author account when otherwise eligible", async () => {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      displayName: "Resettable calendar author",
      personnelNumber: "990098",
      isHospitalAdmin: true,
    });
    const ctx = await context(id);
    const first = success(await importOfficialCalendar(ctx, fixture(year)));
    success(
      await confirmOfficialCalendar(ctx, {
        versionId: first.versionId,
        expectedActiveVersionId: null,
      }),
    );
    success(await importOfficialCalendar(ctx, fixture(year, first.versionId)));
    const before = await snapshot();
    const admin = await context();
    const preview = await previewFullReset(admin, {
      scope: { kind: "APPLICATION" },
      categories: FULL_OPERATIONAL_CATEGORIES,
    });
    expect(preview.plan.blockers).toEqual([]);
    expect(preview.plan.preservedUserIds).not.toContain(id);
    expect(
      await executeFullReset(admin, { ...preview, confirmed: true }),
    ).toMatchObject({ ok: true });
    expect(await snapshot()).toEqual(before);
    expect(await db.select().from(users).where(eq(users.id, id))).toEqual([]);
    expect(await db.select().from(users)).toHaveLength(1);
    expect(await db.select().from(schedules)).toEqual([]);
    expect(await db.select().from(auditEvents)).toEqual([]);
  });

  it("registers protected relationships without adding any reset deletion category", async () => {
    expect(PROTECTED_CALENDAR_TABLES.map((t) => t.name).sort()).toEqual([
      "official_calendar_audit_events",
      "official_calendar_version_days",
      "official_calendar_versions",
      "official_calendar_years",
    ]);
    expect(
      PROTECTED_CALENDAR_TABLES.every((t) =>
        t.foreignKeys.every((f) => f.target.startsWith("official_calendar_")),
      ),
    ).toBe(true);
    expect(
      RESET_TABLES.some((t) => t.name.startsWith("official_calendar_")),
    ).toBe(false);
    expect(await resetSchemaBlockers(db)).toEqual([]);
  });

  it("fails closed on a new calendar-to-user FK before demo seed or Full Reset can delete history", async () => {
    await confirmed();
    const before = await snapshot();
    await db.execute(
      sql`alter table official_calendar_versions add column unsafe_user_id uuid references users(id) on delete cascade`,
    );
    try {
      expect(await resetSchemaBlockers(db)).toContain(
        "UNSUPPORTED_FOREIGN_KEY:official_calendar_versions→users",
      );
      const preview = await previewFullReset(await context(), {
        scope: { kind: "APPLICATION" },
        categories: FULL_OPERATIONAL_CATEGORIES,
      });
      expect(preview.plan.permitted).toBe(false);
      await expect(seedDemoData(db)).rejects.toThrow(
        "Unsafe reset dependencies",
      );
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.execute(
        sql`alter table official_calendar_versions drop column unsafe_user_id`,
      );
    }
  });

  it("keeps the existing guard for unknown operational dependents", async () => {
    await db.execute(
      sql`create table calendar_unknown_dependency (id uuid primary key, user_id uuid references users(id))`,
    );
    try {
      expect(await resetSchemaBlockers(db)).toContain(
        "UNSUPPORTED_FOREIGN_KEY:calendar_unknown_dependency→users",
      );
    } finally {
      await db.execute(sql`drop table calendar_unknown_dependency`);
    }
  });

  it("rejects cascading drift on an otherwise registered protected relationship", async () => {
    await db.execute(
      sql`alter table official_calendar_versions drop constraint official_calendar_versions_year_official_calendar_years_year_fk`,
    );
    try {
      await db.execute(
        sql`alter table official_calendar_versions add constraint official_calendar_versions_year_official_calendar_years_year_fk foreign key (year) references official_calendar_years(year) on delete cascade`,
      );
      expect(await resetSchemaBlockers(db)).toContain(
        "UNSUPPORTED_FOREIGN_KEY:official_calendar_versions→official_calendar_years",
      );
      await expect(seedDemoData(db)).rejects.toThrow(
        "Unsafe reset dependencies",
      );
    } finally {
      await db.execute(
        sql`alter table official_calendar_versions drop constraint if exists official_calendar_versions_year_official_calendar_years_year_fk`,
      );
      await db.execute(
        sql`alter table official_calendar_versions add constraint official_calendar_versions_year_official_calendar_years_year_fk foreign key (year) references official_calendar_years(year)`,
      );
    }
  });

  it("rejects active pointers to another year at the database boundary", async () => {
    const first = await confirmed();
    const otherYear = year + 100;
    success(
      await initializeOfficialCalendar(await context(), { year: otherYear }),
    );
    await expect(
      db
        .update(officialCalendarYears)
        .set({
          activeVersionId: first.versionId,
          confirmationStatus: "CONFIRMED",
        })
        .where(eq(officialCalendarYears.year, otherYear)),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(officialCalendarVersions)
        .where(eq(officialCalendarVersions.id, first.versionId)),
    ).toHaveLength(1);
    expect(
      (
        await db
          .select()
          .from(officialCalendarVersionDays)
          .where(eq(officialCalendarVersionDays.versionId, first.versionId))
      ).length,
    ).toBeGreaterThanOrEqual(365);
    expect(
      await db
        .select()
        .from(officialCalendarAuditEvents)
        .where(eq(officialCalendarAuditEvents.versionId, first.versionId)),
    ).toHaveLength(2);
  });
});
