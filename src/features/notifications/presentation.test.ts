import { describe, expect, it } from "vitest";

import type {
  NotificationItem,
  NotificationType,
} from "@/application/notifications/queries";

import { describeNotification, notificationDestination } from "./presentation";

const SCHEDULE_ID = "22222222-2222-4222-8222-222222222222";

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "11111111-1111-4111-8111-111111111111",
  type: "PREFERENCES_OPENED",
  createdAt: new Date("2026-10-01T06:30:00Z"),
  read: false,
  scheduleId: SCHEDULE_ID,
  context: {
    scheduleLabel: "آبان ۱۴۰۵",
    departmentName: "مراقبت‌های ویژه",
    departmentCode: "icu",
  },
  data: {
    label: "آبان ۱۴۰۵",
    firstDate: "2026-10-23",
    lastDate: "2026-11-21",
  },
  ...overrides,
});

const ALL_TYPES: NotificationType[] = [
  "PREFERENCES_OPENED",
  "DATES_REOPENED",
  "SCHEDULE_FINALIZED",
  "SCHEDULE_SUBMITTED",
  "SCHEDULE_APPROVED",
  "SCHEDULE_RETURNED",
  "REVISION_STARTED",
  "CHANGE_REQUEST_SUBMITTED",
  "CHANGE_REQUEST_REVIEWED",
];

describe("describeNotification", () => {
  it("renders PREFERENCES_OPENED in Persian with the Jalali range", () => {
    expect(describeNotification(item())).toEqual({
      title: "ثبت ترجیحات باز شد",
      message:
        "می‌توانید ترجیحات شیفت خود را برای «آبان ۱۴۰۵» (۱ تا ۳۰ آبان ۱۴۰۵) ثبت کنید.",
      context: "مراقبت‌های ویژه · آبان ۱۴۰۵",
      destination: `/preferences?schedule=${SCHEDULE_ID}`,
    });
  });

  it("never shows ISO dates or ids", () => {
    const view = describeNotification(item());
    const text = `${view.title} ${view.message} ${view.context}`;
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toContain(SCHEDULE_ID);
  });

  it("falls back to the stored label when the schedule is gone", () => {
    const view = describeNotification(item({ context: null }));
    expect(view.context).toBe("آبان ۱۴۰۵");
    expect(view.message).toContain("«آبان ۱۴۰۵»");
  });

  it("tolerates missing or malformed data", () => {
    const view = describeNotification(
      item({
        context: null,
        scheduleId: null,
        data: { firstDate: "2026-02-30", lastDate: 5, label: "  " },
      }),
    );
    expect(view).toEqual({
      title: "ثبت ترجیحات باز شد",
      message: "می‌توانید ترجیحات شیفت خود را برای برنامه ماه آینده ثبت کنید.",
      context: null,
      destination: "/preferences",
    });
  });

  it("ignores a reversed date range", () => {
    const view = describeNotification(
      item({ data: { firstDate: "2026-11-21", lastDate: "2026-10-23" } }),
    );
    expect(view.message).not.toContain("(");
  });

  it.each(ALL_TYPES)("has Persian wording for %s", (type) => {
    for (const context of [item().context, null]) {
      const view = describeNotification(
        item({ type, context, data: context ? item().data : {} }),
      );
      expect(view.title).toMatch(/[؀-ۿ]/);
      expect(view.message).toMatch(/[؀-ۿ]/);
    }
  });

  it("renders DATES_REOPENED with and without a range", () => {
    expect(describeNotification(item({ type: "DATES_REOPENED" })).message).toBe(
      "ثبت ترجیحات برای ۱ تا ۳۰ آبان ۱۴۰۵ در «آبان ۱۴۰۵» دوباره باز شد.",
    );
    expect(
      describeNotification(item({ type: "DATES_REOPENED", data: {} })).message,
    ).toBe("ثبت ترجیحات برای بخشی از «آبان ۱۴۰۵» دوباره باز شد.");
  });

  it("has a generic fallback for a type it does not know", () => {
    expect(
      describeNotification(item({ type: "SOMETHING_NEW" as NotificationType })),
    ).toMatchObject({ title: "اعلان", destination: null });
  });
});

describe("notificationDestination", () => {
  it("sends PREFERENCES_OPENED to /preferences, keeping the schedule", () => {
    expect(
      notificationDestination({
        type: "PREFERENCES_OPENED",
        scheduleId: SCHEDULE_ID,
      }),
    ).toBe(`/preferences?schedule=${SCHEDULE_ID}`);
    expect(
      notificationDestination({ type: "PREFERENCES_OPENED", scheduleId: null }),
    ).toBe("/preferences");
  });

  it("routes only types that are created today", () => {
    const routed = ALL_TYPES.filter(
      (type) =>
        notificationDestination({
          type,
          scheduleId: SCHEDULE_ID,
          departmentCode: "icu",
        }) !== null,
    );
    expect(routed).toEqual([
      "PREFERENCES_OPENED",
      "DATES_REOPENED",
      "SCHEDULE_SUBMITTED",
      "SCHEDULE_APPROVED",
      "SCHEDULE_RETURNED",
    ]);
  });

  it("sends SCHEDULE_SUBMITTED to the Supervisor's review of the schedule", () => {
    expect(
      notificationDestination({
        type: "SCHEDULE_SUBMITTED",
        scheduleId: SCHEDULE_ID,
      }),
    ).toBe(`/review/${SCHEDULE_ID}`);
    expect(
      notificationDestination({ type: "SCHEDULE_SUBMITTED", scheduleId: null }),
    ).toBe("/review");
  });

  it.each(["SCHEDULE_APPROVED", "SCHEDULE_RETURNED"] as const)(
    "sends %s to the Head Nurse's schedule page of that schedule",
    (type) => {
      expect(
        notificationDestination({
          type,
          scheduleId: SCHEDULE_ID,
          departmentCode: "icu",
        }),
      ).toBe(`/departments/icu/schedule?schedule=${SCHEDULE_ID}`);
      // Without a known department (schedule gone) it only marks read.
      expect(
        notificationDestination({ type, scheduleId: SCHEDULE_ID }),
      ).toBeNull();
      expect(
        notificationDestination({
          type,
          scheduleId: null,
          departmentCode: "icu",
        }),
      ).toBeNull();
    },
  );

  it("uses the department from the notification's context", () => {
    expect(
      describeNotification(item({ type: "SCHEDULE_RETURNED" })).destination,
    ).toBe(`/departments/icu/schedule?schedule=${SCHEDULE_ID}`);
    expect(
      describeNotification(item({ type: "SCHEDULE_RETURNED" })).message,
    ).toContain("توضیح");
  });

  it("always produces a same-site path", () => {
    for (const type of ALL_TYPES) {
      const path = notificationDestination({
        type,
        scheduleId: "//evil.example/x?y",
        departmentCode: "//evil.example",
      });
      if (path) {
        expect(path).toMatch(/^\/(preferences|review|departments)[/?]/);
        expect(path).not.toContain("//");
      }
    }
  });
});
