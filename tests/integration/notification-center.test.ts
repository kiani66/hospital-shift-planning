import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "../../src/domain/authz/actor";
import { isoDate } from "../../src/domain/shared/dates";
import { encodeNotificationCursor } from "../../src/application/notifications/cursor";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "../../src/application/notifications/commands";
import {
  getUnreadNotificationCount,
  listNotifications,
  NOTIFICATION_PAGE_SIZE,
  type NotificationItem,
} from "../../src/application/notifications/queries";
import { openPreferenceWindow } from "../../src/application/schedules/preference-windows";
import type { AppContext } from "../../src/application/use-case";
import { getShellContext } from "../../src/application/workspace/queries";
import { notifications } from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import { listAuditEventsForSchedule } from "../../src/infrastructure/repositories/audit";
import {
  endMembership,
  loadActor,
} from "../../src/infrastructure/repositories/memberships";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;
const TODAY = isoDate("2026-10-01");
const NOW = new Date("2026-10-01T06:30:00Z");
const UNKNOWN_ID = "99999999-0000-4000-8000-000000000000";

const actors = {} as Record<
  "icuHead" | "nurse1" | "nurse2" | "supervisor" | "inactive",
  Actor
>;
const as = (actor: Actor, at: Date = NOW): AppContext => ({
  db,
  actor,
  clock: () => at,
});

beforeEach(async () => {
  actors.icuHead = (await loadActor(db, U.icuHead.id, TODAY))!;
  actors.nurse1 = (await loadActor(db, U.icuNurse1.id, TODAY))!;
  actors.nurse2 = (await loadActor(db, U.icuNurse2.id, TODAY))!;
  actors.supervisor = (await loadActor(db, U.supervisor.id, TODAY))!;
  actors.inactive = (await loadActor(db, U.inactiveNurse.id, TODAY))!;
});

/** Inserts notifications with explicit creation times (ISO strings with microseconds allowed). */
async function seedNotifications(
  rows: {
    recipientId: string;
    createdAt: string;
    read?: boolean;
    type?: "PREFERENCES_OPENED" | "SCHEDULE_APPROVED";
  }[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const row of rows) {
    const [inserted] = await db
      .insert(notifications)
      .values({
        recipientId: row.recipientId,
        type: row.type ?? "PREFERENCES_OPENED",
        scheduleId: S,
        data: { label: DEMO_SCHEDULE.label },
        createdAt: sql`${row.createdAt}::timestamptz`,
        readAt: row.read ? new Date("2026-09-01T00:00:00Z") : null,
      })
      .returning({ id: notifications.id });
    ids.push(inserted!.id);
  }
  return ids;
}

/** `n` notifications for one recipient, one minute apart (index 0 oldest). */
const minutes = (recipientId: string, n: number) =>
  seedNotifications(
    Array.from({ length: n }, (_, i) => ({
      recipientId,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
    })),
  );

async function listAll(
  ctx: AppContext,
  filter: "all" | "unread",
  limit?: number,
): Promise<NotificationItem[]> {
  const items: NotificationItem[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await listNotifications(ctx, { filter, cursor, limit });
    items.push(...page.items);
    if (!page.nextCursor) return items;
    cursor = page.nextCursor;
  }
  throw new Error("pagination did not terminate");
}

const readAtOf = async (id: string) => {
  const [row] = await db
    .select({ readAt: notifications.readAt })
    .from(notifications)
    .where(eq(notifications.id, id));
  return row?.readAt ?? null;
};

describe("listing", () => {
  it("lists only the actor's own notifications", async () => {
    const mine = await minutes(U.icuNurse1.id, 2);
    const theirs = await minutes(U.icuNurse2.id, 3);
    const page = await listNotifications(as(actors.nurse1), { filter: "all" });
    expect(page.items.map((n) => n.id).sort()).toEqual([...mine].sort());
    expect(page.items.some((n) => theirs.includes(n.id))).toBe(false);
  });

  it("never shows another user's notifications, whatever their role", async () => {
    await minutes(U.icuNurse1.id, 3);
    for (const actor of [actors.icuHead, actors.supervisor, actors.nurse2]) {
      const page = await listNotifications(as(actor), { filter: "all" });
      expect(page.items).toEqual([]);
    }
  });

  it("orders newest first, with the id as the tie-breaker", async () => {
    const ids = await seedNotifications([
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-01T10:00:00Z" },
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-03T10:00:00Z" },
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-02T10:00:00Z" },
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-02T10:00:00Z" },
    ]);
    const { items } = await listNotifications(as(actors.nurse1), {
      filter: "all",
    });
    const tied = [ids[2]!, ids[3]!].sort().reverse();
    expect(items.map((n) => n.id)).toEqual([ids[1], ...tied, ids[0]]);
  });

  it("carries the schedule's department and label for display", async () => {
    await minutes(U.icuNurse1.id, 1);
    const [item] = (
      await listNotifications(as(actors.nurse1), { filter: "all" })
    ).items;
    expect(item).toMatchObject({
      type: "PREFERENCES_OPENED",
      read: false,
      scheduleId: S,
      context: {
        scheduleLabel: DEMO_SCHEDULE.label,
        departmentName: DEMO_ICU.name,
      },
      data: { label: DEMO_SCHEDULE.label },
    });
  });

  it("filters unread notifications", async () => {
    const [read, unread] = await seedNotifications([
      {
        recipientId: U.icuNurse1.id,
        createdAt: "2026-09-01T10:00:00Z",
        read: true,
      },
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-02T10:00:00Z" },
    ]);
    const all = await listNotifications(as(actors.nurse1), { filter: "all" });
    const onlyUnread = await listNotifications(as(actors.nurse1), {
      filter: "unread",
    });
    expect(all.items.map((n) => [n.id, n.read])).toEqual([
      [unread, false],
      [read, true],
    ]);
    expect(onlyUnread.items.map((n) => n.id)).toEqual([unread]);
  });

  it("returns an empty first page without a cursor for a user with none", async () => {
    expect(
      await listNotifications(as(actors.nurse1), { filter: "all" }),
    ).toEqual({ items: [], nextCursor: null, invalidCursor: false });
  });

  it("denies a deactivated actor", async () => {
    await minutes(U.inactiveNurse.id, 1);
    expect(actors.inactive.isActive).toBe(false);
    await expect(
      listNotifications(as(actors.inactive), { filter: "all" }),
    ).rejects.toMatchObject({ reason: "ACTOR_INACTIVE" });
    await expect(
      getUnreadNotificationCount(as(actors.inactive)),
    ).rejects.toMatchObject({ reason: "ACTOR_INACTIVE" });
  });

  it("keeps a former member's own notifications (D16)", async () => {
    await minutes(U.icuNurse1.id, 1);
    await endMembership(db, {
      userId: U.icuNurse1.id,
      departmentId: DEMO_ICU.id,
      endedOn: isoDate("2026-09-30"),
    });
    const former = (await loadActor(db, U.icuNurse1.id, TODAY))!;
    expect(former.memberships).toEqual([]);
    expect(
      (await listNotifications(as(former), { filter: "all" })).items,
    ).toHaveLength(1);
  });
});

describe("pagination", () => {
  it("pages 25 at a time and visits every notification exactly once", async () => {
    const ids = await minutes(U.icuNurse1.id, 60);
    const first = await listNotifications(as(actors.nurse1), { filter: "all" });
    expect(first.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const all = await listAll(as(actors.nurse1), "all");
    expect(all.map((n) => n.id)).toEqual([...ids].reverse());
  });

  it("is stable when new notifications arrive between pages", async () => {
    const ids = await minutes(U.icuNurse1.id, 30);
    const first = await listNotifications(as(actors.nurse1), { filter: "all" });
    await seedNotifications([
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-30T00:00:00Z" },
    ]);
    const second = await listNotifications(as(actors.nurse1), {
      filter: "all",
      cursor: first.nextCursor!,
    });
    expect([...first.items, ...second.items].map((n) => n.id)).toEqual(
      [...ids].reverse(),
    );
    expect(second.nextCursor).toBeNull();
  });

  it("is stable under the unread filter while items are marked read", async () => {
    const ids = await minutes(U.icuNurse1.id, 30);
    const first = await listNotifications(as(actors.nurse1), {
      filter: "unread",
    });
    for (const item of first.items)
      await markNotificationRead(as(actors.nurse1), {
        notificationId: item.id,
      });
    const second = await listNotifications(as(actors.nurse1), {
      filter: "unread",
      cursor: first.nextCursor!,
    });
    expect(second.items.map((n) => n.id)).toEqual(ids.slice(0, 5).reverse());
  });

  it("does not skip rows created within the same millisecond", async () => {
    // Microsecond timestamps a JS Date would collapse into one millisecond.
    const ids = await seedNotifications(
      [100, 200, 300, 400, 500].map((us) => ({
        recipientId: U.icuNurse1.id,
        createdAt: `2026-09-01T10:00:00.000${us}Z`,
      })),
    );
    const all = await listAll(as(actors.nurse1), "all", 2);
    expect(all.map((n) => n.id)).toEqual([...ids].reverse());
  });

  it("does not skip rows sharing one timestamp (one transaction)", async () => {
    const ids = await seedNotifications(
      Array.from({ length: 7 }, () => ({
        recipientId: U.icuNurse1.id,
        createdAt: "2026-09-01T10:00:00Z",
      })),
    );
    const all = await listAll(as(actors.nurse1), "all", 3);
    expect(all.map((n) => n.id)).toEqual([...ids].sort().reverse());
  });

  it("clamps the page size", async () => {
    await minutes(U.icuNurse1.id, 3);
    const page = await listNotifications(as(actors.nurse1), {
      filter: "all",
      limit: 0,
    });
    expect(page.items).toHaveLength(1);
  });

  it("falls back to the first page for a malformed cursor", async () => {
    const ids = await minutes(U.icuNurse1.id, 2);
    for (const cursor of ["not a cursor", "Zm9v", "x".repeat(300)]) {
      const page = await listNotifications(as(actors.nurse1), {
        filter: "all",
        cursor,
      });
      expect(page.invalidCursor).toBe(true);
      expect(page.items.map((n) => n.id)).toEqual([...ids].reverse());
    }
  });

  it("a cursor made from another user's notification reveals nothing", async () => {
    const [theirs] = await minutes(U.icuNurse2.id, 1);
    const cursor = encodeNotificationCursor({
      createdAt: "2099-01-01T00:00:00.000000Z",
      id: theirs!,
    });
    const page = await listNotifications(as(actors.nurse1), {
      filter: "all",
      cursor,
    });
    expect(page.items).toEqual([]);
  });
});

describe("unread count", () => {
  it("counts only the actor's unread notifications", async () => {
    await seedNotifications([
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-01T10:00:00Z" },
      { recipientId: U.icuNurse1.id, createdAt: "2026-09-02T10:00:00Z" },
      {
        recipientId: U.icuNurse1.id,
        createdAt: "2026-09-03T10:00:00Z",
        read: true,
      },
      { recipientId: U.icuNurse2.id, createdAt: "2026-09-02T10:00:00Z" },
    ]);
    expect(await getUnreadNotificationCount(as(actors.nurse1))).toBe(2);
    expect(await getUnreadNotificationCount(as(actors.nurse2))).toBe(1);
    expect(await getUnreadNotificationCount(as(actors.icuHead))).toBe(0);
  });

  it("is part of the shell context and drops to zero after reading", async () => {
    const [id] = await minutes(U.icuNurse1.id, 1);
    expect((await getShellContext(as(actors.nurse1))).unreadNotifications).toBe(
      1,
    );
    await markNotificationRead(as(actors.nurse1), { notificationId: id! });
    expect((await getShellContext(as(actors.nurse1))).unreadNotifications).toBe(
      0,
    );
  });
});

describe("markNotificationRead", () => {
  it("marks the actor's own notification read and reports what it was", async () => {
    const [id] = await minutes(U.icuNurse1.id, 1);
    const result = await markNotificationRead(as(actors.nurse1), {
      notificationId: id!,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id,
        type: "PREFERENCES_OPENED",
        scheduleId: S,
        changed: true,
      },
    });
    expect(await readAtOf(id!)).toEqual(NOW);
    expect(await getUnreadNotificationCount(as(actors.nurse1))).toBe(0);
  });

  it("is idempotent and keeps the first read time", async () => {
    const [id] = await minutes(U.icuNurse1.id, 1);
    await markNotificationRead(as(actors.nurse1), { notificationId: id! });
    const later = new Date("2026-10-02T00:00:00Z");
    const again = await markNotificationRead(as(actors.nurse1, later), {
      notificationId: id!,
    });
    expect(again).toMatchObject({ ok: true, data: { id, changed: false } });
    expect(await readAtOf(id!)).toEqual(NOW);
  });

  it("resolves concurrent calls to one change and no errors", async () => {
    const [id] = await minutes(U.icuNurse1.id, 1);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        markNotificationRead(as(actors.nurse1), { notificationId: id! }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(
      results.filter((r) => r.ok && r.data.changed).map((r) => r.ok),
    ).toHaveLength(1);
  });

  it("cannot mark another user's notification, and says only NOT_FOUND", async () => {
    const [theirs] = await minutes(U.icuNurse2.id, 1);
    for (const actor of [actors.nurse1, actors.icuHead, actors.supervisor]) {
      const result = await markNotificationRead(as(actor), {
        notificationId: theirs!,
      });
      expect(result).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", message: "Notification not found" },
      });
    }
    expect(await readAtOf(theirs!)).toBeNull();
  });

  it("answers an unknown id exactly like a foreign one", async () => {
    const [theirs] = await minutes(U.icuNurse2.id, 1);
    const foreign = await markNotificationRead(as(actors.nurse1), {
      notificationId: theirs!,
    });
    const unknown = await markNotificationRead(as(actors.nurse1), {
      notificationId: UNKNOWN_ID,
    });
    expect(unknown).toEqual(foreign);
  });

  it("rejects a malformed id before touching the database", async () => {
    expect(
      await markNotificationRead(as(actors.nurse1), {
        notificationId: "1 or 1=1",
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(
      await markNotificationRead(as(actors.nurse1), {
        notificationId: "x",
        recipientId: U.icuNurse2.id,
      }),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("ignores a recipient id sent by the caller", async () => {
    const [theirs] = await minutes(U.icuNurse2.id, 1);
    const result = await markNotificationRead(as(actors.nurse1), {
      notificationId: theirs!,
      recipientId: U.icuNurse2.id,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await readAtOf(theirs!)).toBeNull();
  });

  it("denies a deactivated actor", async () => {
    const [id] = await minutes(U.inactiveNurse.id, 1);
    expect(
      await markNotificationRead(as(actors.inactive), { notificationId: id! }),
    ).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN", reason: "ACTOR_INACTIVE" },
    });
    expect(await readAtOf(id!)).toBeNull();
  });

  it("writes no audit event", async () => {
    const [id] = await minutes(U.icuNurse1.id, 1);
    await markNotificationRead(as(actors.nurse1), { notificationId: id! });
    await markAllNotificationsRead(as(actors.nurse1), {});
    expect(await listAuditEventsForSchedule(db, S)).toEqual([]);
  });
});

describe("markAllNotificationsRead", () => {
  it("marks every unread notification of the actor and only theirs", async () => {
    await minutes(U.icuNurse1.id, 4);
    const [theirs] = await minutes(U.icuNurse2.id, 1);
    await seedNotifications([
      {
        recipientId: U.icuNurse1.id,
        createdAt: "2026-09-10T00:00:00Z",
        read: true,
      },
    ]);
    expect(await markAllNotificationsRead(as(actors.nurse1), {})).toEqual({
      ok: true,
      data: { changed: 4 },
    });
    expect(await getUnreadNotificationCount(as(actors.nurse1))).toBe(0);
    expect(await getUnreadNotificationCount(as(actors.nurse2))).toBe(1);
    expect(await readAtOf(theirs!)).toBeNull();
  });

  it("is safe to repeat and to run concurrently", async () => {
    await minutes(U.icuNurse1.id, 10);
    const results = await Promise.all([
      markAllNotificationsRead(as(actors.nurse1), {}),
      markAllNotificationsRead(as(actors.nurse1), {}),
      markAllNotificationsRead(as(actors.nurse1), {}),
    ]);
    const changed = results.map((r) => (r.ok ? r.data.changed : -1));
    expect(changed.reduce((a, b) => a + b, 0)).toBe(10);
    expect(await markAllNotificationsRead(as(actors.nurse1), {})).toEqual({
      ok: true,
      data: { changed: 0 },
    });
  });

  it("denies a deactivated actor", async () => {
    await minutes(U.inactiveNurse.id, 1);
    expect(
      await markAllNotificationsRead(as(actors.inactive), {}),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("with Phase 4 notifications", () => {
  it("shows PREFERENCES_OPENED to the roster nurses and not to the Head Nurse", async () => {
    const opened = await openPreferenceWindow(as(actors.icuHead), {
      scheduleId: S,
      expectedRevision: 0,
    });
    expect(opened.ok).toBe(true);

    const [item] = (
      await listNotifications(as(actors.nurse1), { filter: "unread" })
    ).items;
    expect(item).toMatchObject({
      type: "PREFERENCES_OPENED",
      scheduleId: S,
      read: false,
      context: {
        scheduleLabel: DEMO_SCHEDULE.label,
        departmentName: DEMO_ICU.name,
      },
      data: {
        label: DEMO_SCHEDULE.label,
        firstDate: DEMO_SCHEDULE.periodStart,
        lastDate: DEMO_SCHEDULE.periodEnd,
      },
    });
    expect(await getUnreadNotificationCount(as(actors.icuHead))).toBe(0);

    await markNotificationRead(as(actors.nurse1), { notificationId: item!.id });
    expect(await getUnreadNotificationCount(as(actors.nurse1))).toBe(0);
    // Another nurse's copy is untouched.
    expect(await getUnreadNotificationCount(as(actors.nurse2))).toBe(1);
  });
});
