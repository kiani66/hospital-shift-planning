import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import { setHospitalAdmin } from "../../src/application/management/accounts";
import { createSchedule } from "../../src/application/schedules/create-schedule";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import { authenticateWithPassword } from "../../src/infrastructure/auth/credentials";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  auditEvents,
  departments,
  users,
} from "../../src/infrastructure/db/schema";
import {
  listUserAccessHistory,
  findMembership,
} from "../../src/infrastructure/repositories/management";
import {
  addMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import {
  listRoster,
  listSchedulingRoster,
} from "../../src/infrastructure/repositories/roster";
import {
  createUser,
  findUserByEmail,
  findUserById,
} from "../../src/infrastructure/repositories/users";
import { formatJalaliInput } from "../../src/features/calendar/jalali-input";
import {
  addMembershipAction,
  changeMembershipRoleAction,
  createAccountAction,
  endMembershipAction,
  setAccountActiveAction,
  transferMembershipAction,
  updateProfileAction,
} from "../../src/features/management/actions";
import type { ManagementFormState } from "../../src/features/management/mutation-result";
import { setupTestDatabase } from "./support/database";

const adapter = vi.hoisted(() => ({
  ctx: undefined as AppContext | undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("../../src/features/auth/guards", () => ({
  requireRequestContext: vi.fn(async () => adapter.ctx!),
}));

const { db } = setupTestDatabase();
const today = isoDate("2026-10-03");
const now = new Date("2026-10-03T08:00:00Z");
const idle: ManagementFormState = { status: "idle" };
const password = "private-initial-password";
const date = (value: string) => formatJalaliInput(isoDate(value));
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, today))!,
  clock: () => now,
});
let admin: AppContext;
let relationId: string;
const events = () => db.select().from(auditEvents);

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    now,
  );
  admin = await as(U.icuHead.id);
  adapter.ctx = admin;
  const history = await listUserAccessHistory(db, U.icuNurse1.id);
  relationId = history.memberships[0]!.id;
  vi.mocked(revalidatePath).mockClear();
});

const accountForm = (extra: Record<string, string> = {}) =>
  form({
    personnelNumber: "۰۰۷۰۰۱",
    email: "created@actions.invalid",
    displayName: "Created",
    issueTemporaryPassword: "on",
    ...extra,
  });
const profileForm = (extra: Record<string, string> = {}) =>
  form({
    userId: U.icuNurse1.id,
    email: "changed@actions.invalid",
    displayName: "Changed",
    expectedEmail: U.icuNurse1.email,
    expectedDisplayName: U.icuNurse1.displayName,
    ...extra,
  });
const statusForm = (extra: Record<string, string> = {}) =>
  form({
    userId: U.icuNurse1.id,
    isActive: "false",
    expectedIsActive: "true",
    ...extra,
  });
const addForm = (extra: Record<string, string> = {}) =>
  form({
    userId: U.icuNurse1.id,
    departmentId: DEMO_ER.id,
    role: "NURSE",
    startedOn: date("2026-10-03"),
    endedOn: "",
    ...extra,
  });
const endForm = (extra: Record<string, string> = {}) =>
  form({
    relationId,
    expectedEndedOn: "",
    endedOn: date("2026-10-03"),
    ...extra,
  });
const transitionForm = (extra: Record<string, string> = {}) =>
  form({
    relationId,
    expectedEndedOn: "",
    departmentId: DEMO_ER.id,
    role: "NURSE",
    startedOn: date("2026-10-03"),
    endedOn: "",
    ...extra,
  });

describe("ordinary account Server Actions", () => {
  it("creates a normalized account with a one-time temporary password, returns only safe fields, and audits", async () => {
    const result = await createAccountAction(
      idle,
      accountForm({
        email: " CREATED@ACTIONS.INVALID ",
        isHospitalAdmin: "true",
        isActive: "false",
        password,
      }),
    );
    expect(result).toMatchObject({
      status: "success",
      userId: expect.any(String),
      temporaryPassword: expect.any(String),
    });
    expect(Object.keys(result).sort()).toEqual([
      "at",
      "message",
      "status",
      "temporaryPassword",
      "userId",
    ]);
    const user = await findUserById(db, result.userId!);
    expect(user).toMatchObject({
      personnelNumber: "007001",
      email: "created@actions.invalid",
      isActive: true,
      isHospitalAdmin: false,
    });
    // The submitted `password` field is not part of the create form: discarded.
    expect(
      await authenticateWithPassword(
        db,
        { identifier: "007001", password },
        now,
      ),
    ).toMatchObject({ ok: false });
    expect(
      await authenticateWithPassword(
        db,
        { identifier: "007001", password: result.temporaryPassword! },
        now,
      ),
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(await events())).not.toContain(
      result.temporaryPassword,
    );
    expect((await events()).slice(-2)).toMatchObject([
      {
        action: "user.created",
        actorId: admin.actor.userId,
        entityId: user!.id,
      },
      {
        action: "user.temporaryCredentialIssued",
        actorId: admin.actor.userId,
        entityId: user!.id,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(await events())).not.toMatch(
      /password|hash|token|secret/,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("refuses duplicate email with safe field feedback and no partial write/audit", async () => {
    const before = await events();
    const result = await createAccountAction(
      idle,
      accountForm({ email: U.icuNurse1.email.toUpperCase() }),
    );
    expect(result).toMatchObject({
      status: "error",
      fields: { email: expect.stringContaining("قبلاً") },
    });
    expect(await events()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("refuses a duplicate personnel number (Persian digits normalized) without writes", async () => {
    const before = await events();
    const result = await createAccountAction(
      idle,
      accountForm({ personnelNumber: "۰۱۰۱۱", email: "" }),
    );
    expect(result).toMatchObject({
      status: "error",
      fields: { personnelNumber: expect.stringContaining("قبلاً") },
    });
    expect(result).not.toHaveProperty("temporaryPassword");
    expect(await events()).toEqual(before);
  });
  it.each<Record<string, string>>([
    { email: "bad" },
    { displayName: " " },
    { personnelNumber: "" },
    { personnelNumber: "12-34" },
    { personnelNumber: "1".repeat(21) },
    { mobile: "12345" },
  ])("validates create fields before writing %#", async (extra) => {
    const before = await events();
    expect(await createAccountAction(idle, accountForm(extra))).toMatchObject({
      status: "error",
    });
    expect(await findUserByEmail(db, "created@actions.invalid")).toBeNull();
    expect(await events()).toEqual(before);
  });
  it("edits only profile fields and records the existing profile audit event", async () => {
    expect(
      await updateProfileAction(
        idle,
        profileForm({
          passwordHash: "injected",
          isActive: "false",
          isHospitalAdmin: "true",
        }),
      ),
    ).toMatchObject({ status: "success" });
    expect(await findUserById(db, U.icuNurse1.id)).toMatchObject({
      displayName: "Changed",
      email: "changed@actions.invalid",
      isActive: true,
      isHospitalAdmin: false,
    });
    expect((await events()).at(-1)?.action).toBe("user.profileChanged");
  });
  it("reports stale profile values rather than overwriting a later edit", async () => {
    await updateProfileAction(idle, profileForm());
    const before = await events();
    const result = await updateProfileAction(
      idle,
      profileForm({ displayName: "stale" }),
    );
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("از زمان باز شدن فرم"),
    });
    expect((await findUserById(db, U.icuNurse1.id))?.displayName).toBe(
      "Changed",
    );
    expect(await events()).toEqual(before);
  });
  it("rejects profile email uniqueness conflicts without changing the account", async () => {
    const before = await events();
    expect(
      await updateProfileAction(idle, profileForm({ email: U.erNurse1.email })),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("ایمیل"),
    });
    expect((await findUserById(db, U.icuNurse1.id))?.email).toBe(
      U.icuNurse1.email,
    );
    expect(await events()).toEqual(before);
  });
  it("deactivates/reactivates without erasing relations/old rosters; new scheduling excludes inactive users", async () => {
    const history = await listUserAccessHistory(db, U.icuNurse1.id);
    const oldRoster = await listRoster(db, DEMO_SCHEDULE.id);
    expect(await setAccountActiveAction(idle, statusForm())).toMatchObject({
      status: "success",
    });
    expect(
      await authenticateWithPassword(
        db,
        { identifier: U.icuNurse1.email, password: "demo-only-password" },
        now,
      ),
    ).toMatchObject({ ok: false });
    expect(
      (await listSchedulingRoster(db, DEMO_SCHEDULE.id)).map((r) => r.userId),
    ).not.toContain(U.icuNurse1.id);
    const schedule = await createSchedule(admin, {
      departmentId: DEMO_ICU.id,
      periodStart: "2027-01-01",
      periodEnd: "2027-01-31",
      label: "Inactive eligibility",
    });
    if (!schedule.ok) throw new Error(schedule.error.code);
    expect(
      (await listRoster(db, schedule.data.scheduleId)).map((r) => r.userId),
    ).not.toContain(U.icuNurse1.id);
    expect(await listUserAccessHistory(db, U.icuNurse1.id)).toEqual(history);
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(oldRoster);
    expect(
      await setAccountActiveAction(
        idle,
        statusForm({ isActive: "true", expectedIsActive: "false" }),
      ),
    ).toMatchObject({ status: "success" });
    expect(
      (await listSchedulingRoster(db, DEMO_SCHEDULE.id)).map((r) => r.userId),
    ).toContain(U.icuNurse1.id);
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(oldRoster);
    expect(
      (await events())
        .filter((e) => e.entityId === U.icuNurse1.id)
        .map((e) => e.action),
    ).toEqual(["user.deactivated", "user.activated"]);
  });
  it("refuses a stale status form even when its desired value already matches current state", async () => {
    await setAccountActiveAction(idle, statusForm());
    const before = await events();
    const result = await setAccountActiveAction(idle, statusForm());
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("از زمان باز شدن فرم"),
    });
    expect(await events()).toEqual(before);
    expect((await findUserById(db, U.icuNurse1.id))?.isActive).toBe(false);
  });
  it("refuses deactivation of the last active admin with a specific Persian error", async () => {
    const before = await events();
    expect(
      await setAccountActiveAction(
        idle,
        statusForm({ userId: admin.actor.userId }),
      ),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("آخرین مدیر فعال"),
    });
    expect((await findUserById(db, admin.actor.userId))?.isActive).toBe(true);
    expect(await events()).toEqual(before);
  });
  it("redirects an admin who deliberately deactivates their own account when another active admin exists", async () => {
    expect(
      (
        await setHospitalAdmin(admin, {
          userId: U.erHead.id,
          isHospitalAdmin: true,
        })
      ).ok,
    ).toBe(true);
    await expect(
      setAccountActiveAction(idle, statusForm({ userId: admin.actor.userId })),
    ).rejects.toThrow("redirect:/login");
    expect((await findUserById(db, admin.actor.userId))?.isActive).toBe(false);
    expect((await events()).at(-1)?.action).toBe("user.deactivated");
  });
});

describe("membership lifecycle Server Actions", () => {
  it.each([
    ["2025-01-01", "2025-12-31"],
    ["2026-10-03", null],
    ["2027-01-01", "2027-12-31"],
  ] as const)(
    "adds historical/current/future or fixed-term membership %s",
    async (start, end) => {
      const result = await addMembershipAction(
        idle,
        addForm({ startedOn: date(start), endedOn: end ? date(end) : "" }),
      );
      expect(result).toMatchObject({ status: "success" });
      expect(
        (await listUserAccessHistory(db, U.icuNurse1.id)).memberships.find(
          (m) => m.departmentId === DEMO_ER.id,
        ),
      ).toMatchObject({ startedOn: start, endedOn: end });
      expect((await events()).at(-1)?.action).toBe("membership.added");
    },
  );
  it("reports membership overlap without partial audit", async () => {
    const before = await events();
    expect(
      await addMembershipAction(idle, addForm({ departmentId: DEMO_ICU.id })),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("هم‌پوشانی"),
    });
    expect(await events()).toEqual(before);
  });
  it("reports inverted date ranges beside the end field", async () => {
    const before = await events();
    expect(
      await addMembershipAction(idle, addForm({ endedOn: date("2026-10-02") })),
    ).toMatchObject({
      status: "error",
      fields: { endedOn: expect.stringContaining("قبل از") },
    });
    expect(await events()).toEqual(before);
  });
  it("ends inclusively, retains membership history/account/roster, and audits", async () => {
    const roster = await listRoster(db, DEMO_SCHEDULE.id);
    expect(await endMembershipAction(idle, endForm())).toMatchObject({
      status: "success",
    });
    expect(await findMembership(db, relationId)).toMatchObject({
      endedOn: today,
      role: "NURSE",
    });
    expect(
      (await loadActor(db, U.icuNurse1.id, today))?.memberships,
    ).toContainEqual({ departmentId: DEMO_ICU.id, role: "NURSE" });
    expect(
      (await loadActor(db, U.icuNurse1.id, isoDate("2026-10-04")))?.memberships,
    ).toEqual([]);
    expect((await findUserById(db, U.icuNurse1.id))?.isActive).toBe(true);
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(roster);
    expect((await events()).at(-1)?.action).toBe("membership.ended");
  });
  it("surfaces stale membership tokens and backdated ending without overwriting history", async () => {
    await endMembershipAction(idle, endForm({ endedOn: date("2026-12-31") }));
    const before = await events();
    expect(await endMembershipAction(idle, endForm())).toMatchObject({
      status: "error",
      message: expect.stringContaining("از زمان باز شدن فرم"),
    });
    expect(
      await endMembershipAction(
        idle,
        endForm({ expectedEndedOn: "2026-12-31", endedOn: date("2026-10-02") }),
      ),
    ).toMatchObject({
      status: "error",
      fields: { endedOn: expect.stringContaining("گذشته") },
    });
    expect(await events()).toEqual(before);
  });
  it.each(["2025-01-01", "2027-01-01"])(
    "does not edit already-ended/future memberships (%s)",
    async (start) => {
      const user = await createUser(db, {
        email: "term@actions.invalid",
        displayName: "Term",
      });
      await addMembership(db, {
        userId: user.id,
        departmentId: DEMO_ER.id,
        role: "NURSE",
        startedOn: isoDate(start),
        endedOn: start === "2025-01-01" ? isoDate("2025-12-31") : null,
      });
      const row = (await listUserAccessHistory(db, user.id)).memberships[0]!;
      expect(
        await endMembershipAction(
          idle,
          endForm({ relationId: row.id, expectedEndedOn: row.endedOn ?? "" }),
        ),
      ).toMatchObject({
        status: "error",
        message: expect.stringContaining("امروز جاری نیست"),
      });
      expect((await listUserAccessHistory(db, user.id)).memberships[0]).toEqual(
        row,
      );
    },
  );
  it("refuses an end operation that extends a fixed term", async () => {
    await endMembershipAction(idle, endForm({ endedOn: date("2026-12-31") }));
    expect(
      await endMembershipAction(
        idle,
        endForm({ expectedEndedOn: "2026-12-31", endedOn: date("2027-01-01") }),
      ),
    ).toMatchObject({
      status: "error",
      fields: { endedOn: expect.stringContaining("تمدید") },
    });
  });
  it("transfers atomically and preserves predecessor role/department and old roster", async () => {
    const roster = await listRoster(db, DEMO_SCHEDULE.id);
    expect(
      await transferMembershipAction(
        idle,
        transitionForm({ role: "HEAD_NURSE" }),
      ),
    ).toMatchObject({ status: "success" });
    expect(await findMembership(db, relationId)).toMatchObject({
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      endedOn: "2026-10-02",
    });
    expect(
      (await listUserAccessHistory(db, U.icuNurse1.id)).memberships,
    ).toHaveLength(2);
    expect((await loadActor(db, U.icuNurse1.id, today))?.memberships).toEqual([
      { departmentId: DEMO_ER.id, role: "HEAD_NURSE" },
    ]);
    expect(await listRoster(db, DEMO_SCHEDULE.id)).toEqual(roster);
    expect((await events()).at(-1)?.action).toBe("membership.transferred");
  });
  it("rolls back the predecessor when the transfer destination overlaps", async () => {
    await addMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ER.id,
      role: "NURSE",
      startedOn: isoDate("2026-01-01"),
    });
    const before = await events();
    expect(
      await transferMembershipAction(idle, transitionForm()),
    ).toMatchObject({ status: "error" });
    expect((await findMembership(db, relationId))?.endedOn).toBeNull();
    expect(await events()).toEqual(before);
  });
  it("changes role by creating a successor and keeping historical NURSE role", async () => {
    expect(
      await changeMembershipRoleAction(
        idle,
        transitionForm({ departmentId: DEMO_ICU.id, role: "HEAD_NURSE" }),
      ),
    ).toMatchObject({ status: "success" });
    const history = await listUserAccessHistory(db, U.icuNurse1.id);
    expect(
      history.memberships.map((m) => [m.role, m.startedOn, m.endedOn]),
    ).toEqual([
      ["NURSE", "2026-01-01", "2026-10-02"],
      ["HEAD_NURSE", "2026-10-03", null],
    ]);
    expect((await events()).at(-1)?.action).toBe("membership.roleChanged");
  });
  it("explains a same-day transition of a membership starting today beside the effective date", async () => {
    const user = await createUser(db, {
      email: "today@actions.invalid",
      displayName: "Today",
    });
    await addMembership(db, {
      userId: user.id,
      departmentId: DEMO_ICU.id,
      role: "NURSE",
      startedOn: today,
    });
    const row = (await listUserAccessHistory(db, user.id)).memberships[0]!;
    const before = await events();
    expect(
      await transferMembershipAction(
        idle,
        transitionForm({ relationId: row.id }),
      ),
    ).toMatchObject({
      status: "error",
      fields: { startedOn: expect.stringContaining("امروز شروع شده") },
    });
    expect(await events()).toEqual(before);
  });
  it("reports unknown/inactive departments, unknown users and unknown membership ids safely", async () => {
    await db
      .update(departments)
      .set({ isActive: false })
      .where(eq(departments.id, DEMO_ER.id));
    expect(await addMembershipAction(idle, addForm())).toMatchObject({
      status: "error",
    });
    expect(
      await addMembershipAction(idle, addForm({ departmentId: randomUUID() })),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("در دسترس نیست"),
    });
    expect(
      await addMembershipAction(idle, addForm({ userId: randomUUID() })),
    ).toMatchObject({ status: "error" });
    expect(
      await endMembershipAction(idle, endForm({ relationId: randomUUID() })),
    ).toMatchObject({ status: "error" });
  });
  it("returns a generic Persian error and rolls back when audit fails", async () => {
    const audit = await import("../../src/infrastructure/repositories/audit");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(audit, "recordAuditEvent").mockRejectedValueOnce(
      new Error("token=private"),
    );
    const before = await events();
    const result = await createAccountAction(idle, accountForm());
    expect(result).toMatchObject({
      status: "error",
      message: expect.stringContaining("ذخیره اطلاعات ممکن نشد"),
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(await findUserByEmail(db, "created@actions.invalid")).toBeNull();
    expect(await events()).toEqual(before);
  });
});

describe("direct-action authorization", () => {
  it.each([U.erHead, U.supervisor, U.icuNurse2, U.inactiveNurse])(
    "denies every action to $email without writes/audit",
    async (actor) => {
      adapter.ctx = await as(actor.id);
      const before = await events();
      const account = await findUserById(db, U.icuNurse1.id);
      const membership = await findMembership(db, relationId);
      for (const [action, data] of [
        [createAccountAction, accountForm()],
        [updateProfileAction, profileForm()],
        [setAccountActiveAction, statusForm()],
        [addMembershipAction, addForm()],
        [endMembershipAction, endForm()],
        [transferMembershipAction, transitionForm()],
        [
          changeMembershipRoleAction,
          transitionForm({ departmentId: DEMO_ICU.id, role: "HEAD_NURSE" }),
        ],
      ] as const)
        expect(await action(idle, data)).toMatchObject({
          status: "error",
          message: expect.stringContaining("اجازه"),
        });
      expect(await events()).toEqual(before);
      expect(await findUserById(db, U.icuNurse1.id)).toEqual(account);
      expect(await findMembership(db, relationId)).toEqual(membership);
      expect(await findUserByEmail(db, "created@actions.invalid")).toBeNull();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
  it("rechecks revoked authority under the existing administration lock", async () => {
    await db
      .update(users)
      .set({ isHospitalAdmin: false })
      .where(eq(users.id, admin.actor.userId));
    expect(await setAccountActiveAction(idle, statusForm())).toMatchObject({
      status: "error",
      message: expect.stringContaining("اجازه"),
    });
    expect((await findUserById(db, U.icuNurse1.id))?.isActive).toBe(true);
  });
  it("requires the stale-status token at the action boundary", async () => {
    const data = statusForm();
    data.delete("expectedIsActive");
    expect(await setAccountActiveAction(idle, data)).toMatchObject({
      status: "error",
    });
    expect((await findUserById(db, U.icuNurse1.id))?.isActive).toBe(true);
  });
});
