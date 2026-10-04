import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import { issueInitialTemporaryPasswords } from "../../src/application/management/credentials";
import {
  commitPersonnelImport,
  previewPersonnelImport,
  type ImportPreview,
} from "../../src/application/personnel-import/import";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import { authenticateWithPassword } from "../../src/infrastructure/auth/credentials";
import {
  auditEvents,
  departmentMemberships,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { createUser } from "../../src/infrastructure/repositories/users";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { listRoster } from "../../src/infrastructure/repositories/roster";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const TODAY = isoDate("2026-10-03");
const NOW = new Date("2026-10-03T08:00:00Z");
const START = "2026-10-10";

const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, TODAY))!,
  clock: () => NOW,
});
let admin: AppContext;

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    NOW,
  );
  admin = await as(U.icuHead.id);
});

function data<T>(result: ActionResult<T>): T {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}
const events = () => db.select().from(auditEvents).orderBy(auditEvents.id);
const memberships = () => db.select().from(departmentMemberships);

const CSV =
  "﻿شماره پرسنلی,نام و نام خانوادگی,ایمیل,موبایل\r\n" +
  "۰۰۵۰۱,سارا نیکو,,09121234567\r\n" +
  "00502,مینا راد,mina.rad@demo.invalid,\r\n";

const preview = async (text = CSV, ctx = admin, departmentId = DEMO_ICU.id) =>
  previewPersonnelImport(ctx, { departmentId, startedOn: START, text });

function ready(p: ImportPreview) {
  if (!p.ok) throw new Error(p.fileError);
  return p;
}
const payload = (p: ImportPreview) => {
  const ok = ready(p);
  return {
    departmentId: ok.department.id,
    startedOn: ok.startedOn,
    expectedFingerprint: ok.fingerprint,
    rows: ok.plan.rows.map((r) => ({ line: r.line, ...r.person! })),
  };
};

describe("preview", () => {
  it("validates everything and writes nothing", async () => {
    const before = { events: await events(), memberships: await memberships() };
    const p = ready(await preview());
    expect(p.plan.counts).toEqual({
      CREATE: 2,
      ADD_MEMBERSHIP: 0,
      UNCHANGED: 0,
      ERROR: 0,
    });
    expect(p.plan.rows[0]!.person).toEqual({
      personnelNumber: "00501",
      displayName: "سارا نیکو",
      email: null,
      mobile: "09121234567",
      role: "NURSE",
    });
    expect(await events()).toEqual(before.events);
    expect(await memberships()).toEqual(before.memberships);
  });

  it("matches existing accounts by personnel number only", async () => {
    const p = ready(
      await preview(
        "personnel_number,display_name,email\n" +
          // Existing ER nurse by number → new ICU membership.
          `1021,${U.erNurse1.displayName},\n` +
          // Same name and e-mail as an existing user, different number → not matched.
          `9001,${U.icuNurse2.displayName},${U.icuNurse2.email}\n` +
          // Existing ICU nurse with the same open membership → unchanged.
          `1012,${U.icuNurse2.displayName},\n`,
      ),
    );
    expect(p.plan.rows.map((r) => [r.action, r.userId, r.errors])).toEqual([
      ["ADD_MEMBERSHIP", U.erNurse1.id, []],
      ["ERROR", null, ["EMAIL_TAKEN"]],
      ["UNCHANGED", U.icuNurse2.id, []],
    ]);
  });

  it("reports identity, role and inactive-account conflicts", async () => {
    const p = ready(
      await preview(
        "personnel_number,display_name,role\n" +
          "01011,نام دیگر,\n" +
          `1010,${U.icuHead.displayName},\n` +
          `1040,${U.inactiveNurse.displayName},\n`,
      ),
    );
    expect(p.plan.rows.map((r) => r.errors)).toEqual([
      ["IDENTITY_CONFLICT"],
      ["ROLE_CONFLICT"],
      ["ACCOUNT_INACTIVE"],
    ]);
    expect(p.plan.committable).toBe(false);
  });

  it("returns file-level errors instead of a plan", async () => {
    expect(
      await preview("personnel_number,display_name,password\n1,a,secret"),
    ).toEqual({ ok: false, fileError: "CREDENTIAL_COLUMN" });
  });

  it("is Hospital Admin only and needs an active department", async () => {
    for (const id of [U.erHead.id, U.supervisor.id, U.icuNurse1.id])
      await expect(preview(CSV, await as(id))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    await expect(
      preview(CSV, admin, "99999999-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("commit", () => {
  it("creates passwordless accounts and memberships atomically, audited", async () => {
    const p = await preview();
    const outcome = data(await commitPersonnelImport(admin, payload(p)));
    expect(outcome).toMatchObject({ membershipsAdded: 2, unchanged: 0 });
    expect(outcome.created.map((c) => c.personnelNumber)).toEqual([
      "00501",
      "00502",
    ]);
    const created = await db
      .select()
      .from(users)
      .where(eq(users.personnelNumber, "00501"));
    expect(created[0]).toMatchObject({
      displayName: "سارا نیکو",
      email: null,
      mobile: "09121234567",
      passwordHash: null,
      isActive: true,
      isHospitalAdmin: false,
    });
    expect(
      (await memberships()).filter((m) => m.userId === created[0]!.id),
    ).toMatchObject([
      {
        departmentId: DEMO_ICU.id,
        role: "NURSE",
        startedOn: START,
        endedOn: null,
      },
    ]);
    // No password: cannot sign in until a temporary password is issued.
    expect(
      await authenticateWithPassword(
        db,
        { identifier: "00501", password: "anything-long" },
        NOW,
      ),
    ).toMatchObject({ ok: false });
    expect((await events()).slice(1).map((e) => e.action)).toEqual([
      "user.created",
      "membership.added",
      "user.created",
      "membership.added",
      "personnel.imported",
    ]);
    expect(JSON.stringify(await events())).not.toMatch(/password|hash|secret/i);
  });

  it("never adds imported people to existing schedules' rosters", async () => {
    const before = await listRoster(db, DEMO_SCHEDULE.id);
    data(await commitPersonnelImport(admin, payload(await preview())));
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(before);
  });

  it("is idempotent: a retry is refused as changed, a fresh preview is a no-op", async () => {
    const first = payload(await preview());
    data(await commitPersonnelImport(admin, first));
    const after = { events: await events(), memberships: await memberships() };
    expect(await commitPersonnelImport(admin, first)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "IMPORT_PLAN_CHANGED" },
    });
    const again = ready(await preview());
    expect(again.plan.counts.UNCHANGED).toBe(2);
    expect(data(await commitPersonnelImport(admin, payload(again)))).toEqual({
      created: [],
      membershipsAdded: 0,
      unchanged: 2,
    });
    expect(await events()).toEqual(after.events);
    expect(await memberships()).toEqual(after.memberships);
  });

  it("refuses a plan that changed between preview and commit, writing nothing", async () => {
    const p = payload(await preview());
    await createUser(db, { personnelNumber: "00502", displayName: "دیگری" });
    const before = await events();
    expect(await commitPersonnelImport(admin, p)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "IMPORT_PLAN_CHANGED" },
    });
    expect(await events()).toEqual(before);
    expect(
      await db.select().from(users).where(eq(users.personnelNumber, "00501")),
    ).toEqual([]);
  });

  it("re-validates client rows: tampering is a conflict or a validation error", async () => {
    const p = payload(await preview());
    const renamed = {
      ...p,
      rows: p.rows.map((r, i) => (i === 0 ? { ...r, displayName: "جعلی" } : r)),
    };
    expect(await commitPersonnelImport(admin, renamed)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    const invalid = {
      ...p,
      rows: p.rows.map((r, i) =>
        i === 0 ? { ...r, personnelNumber: "1a" } : r,
      ),
    };
    expect(await commitPersonnelImport(admin, invalid)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", reason: "IMPORT_PLAN_CHANGED" },
    });
    const otherDepartment = { ...p, departmentId: DEMO_ER.id };
    expect(await commitPersonnelImport(admin, otherDepartment)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });

  it("refuses a plan with errors", async () => {
    const p = await preview(
      "personnel_number,display_name\n01011,نام دیگر\n7,ok\n",
    );
    const body = {
      ...payload({ ...ready(p), plan: { ...ready(p).plan } }),
      rows: [
        {
          line: 2,
          personnelNumber: "01011",
          displayName: "نام دیگر",
          email: null,
          mobile: null,
          role: "NURSE",
        },
        {
          line: 3,
          personnelNumber: "7",
          displayName: "ok",
          email: null,
          mobile: null,
          role: "NURSE",
        },
      ],
    };
    expect(await commitPersonnelImport(admin, body)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", reason: "IMPORT_HAS_ERRORS" },
    });
  });

  it("serializes concurrent commits of the same file: exactly one writes", async () => {
    const p = payload(await preview());
    const results = await Promise.all([
      commitPersonnelImport(admin, p),
      commitPersonnelImport(admin, p),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([
      { error: { code: "CONFLICT" } },
    ]);
    expect(
      await db.select().from(users).where(eq(users.personnelNumber, "00501")),
    ).toHaveLength(1);
  });

  it("is Hospital Admin only", async () => {
    const p = payload(await preview());
    for (const id of [U.erHead.id, U.icuNurse1.id])
      expect(await commitPersonnelImport(await as(id), p)).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
  });

  it("adds a membership to an existing account without touching its identity or password", async () => {
    const [before] = await db
      .select()
      .from(users)
      .where(eq(users.id, U.erNurse1.id));
    const p = await preview(
      `personnel_number,display_name\n1021,${U.erNurse1.displayName}\n`,
    );
    data(await commitPersonnelImport(admin, payload(p)));
    const [after] = await db
      .select()
      .from(users)
      .where(eq(users.id, U.erNurse1.id));
    expect(after).toEqual(before);
    expect(
      (await memberships()).filter(
        (m) => m.userId === U.erNurse1.id && m.departmentId === DEMO_ICU.id,
      ),
    ).toHaveLength(1);
  });
});

describe("initial temporary passwords after an import", () => {
  it("issues only to accounts without credentials, once, never resetting others", async () => {
    const outcome = data(
      await commitPersonnelImport(admin, payload(await preview())),
    );
    const ids = [
      ...outcome.created.map((c) => c.userId),
      U.icuNurse1.id,
      U.inactiveNurse.id,
      admin.actor.userId,
    ];
    const results = data(
      await issueInitialTemporaryPasswords(admin, { userIds: ids }),
    );
    expect(results.map((r) => r.status)).toEqual([
      "ISSUED",
      "ISSUED",
      "HAS_CREDENTIALS",
      "INACTIVE",
      "SELF",
    ]);
    const issued = results[0]!;
    if (issued.status !== "ISSUED") throw new Error("expected issued");
    expect(
      await authenticateWithPassword(
        db,
        { identifier: "00501", password: issued.temporaryPassword },
        NOW,
      ),
    ).toMatchObject({ ok: true });
    // The existing nurse's password still works: nothing was reset.
    expect(
      await authenticateWithPassword(
        db,
        { identifier: U.icuNurse1.email, password: "demo-only-password" },
        NOW,
      ),
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(await events())).not.toContain(
      issued.temporaryPassword,
    );
  });
});
