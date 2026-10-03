import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  setAccountActive,
  setHospitalAdmin,
} from "../../src/application/management/accounts";
import { getPersonnelDirectory } from "../../src/application/management/personnel-queries";
import { assignDepartmentSupervisor } from "../../src/application/management/supervisors";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import {
  assignSupervisorAction,
  endSupervisorAction,
  setAccountActiveAction,
  setHospitalAdminAction,
} from "../../src/features/management/actions";
import { formatJalaliInput } from "../../src/features/calendar/jalali-input";
import type { ManagementFormState } from "../../src/features/management/mutation-result";
import { actorFromSession } from "../../src/infrastructure/auth/actor";
import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import { auditEvents, departments } from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import * as auditRepository from "../../src/infrastructure/repositories/audit";
import {
  countHospitalAdmins,
  listUserAccessHistory,
} from "../../src/infrastructure/repositories/management";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { findUserById } from "../../src/infrastructure/repositories/users";
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
const events = () => db.select().from(auditEvents);
const authorityForm = (extra: Record<string, string> = {}) =>
  form({
    userId: U.icuNurse1.id,
    isHospitalAdmin: "true",
    expectedIsHospitalAdmin: "false",
    expectedIsActive: "true",
    ...extra,
  });
const assignmentForm = (extra: Record<string, string> = {}) =>
  form({
    userId: U.icuNurse1.id,
    departmentId: DEMO_ICU.id,
    startedOn: date(today),
    endedOn: "",
    ...extra,
  });
const endingForm = (relationId: string, extra: Record<string, string> = {}) =>
  form({ relationId, expectedEndedOn: "", endedOn: date(today), ...extra });
let admin: AppContext;

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    now,
  );
  admin = await as(U.icuHead.id);
  adapter.ctx = admin;
  vi.mocked(revalidatePath).mockClear();
});

async function secondAdmin() {
  expect(
    (
      await setHospitalAdmin(admin, {
        userId: U.erHead.id,
        isHospitalAdmin: true,
      })
    ).ok,
  ).toBe(true);
  return as(U.erHead.id);
}

describe("Hospital Admin authority actions", () => {
  it("grants/removes system authority independently, with safe audit and fresh same-cookie reads", async () => {
    const history = await listUserAccessHistory(db, U.icuNurse1.id);
    expect(
      await setHospitalAdminAction(
        idle,
        authorityForm({
          isActive: "false",
          role: "HEAD_NURSE",
          passwordHash: "secret",
        }),
      ),
    ).toMatchObject({ status: "success" });
    expect((await findUserById(db, U.icuNurse1.id))!).toMatchObject({
      isHospitalAdmin: true,
      isActive: true,
    });
    expect(
      (await actorFromSession(db, { user: { id: U.icuNurse1.id } }, today))
        ?.isHospitalAdmin,
    ).toBe(true);
    expect(
      await setHospitalAdminAction(
        idle,
        authorityForm({
          isHospitalAdmin: "false",
          expectedIsHospitalAdmin: "true",
        }),
      ),
    ).toMatchObject({ status: "success" });
    expect(
      (await actorFromSession(db, { user: { id: U.icuNurse1.id } }, today))
        ?.isHospitalAdmin,
    ).toBe(false);
    expect(await listUserAccessHistory(db, U.icuNurse1.id)).toEqual(history);
    expect(
      (await events())
        .slice(1)
        .map((e) => ({ action: e.action, data: e.data })),
    ).toEqual([
      {
        action: "user.hospitalAdminChanged",
        data: { before: false, after: true },
      },
      {
        action: "user.hospitalAdminChanged",
        data: { before: true, after: false },
      },
    ]);
    expect(JSON.stringify(await events())).not.toMatch(
      /password|hash|token|secret/,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("stores authority on an inactive account without activation or access until explicit reactivation", async () => {
    expect(
      await setHospitalAdminAction(
        idle,
        authorityForm({
          userId: U.inactiveNurse.id,
          expectedIsActive: "false",
          isActive: "true",
        }),
      ),
    ).toMatchObject({ status: "success" });
    expect(await findUserById(db, U.inactiveNurse.id)).toMatchObject({
      isActive: false,
      isHospitalAdmin: true,
    });
    expect(
      await actorFromSession(db, { user: { id: U.inactiveNurse.id } }, today),
    ).toBeNull();
    expect(await countHospitalAdmins(db)).toBe(1);
    expect(
      (
        await setAccountActive(admin, {
          userId: U.inactiveNurse.id,
          isActive: true,
          expectedIsActive: false,
        })
      ).ok,
    ).toBe(true);
    expect(
      (await actorFromSession(db, { user: { id: U.inactiveNurse.id } }, today))
        ?.isHospitalAdmin,
    ).toBe(true);
  });
  it("rejects stale authority even when the requested flag already matches", async () => {
    expect(
      (
        await setHospitalAdmin(admin, {
          userId: U.icuNurse1.id,
          isHospitalAdmin: true,
        })
      ).ok,
    ).toBe(true);
    const before = await events();
    expect(await setHospitalAdminAction(idle, authorityForm())).toMatchObject({
      status: "error",
      message: expect.stringContaining("صفحه را تازه کنید"),
    });
    expect(await events()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rejects a changed target account status before applying the authority decision", async () => {
    expect(
      (
        await setAccountActive(admin, {
          userId: U.icuNurse1.id,
          isActive: false,
        })
      ).ok,
    ).toBe(true);
    const before = await events();
    expect(await setHospitalAdminAction(idle, authorityForm())).toMatchObject({
      status: "error",
      message: expect.stringContaining("صفحه را تازه کنید"),
    });
    expect(await findUserById(db, U.icuNurse1.id)).toMatchObject({
      isActive: false,
      isHospitalAdmin: false,
    });
    expect(await events()).toEqual(before);
  });
  it.each(["expectedIsHospitalAdmin", "expectedIsActive"])(
    "requires %s at the UI action boundary",
    async (field) => {
      const data = authorityForm();
      data.delete(field);
      expect(await setHospitalAdminAction(idle, data)).toMatchObject({
        status: "error",
      });
      expect(await events()).toHaveLength(1);
    },
  );
  it("handles unknown target accounts safely", async () => {
    expect(
      await setHospitalAdminAction(
        idle,
        authorityForm({ userId: "20000000-0000-4000-8000-999999999999" }),
      ),
    ).toMatchObject({ status: "error" });
    expect(await events()).toHaveLength(1);
  });
  it.each(["authority", "deactivate"])(
    "specifically refuses last-active-admin %s without write or audit",
    async (operation) => {
      const result =
        operation === "authority"
          ? await setHospitalAdminAction(
              idle,
              authorityForm({
                userId: admin.actor.userId,
                isHospitalAdmin: "false",
                expectedIsHospitalAdmin: "true",
              }),
            )
          : await setAccountActiveAction(
              idle,
              form({
                userId: admin.actor.userId,
                isActive: "false",
                expectedIsActive: "true",
              }),
            );
      expect(result).toMatchObject({
        status: "error",
        message: expect.stringContaining("آخرین مدیر فعال"),
      });
      expect(await countHospitalAdmins(db)).toBe(1);
      expect(await events()).toHaveLength(1);
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
  it("allows self-demotion with another active admin, redirects and removes admin read access", async () => {
    await secondAdmin();
    await expect(
      setHospitalAdminAction(
        idle,
        authorityForm({
          userId: admin.actor.userId,
          isHospitalAdmin: "false",
          expectedIsHospitalAdmin: "true",
        }),
      ),
    ).rejects.toThrow("redirect:/");
    const actor = await actorFromSession(
      db,
      { user: { id: admin.actor.userId } },
      today,
    );
    expect(actor).toMatchObject({ isActive: true, isHospitalAdmin: false });
    await expect(
      getPersonnelDirectory({ ...admin, actor: actor! }),
    ).rejects.toThrow();
    expect((await events()).at(-1)).toMatchObject({
      action: "user.hospitalAdminChanged",
      data: { before: true, after: false },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("refuses self-demotion when the only other stored admin is inactive", async () => {
    await setHospitalAdmin(admin, {
      userId: U.inactiveNurse.id,
      isHospitalAdmin: true,
    });
    expect(
      await setHospitalAdminAction(
        idle,
        authorityForm({
          userId: admin.actor.userId,
          isHospitalAdmin: "false",
          expectedIsHospitalAdmin: "true",
        }),
      ),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("آخرین مدیر فعال"),
    });
    expect(await countHospitalAdmins(db)).toBe(1);
  });
});

describe("privileged concurrent writes", () => {
  // Each action captures its trusted context before yielding, like separate HTTP requests.
  const invoke = (ctx: AppContext, targetId: string) => {
    adapter.ctx = ctx;
    return setHospitalAdminAction(
      idle,
      authorityForm({
        userId: targetId,
        isHospitalAdmin: "false",
        expectedIsHospitalAdmin: "true",
      }),
    );
  };
  it("mutual authority removal allows one write and denies the revoked waiting caller", async () => {
    const other = await secondAdmin();
    const before = await events();
    const results = await Promise.all([
      invoke(admin, other.actor.userId),
      invoke(other, admin.actor.userId),
    ]);
    expect(results.filter((r) => r.status === "success")).toHaveLength(1);
    expect(results.find((r) => r.status === "error")?.message).toContain(
      "اجازه",
    );
    expect(await countHospitalAdmins(db)).toBe(1);
    expect(await events()).toHaveLength(before.length + 1);
  });
  it.each(["remove", "mixed"])(
    "concurrent self-%s operations cannot leave zero active admins",
    async (operation) => {
      const other = await secondAdmin();
      const before = await events();
      const self = async (
        ctx: AppContext,
        deactivate = false,
      ): Promise<ManagementFormState> => {
        adapter.ctx = ctx;
        try {
          return deactivate
            ? await setAccountActiveAction(
                idle,
                form({
                  userId: ctx.actor.userId,
                  isActive: "false",
                  expectedIsActive: "true",
                }),
              )
            : await invoke(ctx, ctx.actor.userId);
        } catch (error) {
          if (
            error instanceof Error &&
            ["redirect:/", "redirect:/login"].includes(error.message)
          )
            return { status: "success" };
          throw error;
        }
      };
      const results = await Promise.all([
        self(admin, operation === "mixed"),
        self(other),
      ]);
      expect(results.filter((r) => r.status === "success")).toHaveLength(1);
      expect(results.find((r) => r.status === "error")?.message).toContain(
        "آخرین مدیر فعال",
      );
      expect(await countHospitalAdmins(db)).toBe(1);
      expect(await events()).toHaveLength(before.length + 1);
    },
  );
  it("two grants from the same original authority state cannot both pass stale checking", async () => {
    const results = await Promise.all([
      setHospitalAdminAction(idle, authorityForm()),
      setHospitalAdminAction(idle, authorityForm()),
    ]);
    expect(results.filter((r) => r.status === "success")).toHaveLength(1);
    expect(results.find((r) => r.status === "error")?.message).toContain(
      "صفحه را تازه کنید",
    );
    expect(await events()).toHaveLength(2);
  });
});

describe("Supervisor assignment actions", () => {
  it.each(["2026-10-03", "2026-11-03"])(
    "creates an independent fixed-term assignment from %s and audits",
    async (startedOn) => {
      const before = await listUserAccessHistory(db, U.icuNurse1.id);
      const result = await assignSupervisorAction(
        idle,
        assignmentForm({
          startedOn: date(startedOn),
          endedOn: date("2026-12-03"),
          role: "HEAD_NURSE",
          isHospitalAdmin: "true",
        }),
      );
      expect(result).toMatchObject({ status: "success" });
      expect(Object.keys(result).sort()).toEqual(["at", "message", "status"]);
      const history = await listUserAccessHistory(db, U.icuNurse1.id);
      expect(history.memberships).toEqual(before.memberships);
      expect(history.supervisors).toEqual([
        {
          id: expect.any(String),
          departmentId: DEMO_ICU.id,
          startedOn,
          endedOn: "2026-12-03",
        },
      ]);
      expect(await findUserById(db, U.icuNurse1.id)).toMatchObject({
        isActive: true,
        isHospitalAdmin: false,
      });
      expect((await events()).at(-1)).toMatchObject({
        action: "supervisor.assigned",
        entityType: "supervisorAssignment",
      });
    },
  );
  it("ends inclusively and preserves the row, memberships and history with existing audit", async () => {
    const before = await listUserAccessHistory(db, U.supervisor.id);
    const relation = before.supervisors.find(
      (s) => s.departmentId === DEMO_ICU.id,
    )!;
    expect(
      await endSupervisorAction(idle, endingForm(relation.id)),
    ).toMatchObject({ status: "success" });
    const after = await listUserAccessHistory(db, U.supervisor.id);
    expect(after.supervisors).toEqual(
      before.supervisors.map((s) =>
        s.id === relation.id ? { ...s, endedOn: today } : s,
      ),
    );
    expect(after.memberships).toEqual(before.memberships);
    expect(
      (await loadActor(db, U.supervisor.id, today))?.supervisedDepartmentIds,
    ).toContain(DEMO_ICU.id);
    expect(
      (await loadActor(db, U.supervisor.id, isoDate("2026-10-04")))
        ?.supervisedDepartmentIds,
    ).not.toContain(DEMO_ICU.id);
    expect((await events()).at(-1)).toMatchObject({
      action: "supervisor.ended",
      entityId: relation.id,
    });
  });
  it("rejects a stale ending form without overwriting or duplicate audit", async () => {
    const relation = (await listUserAccessHistory(db, U.supervisor.id))
      .supervisors[0]!;
    expect(
      await endSupervisorAction(
        idle,
        endingForm(relation.id, { endedOn: date("2026-10-05") }),
      ),
    ).toMatchObject({ status: "success" });
    const before = await events();
    expect(
      await endSupervisorAction(idle, endingForm(relation.id)),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("صفحه را تازه کنید"),
    });
    expect(
      (await listUserAccessHistory(db, U.supervisor.id)).supervisors[0]
        ?.endedOn,
    ).toBe("2026-10-05");
    expect(await events()).toEqual(before);
  });
  it("rejects overlap without creating partial rows or audit", async () => {
    const before = await listUserAccessHistory(db, U.supervisor.id);
    expect(
      await assignSupervisorAction(
        idle,
        assignmentForm({ userId: U.supervisor.id }),
      ),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("هم‌پوشانی"),
    });
    expect(await listUserAccessHistory(db, U.supervisor.id)).toEqual(before);
    expect(await events()).toHaveLength(1);
  });
  it("reports inverted ranges beside the end date", async () => {
    expect(
      await assignSupervisorAction(
        idle,
        assignmentForm({ endedOn: date("2026-10-02") }),
      ),
    ).toMatchObject({
      status: "error",
      fields: { endedOn: expect.stringContaining("قبل") },
    });
    expect(await events()).toHaveLength(1);
  });
  it("refuses ending a future relation rather than rewriting its period", async () => {
    const created = await assignDepartmentSupervisor(admin, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      startedOn: isoDate("2026-11-03"),
      endedOn: null,
    });
    if (!created.ok) throw new Error(created.error.code);
    expect(
      await endSupervisorAction(
        idle,
        endingForm(created.data.id, { endedOn: date("2026-11-04") }),
      ),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("امروز جاری نیست"),
    });
    expect(await events()).toHaveLength(2);
  });
  it("refuses inactive/unknown departments and unknown assignment ids", async () => {
    await db
      .update(departments)
      .set({ isActive: false })
      .where(eq(departments.id, DEMO_ER.id));
    for (const departmentId of [
      DEMO_ER.id,
      "10000000-0000-4000-8000-999999999999",
    ])
      expect(
        await assignSupervisorAction(idle, assignmentForm({ departmentId })),
      ).toMatchObject({ status: "error" });
    expect(
      await endSupervisorAction(
        idle,
        endingForm("20000000-0000-4000-8000-999999999999"),
      ),
    ).toMatchObject({ status: "error" });
    expect(await events()).toHaveLength(1);
  });
  it.each(["grant", "assign", "end"])(
    "rolls back %s when audit fails and gives safe feedback",
    async (operation) => {
      const before = await listUserAccessHistory(db, U.icuNurse1.id);
      const sup = (await listUserAccessHistory(db, U.supervisor.id))
        .supervisors[0]!;
      vi.spyOn(auditRepository, "recordAuditEvent").mockRejectedValueOnce(
        new Error("private driver details"),
      );
      const result =
        operation === "grant"
          ? await setHospitalAdminAction(idle, authorityForm())
          : operation === "assign"
            ? await assignSupervisorAction(idle, assignmentForm())
            : await endSupervisorAction(idle, endingForm(sup.id));
      expect(result).toMatchObject({ status: "error" });
      expect(JSON.stringify(result)).not.toContain("private driver");
      expect(await findUserById(db, U.icuNurse1.id)).toMatchObject({
        isHospitalAdmin: false,
      });
      expect(await listUserAccessHistory(db, U.icuNurse1.id)).toEqual(before);
      expect(
        (await listUserAccessHistory(db, U.supervisor.id)).supervisors[0]
          ?.endedOn,
      ).toBe(sup.endedOn);
      expect(await events()).toHaveLength(1);
    },
  );
});

describe("elevated action denial", () => {
  it.each([U.erHead, U.supervisor, U.icuNurse1, U.inactiveNurse])(
    "denies all elevated actions to $email without writes",
    async (person) => {
      if (person.id === U.inactiveNurse.id)
        await setHospitalAdmin(admin, {
          userId: person.id,
          isHospitalAdmin: true,
        });
      adapter.ctx = await as(person.id);
      const relation = (await listUserAccessHistory(db, U.supervisor.id))
        .supervisors[0]!;
      const before = await events();
      for (const [action, data] of [
        [setHospitalAdminAction, authorityForm()],
        [assignSupervisorAction, assignmentForm()],
        [endSupervisorAction, endingForm(relation.id)],
      ] as const)
        expect(await action(idle, data)).toMatchObject({
          status: "error",
          message: expect.stringContaining("اجازه"),
        });
      expect(await events()).toEqual(before);
      expect(await findUserById(db, U.icuNurse1.id)).toMatchObject({
        isHospitalAdmin: false,
      });
    },
  );
  it("denies stale actor authority even when the incoming context still says admin", async () => {
    const other = await secondAdmin();
    await setHospitalAdmin(admin, {
      userId: other.actor.userId,
      isHospitalAdmin: false,
    });
    adapter.ctx = other;
    const before = await events();
    expect(await setHospitalAdminAction(idle, authorityForm())).toMatchObject({
      status: "error",
      message: expect.stringContaining("اجازه"),
    });
    expect(await assignSupervisorAction(idle, assignmentForm())).toMatchObject({
      status: "error",
      message: expect.stringContaining("اجازه"),
    });
    expect(await events()).toEqual(before);
  });
});
