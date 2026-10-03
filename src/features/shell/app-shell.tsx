import { CalendarDays, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ShellContext } from "@/application/workspace/queries";
import { buttonClasses } from "@/components/ui/button";
import { logoutAction } from "@/features/auth/actions";
import type { IsoDate } from "@/domain/shared/dates";
import { formatJalaliDate } from "@/features/calendar/jalali";
import { initials } from "@/features/schedule-review/presentation";

import { BrandMark, PRODUCT_NAME } from "./brand-mark";
import { BottomNavLink } from "./nav-link";
import { NavSections } from "./nav-sections";
import type { Navigation } from "./navigation";

const ROLE_LABELS = { NURSE: "پرستار", HEAD_NURSE: "سرپرستار" } as const;

/** One line per department relation, e.g. "سرپرستار · ICU". */
export function describeRoles(ctx: ShellContext): string[] {
  return [
    ...(ctx.isHospitalAdmin ? ["مدیر بیمارستان"] : []),
    ...ctx.memberships.map(
      (m) => `${ROLE_LABELS[m.role]} · ${m.department.name}`,
    ),
    ...ctx.supervised.map((d) => `سوپروایزر · ${d.name}`),
  ];
}

/**
 * Who is signed in: an initials monogram, the name and the department
 * roles (one line, truncated; the full text stays in the DOM for screen
 * readers). Desktop top bar only.
 */
function UserIdentity({
  name,
  roles,
}: {
  name: string;
  roles: readonly string[];
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground ring-2 ring-background"
      >
        {initials(name)}
      </span>
      <p className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-semibold">{name}</span>
        {roles.length > 0 && (
          <span className="truncate text-xs text-muted-foreground">
            {roles.join("، ")}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Authenticated layout. Desktop (md+): the navy navigation sidebar at the
 * inline start (right in RTL) and, beside it, one light brand-tinted zone:
 * the top bar (today, then the signed-in user and sign-out) over a canvas
 * whose top picks up the same tint. The sidebar's brand row and the top bar
 * share one height and one divider line, so the two read as one frame.
 * Mobile: a compact navy header and a bottom navigation bar; the sidebar is
 * not rendered in a squeezed form.
 */
export function AppShell({
  context,
  navigation,
  today,
  children,
}: {
  context: ShellContext;
  navigation: Navigation;
  /** Today in the app's time zone, for the top bar. */
  today: IsoDate;
  children: ReactNode;
}) {
  const roles = describeRoles(context);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:ring-3 focus:ring-ring"
      >
        پرش به محتوای اصلی
      </a>

      <div className="hidden bg-sidebar md:block">
        <aside className="sticky top-0 flex h-dvh flex-col overflow-y-auto text-sidebar-foreground">
          <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-3">
            <Link
              href={navigation.home}
              className="flex min-h-11 items-center gap-2.5 rounded-md px-2 font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none"
            >
              <BrandMark className="size-9" />
              <span>{PRODUCT_NAME}</span>
            </Link>
          </div>
          <nav aria-label="ناوبری اصلی" className="flex-1 px-3 py-5">
            <NavSections sections={navigation.sections} />
          </nav>
        </aside>
      </div>

      <div className="flex min-h-dvh min-w-0 flex-col md:bg-canvas-wash">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-sidebar px-4 text-sidebar-foreground max-md:border-b max-md:border-sidebar-border md:h-16 md:border-b md:border-primary/10 md:bg-brand-soft/70 md:px-8 md:text-foreground md:shadow-[0_1px_0_0_oklch(1_0_0/0.7)_inset] md:backdrop-blur-md">
          <Link
            href={navigation.home}
            className="flex min-h-11 items-center gap-2 rounded-md font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none md:hidden"
          >
            <BrandMark className="size-8" />
            <span>{PRODUCT_NAME}</span>
          </Link>
          <p className="hidden items-center gap-2 text-sm text-brand-soft-foreground md:flex">
            <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">امروز:</span>
            <time dateTime={today} className="font-medium">
              {formatJalaliDate(today, { weekday: true })}
            </time>
          </p>
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 md:block">
              <UserIdentity name={context.user.displayName} roles={roles} />
            </div>
            <span
              aria-hidden="true"
              className="hidden h-8 w-px shrink-0 bg-primary/15 md:block"
            />
            <form action={logoutAction}>
              <button
                type="submit"
                className={buttonClasses(
                  "ghost",
                  "min-w-11 px-3 max-md:hover:bg-sidebar-accent max-md:hover:text-sidebar-foreground max-md:focus-visible:ring-sidebar-ring md:text-brand-soft-foreground md:hover:bg-background/80",
                )}
              >
                <LogOut
                  aria-hidden="true"
                  className="size-5 rtl:-scale-x-100"
                />
                <span className="max-sm:sr-only">خروج</span>
              </button>
            </form>
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="flex-1 px-4 py-6 pb-28 md:px-8 md:pt-7 md:pb-10"
        >
          {children}
        </main>
      </div>

      <nav
        aria-label="ناوبری پایین"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_8px_-4px_oklch(0.27_0.065_264_/_0.2)] md:hidden"
      >
        <ul
          className="grid gap-1 px-2 py-1"
          style={{
            gridTemplateColumns: `repeat(${navigation.primary.length}, minmax(0, 1fr))`,
          }}
        >
          {navigation.primary.map((item) => (
            <li key={item.id} className="min-w-0">
              <BottomNavLink item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
