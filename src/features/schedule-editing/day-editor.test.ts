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

/** The nurse's assignment group: one button per code, in domain order. */
const assignmentButtons = (html: string) => {
  const group = html.slice(html.indexOf('aria-label="شیفت سارا نمونه"'));
  return [
    ...group.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*>(.*?)<\/button>/g),
  ]
    .slice(0, 5)
    .map(([, name, content]) => ({
      name,
      text: content!.replace(/<[^>]+>/g, ""),
    }));
};

describe("DayEditor assignment control", () => {
  it("shows the five codes M | E | N | ME | OFF; OFF reads «OFF», not its label", () => {
    const buttons = assignmentButtons(render(null));
    expect(buttons.map((b) => b.text)).toEqual(["M", "E", "N", "ME", "OFF"]);
    expect(buttons.map((b) => b.text)).not.toContain("استراحت");
  });

  it("names every button «label (CODE)» from the shift_types labels", () => {
    expect(assignmentButtons(render(null)).map((b) => b.name)).toEqual([
      "صبح (M)",
      "عصر (E)",
      "شب (N)",
      "طولانی (ME)",
      "استراحت (OFF)",
    ]);
  });

  it("follows changed labels in the names without changing the codes", () => {
    const buttons = assignmentButtons(render("OFF", RENAMED_SHIFT_LABELS));
    expect(buttons.map((b) => b.text)).toEqual(["M", "E", "N", "ME", "OFF"]);
    expect(buttons.map((b) => b.name)).toEqual([
      "بامداد (M)",
      "پسین (E)",
      "شبانه (N)",
      "لانگ (ME)",
      "مرخصی‌روز (OFF)",
    ]);
  });

  it("lays OFF out like every code: same classes, left-to-right code text, no special case", () => {
    const html = render("OFF");
    const group = html.slice(html.indexOf('aria-label="شیفت سارا نمونه"'));
    const buttons = [...group.matchAll(/<button[^>]*>.*?<\/button>/g)]
      .slice(0, 5)
      .map(([b]) => b);
    expect(buttons).toHaveLength(5);
    for (const b of buttons) expect(b).toContain('<span dir="ltr">');
    // The selected OFF button is marked pressed; the others are not.
    expect(buttons[4]).toContain('aria-pressed="true"');
    expect(buttons.slice(0, 4).join("")).not.toContain('aria-pressed="true"');
    // The shared sizing class (phones: flex-1, 44px minimum) applies to all five.
    for (const b of buttons) expect(b).toMatch(/max-sm:flex-1/);
  });
});
