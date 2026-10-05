import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ChangeRequestQueueItem } from "@/application/change-requests/queries";
import { isoDate } from "@/domain/shared/dates";
import { QueueList } from "./queue";

it.each([
  [null, "تعیین‌نشده"],
  ["OFF", "استراحت"],
] as const)(
  "request review distinguishes the current decision %s from rest or undecided",
  (current, label) => {
    const item: ChangeRequestQueueItem = {
      id: "request",
      scheduleId: "schedule",
      scheduleLabel: "آبان",
      departmentName: "بخش",
      type: "UNAVAILABLE",
      date: isoDate("2026-10-25"),
      requester: { userId: "nurse", displayName: "پرستار" },
      requesterShift: "M",
      targetShift: null,
      counterpart: null,
      counterpartShift: null,
      reason: { code: "ILLNESS", label: "بیماری", requiresNote: false },
      note: null,
      status: "PENDING",
      consent: null,
      consentAt: null,
      createdAt: new Date("2026-10-01T08:00:00Z"),
      cancelledAt: null,
      rejectedAt: null,
      rejectedBy: null,
      rejection: null,
      rejectionNote: null,
      appliedAt: null,
      appliedBy: null,
      applied: null,
      current: { requester: current, counterpart: null },
    };
    const html = renderToStaticMarkup(
      createElement(QueueList, {
        queue: {
          status: "PENDING",
          counts: { PENDING: 1, APPLIED: 0, REJECTED: 0, CANCELLED: 0 },
          items: [item],
        },
        detailHref: () => "/requests" as const,
      }),
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain(`شیفت فعلی: ${label}`);
    // The requested UNAVAILABLE result is explicit rest in both cases.
    expect(text).toContain("استراحت");
    expect(html).not.toContain("bg-shift-off");
  },
);
