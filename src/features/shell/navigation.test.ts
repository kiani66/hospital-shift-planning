import { describe, expect, it } from "vitest";

import type { ShellContext } from "@/application/workspace/queries";

import {
  badgeLabel,
  buildNavigation,
  formatBadgeCount,
  homePath,
  MAX_PRIMARY,
} from "./navigation";

const ICU = { id: "d1", code: "icu", name: "ICU" };
const ER = { id: "d2", code: "er", name: "ER" };

type Ctx = Pick<ShellContext, "memberships" | "supervised"> &
  Partial<Pick<ShellContext, "unreadNotifications">>;
const nurse: Ctx = {
  memberships: [{ department: ICU, role: "NURSE" }],
  supervised: [],
};
const headNurse: Ctx = {
  memberships: [{ department: ICU, role: "HEAD_NURSE" }],
  supervised: [],
};
const supervisor: Ctx = { memberships: [], supervised: [ICU, ER] };
const nobody: Ctx = { memberships: [], supervised: [] };

const labels = (items: readonly { label: string }[]) =>
  items.map((i) => i.label);
const allItems = (ctx: Ctx) =>
  buildNavigation(ctx).sections.flatMap((s) => s.items);

describe("homePath", () => {
  it.each<[string, Ctx, string]>([
    ["a nurse", nurse, "/my-shifts"],
    ["a Head Nurse", headNurse, "/home"],
    ["a supervisor only", supervisor, "/review"],
    [
      "a nurse who also supervises",
      { memberships: nurse.memberships, supervised: [ER] },
      "/home",
    ],
    ["someone with no current relation (former nurse)", nobody, "/my-shifts"],
  ])("sends %s to %s", (_, ctx, path) => {
    expect(homePath(ctx)).toBe(path);
  });
});

describe("buildNavigation", () => {
  it("gives a nurse the personal pages and nothing department-wide", () => {
    const nav = buildNavigation(nurse);
    expect(labels(nav.primary)).toEqual([
      "شیفت‌های من",
      "ترجیحات",
      "درخواست‌ها",
      "اعلان‌ها",
    ]);
    expect(allItems(nurse).map((i) => i.href)).toEqual([
      "/my-shifts",
      "/preferences",
      "/requests",
      "/notifications",
    ]);
  });

  it("gives a Head Nurse the nurse pages plus their department's pages", () => {
    const nav = buildNavigation(headNurse);
    // The department's request queue replaces history on the phone bar.
    expect(labels(nav.primary)).toEqual([
      "شیفت‌های من",
      "برنامه بخش",
      "درخواست‌های بخش",
      "درخواست‌ها",
      "بیشتر",
    ]);
    expect(nav.sections.map((s) => s.title)).toEqual([
      null,
      "کارهای من",
      "ICU",
    ]);
    expect(allItems(headNurse).map((i) => i.href)).toEqual([
      "/home",
      "/my-shifts",
      "/preferences",
      "/requests",
      "/notifications",
      "/departments/icu/schedule",
      "/departments/icu/requests",
      "/departments/icu/history",
    ]);
  });

  it("gives a supervisor review pages only", () => {
    const nav = buildNavigation(supervisor);
    expect(labels(nav.primary)).toEqual(["بررسی برنامه‌ها", "اعلان‌ها"]);
    expect(allItems(supervisor).map((i) => i.href)).toEqual([
      "/review",
      "/notifications",
    ]);
  });

  it("names each department for a Head Nurse of several", () => {
    const ctx: Ctx = {
      memberships: [
        { department: ER, role: "HEAD_NURSE" },
        { department: ICU, role: "HEAD_NURSE" },
      ],
      supervised: [],
    };
    const hrefs = allItems(ctx).map((i) => i.href);
    expect(hrefs).toContain("/departments/er/schedule");
    expect(hrefs).toContain("/departments/icu/history");
    expect(labels(allItems(ctx))).toContain("برنامه بخش (ICU)");
  });

  it("combines capabilities across departments without duplicates", () => {
    const ctx: Ctx = {
      memberships: [
        { department: ICU, role: "HEAD_NURSE" },
        { department: ER, role: "NURSE" },
      ],
      supervised: [ER],
    };
    const nav = buildNavigation(ctx);
    const ids = allItems(ctx).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("review");
    expect(nav.primary).toHaveLength(MAX_PRIMARY);
    expect(nav.primary.at(-1)?.href).toBe("/more");
  });

  it("never exceeds the bottom-bar limit and links every hidden item via 'more'", () => {
    for (const ctx of [nurse, headNurse, supervisor, nobody]) {
      const nav = buildNavigation(ctx);
      expect(nav.primary.length).toBeLessThanOrEqual(MAX_PRIMARY);
      const shown = new Set(nav.primary.map((i) => i.id));
      const hidden = allItems(ctx).some((i) => !shown.has(i.id));
      expect(shown.has("more")).toBe(hidden);
    }
  });

  it("encodes department codes in URLs", () => {
    const ctx: Ctx = {
      memberships: [
        { department: { id: "x", code: "a b", name: "A" }, role: "HEAD_NURSE" },
      ],
      supervised: [],
    };
    expect(allItems(ctx).map((i) => i.href)).toContain(
      "/departments/a%20b/schedule",
    );
  });
});

describe("unread badge", () => {
  const badges = (items: readonly { id: string; badge?: number }[]) =>
    items.filter((i) => i.badge !== undefined).map((i) => [i.id, i.badge]);

  it("adds no badge at zero or without a count", () => {
    for (const unread of [0, undefined]) {
      const nav = buildNavigation({ ...nurse, unreadNotifications: unread });
      expect(badges(nav.primary)).toEqual([]);
      expect(badges(nav.sections.flatMap((s) => s.items))).toEqual([]);
    }
  });

  it("puts the count on the notifications item (sidebar and bottom bar)", () => {
    const nav = buildNavigation({ ...nurse, unreadNotifications: 3 });
    expect(badges(nav.primary)).toEqual([["notifications", 3]]);
    expect(badges(nav.sections.flatMap((s) => s.items))).toEqual([
      ["notifications", 3],
    ]);
  });

  it("puts it on 'more' when notifications do not fit the bottom bar", () => {
    const nav = buildNavigation({ ...headNurse, unreadNotifications: 2 });
    expect(nav.primary.some((i) => i.id === "notifications")).toBe(false);
    expect(badges(nav.primary)).toEqual([["more", 2]]);
    expect(badges(nav.sections.flatMap((s) => s.items))).toEqual([
      ["notifications", 2],
    ]);
  });

  it("marks the supervisor's notifications item", () => {
    const nav = buildNavigation({ ...supervisor, unreadNotifications: 1 });
    expect(badges(nav.primary)).toEqual([["notifications", 1]]);
  });
});

describe("formatBadgeCount", () => {
  it.each<[number, string | null]>([
    [0, null],
    [-1, null],
    [Number.NaN, null],
    [1, "۱"],
    [42, "۴۲"],
    [99, "۹۹"],
    [100, "۹۹+"],
    [12345, "۹۹+"],
  ])("%d → %s", (count, text) => {
    expect(formatBadgeCount(count)).toBe(text);
  });

  it("describes the count for screen readers", () => {
    expect(badgeLabel(1234)).toBe("۱٬۲۳۴ اعلان خوانده‌نشده");
  });
});
