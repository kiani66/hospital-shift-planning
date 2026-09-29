import { describe, expect, it } from "vitest";

import {
  DEMO_ICU,
  DEMO_SCHEDULE,
  DEMO_USERS,
} from "../../src/infrastructure/db/seed/demo-data";
import {
  listAuditEventsForSchedule,
  recordAuditEvent,
  redactSensitive,
} from "../../src/infrastructure/repositories/audit";
import {
  countUnreadNotifications,
  insertNotifications,
  listNotificationsForRecipient,
  markNotificationRead,
} from "../../src/infrastructure/repositories/notifications";
import { setupTestDatabase } from "./support/database";

const { db } = setupTestDatabase();
const U = DEMO_USERS;
const S = DEMO_SCHEDULE.id;

describe("notifications", () => {
  it("writes in-app rows and lists them newest first", async () => {
    expect(
      await insertNotifications(db, [
        {
          recipientId: U.icuNurse1.id,
          type: "PREFERENCES_OPENED",
          scheduleId: S,
          data: { label: "آبان ۱۴۰۵" },
        },
        { recipientId: U.icuNurse1.id, type: "DATES_REOPENED", scheduleId: S },
        {
          recipientId: U.icuNurse2.id,
          type: "PREFERENCES_OPENED",
          scheduleId: S,
        },
      ]),
    ).toBe(3);
    const mine = await listNotificationsForRecipient(db, U.icuNurse1.id);
    expect(mine).toHaveLength(2);
    expect(mine.find((n) => n.type === "PREFERENCES_OPENED")?.data).toEqual({
      label: "آبان ۱۴۰۵",
    });
    expect(mine.find((n) => n.type === "DATES_REOPENED")?.data).toEqual({});
  });

  it("does nothing for an empty batch", async () => {
    expect(await insertNotifications(db, [])).toBe(0);
  });

  it("tracks unread and marks only the recipient's own notification as read", async () => {
    await insertNotifications(db, [
      {
        recipientId: U.icuNurse1.id,
        type: "SCHEDULE_FINALIZED",
        scheduleId: S,
      },
    ]);
    const [n] = await listNotificationsForRecipient(db, U.icuNurse1.id, {
      unreadOnly: true,
    });
    expect(await countUnreadNotifications(db, U.icuNurse1.id)).toBe(1);

    expect(
      await markNotificationRead(db, {
        id: n!.id,
        recipientId: U.icuNurse2.id,
        now: new Date(),
      }),
    ).toBe(false);
    expect(
      await markNotificationRead(db, {
        id: n!.id,
        recipientId: U.icuNurse1.id,
        now: new Date(),
      }),
    ).toBe(true);
    expect(
      await markNotificationRead(db, {
        id: n!.id,
        recipientId: U.icuNurse1.id,
        now: new Date(),
      }),
    ).toBe(false);
    expect(await countUnreadNotifications(db, U.icuNurse1.id)).toBe(0);
    expect(
      await listNotificationsForRecipient(db, U.icuNurse1.id, {
        unreadOnly: true,
      }),
    ).toEqual([]);
  });

  it("rejects unknown recipients and types", async () => {
    await expect(
      insertNotifications(db, [
        {
          recipientId: "99999999-0000-4000-8000-000000000000",
          type: "SCHEDULE_APPROVED",
        },
      ]),
    ).rejects.toThrow();
    await expect(
      insertNotifications(db, [
        { recipientId: U.icuNurse1.id, type: "NOPE" as "SCHEDULE_APPROVED" },
      ]),
    ).rejects.toThrow();
  });
});

describe("audit events", () => {
  it("appends events in order with actor, action, entity and data", async () => {
    await recordAuditEvent(db, {
      actorId: U.icuHead.id,
      action: "schedule.created",
      entityType: "schedule",
      entityId: S,
      departmentId: DEMO_ICU.id,
      scheduleId: S,
      data: { period: { start: "2026-10-23", end: "2026-11-21" } },
    });
    await recordAuditEvent(db, {
      actorId: U.icuHead.id,
      action: "assignment.set",
      entityType: "assignment",
      scheduleId: S,
      data: { before: null, after: "N" },
      reason: "Coverage",
    });
    const events = await listAuditEventsForSchedule(db, S);
    expect(events.map((e) => e.action)).toEqual([
      "schedule.created",
      "assignment.set",
    ]);
    expect(events[1]).toMatchObject({
      actorId: U.icuHead.id,
      entityId: null,
      reason: "Coverage",
      data: { before: null, after: "N" },
    });
    expect(events[0]!.id).toBeLessThan(events[1]!.id);
  });

  it("redacts sensitive-looking keys before storing", async () => {
    await recordAuditEvent(db, {
      actorId: U.supervisor.id,
      action: "user.updated",
      entityType: "user",
      scheduleId: S,
      data: {
        displayName: "x",
        passwordHash: "argon2id$...",
        nested: [{ apiToken: "t", ok: 1 }],
      },
    });
    const [event] = await listAuditEventsForSchedule(db, S);
    expect(event?.data).toEqual({
      displayName: "x",
      passwordHash: "[redacted]",
      nested: [{ apiToken: "[redacted]", ok: 1 }],
    });
  });

  it("redactSensitive leaves plain values and dates alone", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(redactSensitive({ at, n: 1, s: "a", none: null })).toEqual({
      at,
      n: 1,
      s: "a",
      none: null,
    });
    expect(redactSensitive("secret")).toBe("secret");
  });
});
