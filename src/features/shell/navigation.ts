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
  | "departmentRequests"
  | "history"
  | "review"
  | "personnel"
  | "staffingRules"
  | "more";

export interface NavItem {
  /** Stable and unique within one navigation. */
  readonly id: string;
  readonly href: Route;
  readonly label: string;
  readonly icon: NavIcon;
  /** Unread notifications shown on the item; absent when there are none. */
  readonly badge?: number;
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

type Capabilities = Pick<ShellContext, "memberships" | "supervised"> &
  Partial<Pick<ShellContext, "unreadNotifications" | "isHospitalAdmin">>;

const departmentPath = (
  code: string,
  page: "schedule" | "requests" | "history" | "people" | "coverage-rules",
) => `/departments/${encodeURIComponent(code)}/${page}` as Route;

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
  personnel: {
    id: "personnel",
    href: "/admin/personnel",
    label: "کاربران بیمارستان",
    icon: "personnel",
  },
  staffingRules: {
    id: "staffing-rules",
    href: "/admin/staffing-rules",
    label: "قوانین پوشش نفرات",
    icon: "staffingRules",
  },
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
    requests: {
      id: `department-requests-${d.code}`,
      href: departmentPath(d.code, "requests"),
      label: qualify("درخواست‌های بخش", d.name),
      icon: "departmentRequests",
    } satisfies NavItem,
    history: {
      id: `department-history-${d.code}`,
      href: departmentPath(d.code, "history"),
      label: qualify("تاریخچه", d.name),
      icon: "history",
    } satisfies NavItem,
    coverageRules: {
      id: `department-coverage-rules-${d.code}`,
      href: departmentPath(d.code, "coverage-rules"),
      label: qualify("قوانین پوشش", d.name),
      icon: "staffingRules",
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
      items: [
        departmentItems[i]!.schedule,
        departmentItems[i]!.requests,
        departmentItems[i]!.history,
        departmentItems[i]!.coverageRules,
      ],
    }),
  );
  const scopedPeople = [
    ...new Map([...headOf, ...ctx.supervised].map((d) => [d.id, d])).values(),
  ];
  if (scopedPeople.length > 0)
    sections.push({
      id: "people",
      title: "افراد بخش‌ها",
      items: scopedPeople.map((d) => ({
        id: `department-people-${d.code}`,
        href: departmentPath(d.code, "people"),
        label: `افراد بخش (${d.name})`,
        icon: "personnel",
      })),
    });
  if (ctx.isHospitalAdmin)
    sections.push({
      id: "administration",
      title: "مدیریت بیمارستان",
      items: [
        ITEMS.personnel,
        ITEMS.staffingRules,
        {
          id: "data-reset",
          href: "/admin/reset",
          label: "بازنشانی داده آزمایشی",
          icon: "personnel",
        },
      ],
    });
  if (supervisor)
    sections.push({
      id: "review",
      title: "نظارت",
      items: [
        ...(personal ? [ITEMS.review] : [ITEMS.review, ITEMS.notifications]),
        // Rule sets of supervised departments (read, preview and apply, D108).
        ...ctx.supervised
          .filter((d) => !headOf.some((h) => h.id === d.id))
          .map((d) => ({
            id: `department-coverage-rules-${d.code}`,
            href: departmentPath(d.code, "coverage-rules"),
            label: `قوانین پوشش (${d.name})`,
            icon: "staffingRules" as const,
          })),
      ],
    });

  // Bottom bar priorities (mobile): Head Nurse, else nurse, then supervisor.
  const firstDepartment = departmentItems[0];
  const candidates: NavItem[] = [
    ...(ctx.isHospitalAdmin ? [ITEMS.personnel] : []),
    ...(firstDepartment
      ? [
          ITEMS.myShifts,
          firstDepartment.schedule,
          firstDepartment.requests,
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

  return withUnreadBadge({ home, sections, primary }, ctx.unreadNotifications);
}

/**
 * Puts the unread count on every notifications item. On the mobile bar, when
 * notifications did not fit, "more" carries it so it is never hidden. Zero
 * (or no count) adds no badge at all.
 */
function withUnreadBadge(nav: Navigation, unread = 0): Navigation {
  if (unread <= 0) return nav;
  const mark = (item: NavItem): NavItem =>
    item.id === ITEMS.notifications.id ? { ...item, badge: unread } : item;
  const inPrimary = nav.primary.some((i) => i.id === ITEMS.notifications.id);
  return {
    home: nav.home,
    sections: nav.sections.map((s) => ({ ...s, items: s.items.map(mark) })),
    primary: nav.primary.map((item) =>
      !inPrimary && item.id === ITEMS.more.id
        ? { ...item, badge: unread }
        : mark(item),
    ),
  };
}

/** Compact badge text: Persian digits, capped at "۹۹+"; null hides the badge. */
export function formatBadgeCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const digits = new Intl.NumberFormat("fa-IR", { useGrouping: false });
  return count > 99 ? `${digits.format(99)}+` : digits.format(count);
}

/** What a screen reader hears for a badge, e.g. "۳ اعلان خوانده‌نشده". */
export function badgeLabel(count: number): string {
  return `${new Intl.NumberFormat("fa-IR").format(count)} اعلان خوانده‌نشده`;
}
