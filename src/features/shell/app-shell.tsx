import { CalendarDays, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ShellContext } from "@/application/workspace/queries";
import { buttonClasses } from "@/components/ui/button";
import { logoutAction } from "@/features/auth/actions";
import type { IsoDate } from "@/domain/shared/dates";
import { formatJalaliDate } from "@/features/calendar/jalali";

import { AccountMenu } from "./account-menu";
import { BrandMark, PRODUCT_NAME } from "./brand-mark";
import { CollapsibleSidebar } from "./collapsible-sidebar";
import { MobileNavDrawer } from "./mobile-nav-drawer";
import { BottomNavLink } from "./nav-link";
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
 * Authenticated layout. Tablet and desktop (md+): the navy navigation
 * sidebar at the inline start (right in RTL) and, beside it, one light
 * brand-tinted zone: the top bar (today from lg, then the signed-in user's
 * account menu, change password and sign-out) over a canvas whose top picks
 * up the same tint. The sidebar's brand row and the top bar share one height
 * and one divider line, so the two read as one frame. The sidebar collapses
 * to a 72px icon rail (collapsed by default on tablets, by choice on
 * desktop; see `CollapsibleSidebar`) and the content takes the room.
 * Mobile: a compact navy header (the drawer's menu button, brand, then the
 * account menu, which holds change password and sign-out) and a bottom
 * navigation bar; the sidebar is not rendered in a squeezed form, it opens
 * as a drawer over the page. Every authenticated page shows who is signed in
 * through the same account menu.
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
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)] sidebar-collapsed:grid-cols-[4.5rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-4 py-2 focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:ring-3 focus:ring-ring"
      >
        پرش به محتوای اصلی
      </a>

      <div className="hidden bg-sidebar md:block">
        <CollapsibleSidebar
          home={navigation.home}
          sections={navigation.sections}
        />
      </div>

      <div className="flex min-h-dvh min-w-0 flex-col md:bg-canvas-wash">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-sidebar px-4 text-sidebar-foreground max-md:border-b max-md:border-sidebar-border md:h-16 md:border-b md:border-primary/10 md:bg-brand-soft/70 md:px-8 md:text-foreground md:shadow-[0_1px_0_0_oklch(1_0_0/0.7)_inset] md:backdrop-blur-md">
          <MobileNavDrawer
            home={navigation.home}
            sections={navigation.sections}
          />
          <Link
            href={navigation.home}
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-md font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none md:hidden"
          >
            <BrandMark className="size-8" />
            <span>{PRODUCT_NAME}</span>
          </Link>
          {/* From lg: between md and lg, the room goes to who is signed in. */}
          <p className="hidden shrink-0 items-center gap-2 text-sm whitespace-nowrap text-brand-soft-foreground lg:flex">
            <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">امروز:</span>
            <time dateTime={today} className="font-medium">
              {formatJalaliDate(today, { weekday: true })}
            </time>
          </p>
          <div className="ms-auto flex min-w-0 items-center gap-3">
            <AccountMenu
              name={context.user.displayName}
              personnelNumber={context.user.personnelNumber}
              roles={roles}
            />
            {/* Direct actions on desktop; on mobile they are in the account menu. */}
            <span
              aria-hidden="true"
              className="hidden h-8 w-px shrink-0 bg-primary/15 md:block"
            />
            <Link
              href="/account/password"
              className={buttonClasses(
                "ghost",
                "min-w-11 px-3 max-md:hidden md:text-brand-soft-foreground md:hover:bg-background/80",
              )}
            >
              <KeyRound aria-hidden="true" className="size-5" />
              <span className="max-lg:sr-only">تغییر رمز عبور</span>
            </Link>
            <form action={logoutAction} className="max-md:hidden">
              <button
                type="submit"
                className={buttonClasses(
                  "ghost",
                  "min-w-11 px-3 md:text-brand-soft-foreground md:hover:bg-background/80",
                )}
              >
                <LogOut
                  aria-hidden="true"
                  className="size-5 rtl:-scale-x-100"
                />
                <span className="max-lg:sr-only">خروج</span>
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
