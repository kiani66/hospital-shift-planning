"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { NavIcon } from "./nav-icon";
import { badgeLabel, formatBadgeCount, type NavItem } from "./navigation";

const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/**
 * The unread badge. The visible count is decorative (aria-hidden); the link
 * name gets the full text after the label, e.g. "اعلان‌ها، ۳ اعلان خوانده‌نشده".
 */
function Badge({ count, className }: { count?: number; className?: string }) {
  const text = count === undefined ? null : formatBadgeCount(count);
  if (!text) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="nav-badge"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[0.7rem] leading-none font-bold text-white tabular-nums",
        className,
      )}
    >
      {text}
    </span>
  );
}

function BadgeText({ count }: { count?: number }) {
  if (count === undefined || !formatBadgeCount(count)) return null;
  return <span className="sr-only">، {badgeLabel(count)}</span>;
}

export type NavSurface = "sidebar" | "page";

const SIDEBAR_LINK: Record<NavSurface, { current: string; idle: string }> = {
  sidebar: {
    current:
      "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-sm focus-visible:ring-sidebar-ring",
    idle: "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-sidebar-ring",
  },
  page: {
    current:
      "bg-primary font-semibold text-primary-foreground shadow-sm focus-visible:ring-ring",
    idle: "text-foreground hover:bg-accent focus-visible:ring-ring",
  },
};

/**
 * Sidebar link: on the navy sidebar (desktop) or on the page (the "more"
 * page on phones), with the blue pill for the current page on both.
 */
export function SidebarLink({
  item,
  surface = "sidebar",
}: {
  item: NavItem;
  surface?: NavSurface;
}) {
  const current = isCurrent(usePathname(), item.href);
  const tone = SIDEBAR_LINK[surface];
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        "focus-visible:ring-3 focus-visible:outline-none",
        current ? tone.current : tone.idle,
      )}
    >
      <NavIcon name={item.icon} className="size-5 shrink-0" />
      <span className="truncate">{item.label}</span>
      <BadgeText count={item.badge} />
      <Badge count={item.badge} className="ms-auto" />
    </Link>
  );
}

/** Mobile bottom-bar link: icon above a short label, 56px tall. */
export function BottomNavLink({ item }: { item: NavItem }) {
  const current = isCurrent(usePathname(), item.href);
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
        current
          ? "font-bold text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "relative flex h-7 w-12 items-center justify-center rounded-full",
          current && "bg-primary text-primary-foreground",
        )}
      >
        <NavIcon name={item.icon} className="size-5" />
        <Badge
          count={item.badge}
          className="absolute -end-1 -top-1.5 ring-2 ring-background"
        />
      </span>
      <span className="line-clamp-2 max-w-full text-center leading-tight">
        {item.label}
      </span>
      <BadgeText count={item.badge} />
    </Link>
  );
}
