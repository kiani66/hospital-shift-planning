"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { NavIcon } from "./nav-icon";
import type { NavItem } from "./navigation";

const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Sidebar link (desktop and the "more" page). */
export function SidebarLink({ item }: { item: NavItem }) {
  const current = isCurrent(usePathname(), item.href);
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none",
        current
          ? "bg-primary text-primary-foreground"
          : "text-foreground hover:bg-accent",
      )}
    >
      <NavIcon name={item.icon} className="size-5 shrink-0" />
      <span className="truncate">{item.label}</span>
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
          ? "font-bold text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "flex h-7 w-12 items-center justify-center rounded-full",
          current && "bg-primary text-primary-foreground",
        )}
      >
        <NavIcon name={item.icon} className="size-5" />
      </span>
      <span className="line-clamp-2 max-w-full text-center leading-tight">
        {item.label}
      </span>
    </Link>
  );
}
