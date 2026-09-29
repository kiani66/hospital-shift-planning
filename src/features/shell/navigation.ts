import type { Route } from "next";

import type { ShellContext } from "@/application/workspace/queries";

/**
 * Role-aware navigation, derived only from the trusted shell context (the
 * database-built actor). Hiding an item is a convenience: every page
 * authorizes on the server regardless.
 */

export type NavIcon =
  | "home"
  | "myShifts"
  | "preferences"
  | "requests"
  | "notifications"
  | "departmentSchedule"
  | "history"
  | "review"
  | "more";

export interface NavItem {
  /** Stable and unique within one navigation. */
  readonly id: string;
  readonly href: Route;
  readonly label: string;
  readonly icon: NavIcon;
}

export interface NavSection {
  readonly id: string;
  /** Visible heading; null for the untitled first section. */
  readonly title: string | null;
  readonly items: readonly NavItem[];
}

export interface Navigation {
  /** Where `/` and a successful sign-in lead. */
  readonly home: Route;
  /** Desktop sidebar and the "more" page. */
  readonly sections: readonly NavSection[];
  /** Mobile bottom bar: at most MAX_PRIMARY items. */
  readonly primary: readonly NavItem[];
}

export const MAX_PRIMARY = 5;

type Capabilities = Pick<ShellContext, "memberships" | "supervised">;

const departmentPath = (code: string, page: "schedule" | "history") =>
  `/departments/${encodeURIComponent(code)}/${page}` as Route;

/**
 * Deterministic default page (documented in docs/decisions.md, D24):
 * 1. supervisor with no membership → `/review`
 * 2. Head Nurse anywhere, or member and supervisor → `/home` (overview)
 * 3. otherwise (nurse only, or no current relation) → `/my-shifts`
 */
export function homePath(ctx: Capabilities): Route {
  const member = ctx.memberships.length > 0;
  const headNurse = ctx.memberships.some((m) => m.role === "HEAD_NURSE");
  const supervisor = ctx.supervised.length > 0;
  if (supervisor && !member) return "/review";
  if (headNurse || (member && supervisor)) return "/home";
  return "/my-shifts";
}

const ITEMS = {
  home: { id: "home", href: "/home", label: "نمای کلی", icon: "home" },
  myShifts: {
    id: "my-shifts",
    href: "/my-shifts",
    label: "شیفت‌های من",
    icon: "myShifts",
  },
  preferences: {
    id: "preferences",
    href: "/preferences",
    label: "ترجیحات",
    icon: "preferences",
  },
  requests: {
    id: "requests",
    href: "/requests",
    label: "درخواست‌ها",
    icon: "requests",
  },
  notifications: {
    id: "notifications",
    href: "/notifications",
    label: "اعلان‌ها",
    icon: "notifications",
  },
  review: {
    id: "review",
    href: "/review",
    label: "بررسی برنامه‌ها",
    icon: "review",
  },
  more: { id: "more", href: "/more", label: "بیشتر", icon: "more" },
} as const satisfies Record<string, NavItem>;

export function buildNavigation(ctx: Capabilities): Navigation {
  const home = homePath(ctx);
  const member = ctx.memberships.length > 0;
  const supervisor = ctx.supervised.length > 0;
  const headOf = ctx.memberships
    .filter((m) => m.role === "HEAD_NURSE")
    .map((m) => m.department);
  // Name the department only when there is more than one to tell apart.
  const qualify = (label: string, name: string) =>
    headOf.length > 1 ? `${label} (${name})` : label;

  const departmentItems = headOf.map((d) => ({
    schedule: {
      id: `department-schedule-${d.code}`,
      href: departmentPath(d.code, "schedule"),
      label: qualify("برنامه بخش", d.name),
      icon: "departmentSchedule",
    } satisfies NavItem,
    history: {
      id: `department-history-${d.code}`,
      href: departmentPath(d.code, "history"),
      label: qualify("تاریخچه", d.name),
      icon: "history",
    } satisfies NavItem,
  }));

  // Personal pages are about the user's own data, so anyone who is not only
  // a supervisor gets them (including a former nurse's history, D16).
  const personal = member || !supervisor;
  const sections: NavSection[] = [];
  if (home === "/home")
    sections.push({ id: "overview", title: null, items: [ITEMS.home] });
  if (personal)
    sections.push({
      id: "personal",
      title: "کارهای من",
      items: [
        ITEMS.myShifts,
        ITEMS.preferences,
        ITEMS.requests,
        ITEMS.notifications,
      ],
    });
  headOf.forEach((d, i) =>
    sections.push({
      id: `department-${d.code}`,
      title: d.name,
      items: [departmentItems[i]!.schedule, departmentItems[i]!.history],
    }),
  );
  if (supervisor)
    sections.push({
      id: "review",
      title: "نظارت",
      items: personal ? [ITEMS.review] : [ITEMS.review, ITEMS.notifications],
    });

  // Bottom bar priorities (mobile): Head Nurse, else nurse, then supervisor.
  const firstDepartment = departmentItems[0];
  const candidates: NavItem[] = [
    ...(firstDepartment
      ? [
          ITEMS.myShifts,
          firstDepartment.schedule,
          ITEMS.requests,
          firstDepartment.history,
        ]
      : personal
        ? [
            ITEMS.myShifts,
            ITEMS.preferences,
            ITEMS.requests,
            ITEMS.notifications,
          ]
        : []),
    ...(supervisor ? [ITEMS.review, ITEMS.notifications] : []),
  ];
  const unique = candidates.filter(
    (item, i) => candidates.findIndex((c) => c.id === item.id) === i,
  );
  const all = sections.flatMap((s) => s.items);
  const overflow =
    unique.length > MAX_PRIMARY ||
    all.some((item) => !unique.some((u) => u.id === item.id));
  const primary = overflow
    ? [...unique.slice(0, MAX_PRIMARY - 1), ITEMS.more]
    : unique;

  return { home, sections, primary };
}
