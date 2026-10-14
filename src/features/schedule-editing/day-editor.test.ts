import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { isoDate } from "@/domain/shared/dates";
import type { AssignmentCode } from "@/domain/shifts/shift-type";

import {
  RENAMED_SHIFT_LABELS,
  SHIFT_LABELS,
} from "../../../tests/support/shift-labels";

import { DayEditor, type EditorNurse } from "./day-editor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./actions", () => ({ setAssignmentsAction: vi.fn() }));

const date = isoDate("2026-10-24");
const nurse = (shift: AssignmentCode | null): EditorNurse => ({
  userId: "n1",
  displayName: "سارا نمونه",
  role: "NURSE",
  preference: null,
  shift,
  flagged: false,
});

const render = (shift: AssignmentCode | null, labels = SHIFT_LABELS) =>
  renderToStaticMarkup(
    createElement(DayEditor, {
      scheduleId: "s1",
      revision: 1,
      date,
      dayLabel: "شنبه ۲ آبان ۱۴۰۵",
      nurses: [nurse(shift)],
      rangeEnds: [],
      coverage: [],
      previousDayHref: null,
      nextDayHref: null,
      shiftLabels: labels,
    }),
  );

/** The nurse's assignment group: one button per code (six, H included), in domain order. */
const assignmentButtons = (html: string) => {
  const group = html.slice(html.indexOf('aria-label="شیفت سارا نمونه"'));
  return [
    ...group.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/button>/g),
  ]
    .slice(0, 6)
    .map(([, name, content]) => ({
      name,
      text: content!.replace(/<[^>]+>/g, ""),
    }));
};

describe("DayEditor assignment control", () => {
  it("shows the six codes M | E | N | ME | OFF | H; OFF and H read their codes, not their labels", () => {
    const buttons = assignmentButtons(render(null));
    expect(buttons.map((b) => b.text)).toEqual([
      "M",
      "E",
      "N",
      "ME",
      "OFF",
      "H",
    ]);
    expect(buttons.map((b) => b.text)).not.toContain("استراحت");
    expect(buttons.map((b) => b.text)).not.toContain("مرخصی");
  });

  it("names every button «label (CODE)» from the shift_types labels", () => {
    expect(assignmentButtons(render(null)).map((b) => b.name)).toEqual([
      "صبح (M)",
      "عصر (E)",
      "شب (N)",
      "طولانی (ME)",
      "استراحت (OFF)",
      "مرخصی (H)",
    ]);
  });

  it("follows changed labels in the names without changing the codes", () => {
    const buttons = assignmentButtons(render("OFF", RENAMED_SHIFT_LABELS));
    expect(buttons.map((b) => b.text)).toEqual([
      "M",
      "E",
      "N",
      "ME",
      "OFF",
      "H",
    ]);
    expect(buttons.map((b) => b.name)).toEqual([
      "بامداد (M)",
      "پسین (E)",
      "شبانه (N)",
      "لانگ (ME)",
      "مرخصی‌روز (OFF)",
      "غیبت مجاز (H)",
    ]);
  });

  it.each([
    ["OFF", 4],
    ["H", 5],
  ] as const)(
    "lays %s out like every code: same classes, left-to-right code text, no special case",
    (code, index) => {
      const html = render(code);
      const group = html.slice(html.indexOf('aria-label="شیفت سارا نمونه"'));
      const buttons = [...group.matchAll(/<button[^>]*>.*?<\/button>/g)]
        .slice(0, 6)
        .map(([b]) => b);
      expect(buttons).toHaveLength(6);
      for (const b of buttons) expect(b).toContain('<span dir="ltr">');
      // Only the selected decision is marked pressed.
      buttons.forEach((b, i) =>
        expect(b.includes('aria-pressed="true"')).toBe(i === index),
      );
      // The shared sizing class (phones: flex-1, 44px minimum) applies to all six.
      for (const b of buttons) expect(b).toMatch(/max-sm:flex-1/);
    },
  );
});

describe("DayEditor role badge", () => {
  const roster: EditorNurse[] = [
    { ...nurse(null), userId: "n1", displayName: "سارا نمونه", role: "NURSE" },
    {
      ...nurse("M"),
      userId: "h1",
      displayName: "مینا سرپرست",
      role: "HEAD_NURSE",
    },
    {
      ...nurse("OFF"),
      userId: "s1",
      displayName: "رضا منشی",
      role: "SECRETARY",
    },
  ];

  /** The badge texts in one nurse's name line (Badge: `rounded-full border`). */
  const badgesOf = (html: string, userId: string) => {
    const row = html.slice(html.indexOf(`data-nurse-row="${userId}"`));
    const nameLine = row.slice(0, row.indexOf("</p>"));
    return [
      ...nameLine.matchAll(
        /<span class="[^"]*\brounded-full border\b[^"]*">([^<]*)<\/span>/g,
      ),
    ].map(([, label]) => label);
  };

  it.each([
    ["n1", "پرستار"],
    ["h1", "سرپرستار"],
    ["s1", "منشی"],
  ] as const)("shows exactly one badge for %s: «%s»", (userId, label) => {
    const html = renderToStaticMarkup(
      createElement(DayEditor, {
        scheduleId: "s1",
        revision: 1,
        date,
        dayLabel: "شنبه ۲ آبان ۱۴۰۵",
        nurses: roster,
        rangeEnds: [],
        coverage: [],
        previousDayHref: null,
        nextDayHref: null,
        shiftLabels: SHIFT_LABELS,
      }),
    );
    expect(badgesOf(html, userId)).toEqual([label]);
  });
});
