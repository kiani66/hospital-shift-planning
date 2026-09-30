import { Hospital, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ShellContext } from "@/application/workspace/queries";
import { buttonClasses } from "@/components/ui/button";
import { logoutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";

import { BottomNavLink } from "./nav-link";
import { NavSections } from "./nav-sections";
import type { Navigation } from "./navigation";

const ROLE_LABELS = { NURSE: "پرستار", HEAD_NURSE: "سرپرستار" } as const;

/** One line per department relation, e.g. "سرپرستار · ICU". */
export function describeRoles(ctx: ShellContext): string[] {
  return [
    ...ctx.memberships.map(
      (m) => `${ROLE_LABELS[m.role]} · ${m.department.name}`,
    ),
    ...ctx.supervised.map((d) => `سوپروایزر · ${d.name}`),
  ];
}

/** The product mark: the hospital icon in a brand-blue tile. */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm",
        className,
      )}
    >
      <Hospital className="size-[60%]" />
    </span>
  );
}

/**
 * Authenticated layout. Desktop (md+): the navy navigation sidebar at the
 * inline start (right in RTL), a light top bar and the content on a cool
 * canvas. Mobile: a compact navy header and a bottom navigation bar; the
 * sidebar is not rendered in a squeezed form.
 */
export function AppShell({
  context,
  navigation,
  children,
}: {
  context: ShellContext;
  navigation: Navigation;
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
        <aside className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto px-3 py-4 text-sidebar-foreground">
          <Link
            href={navigation.home}
            className="flex min-h-11 items-center gap-2.5 rounded-md px-2 font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none"
          >
            <BrandMark className="size-9" />
            <span>شیفت پرستاران</span>
          </Link>
          <nav aria-label="ناوبری اصلی" className="flex-1">
            <NavSections sections={navigation.sections} />
          </nav>
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent px-3 py-3 text-sm">
            <p className="font-medium">{context.user.displayName}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-sidebar-muted-foreground">
              {roles.map((role) => (
                <li key={role}>{role}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-sidebar px-4 text-sidebar-foreground max-md:border-sidebar-border md:bg-background/95 md:text-foreground md:backdrop-blur md:supports-[backdrop-filter]:bg-background/80">
          <Link
            href={navigation.home}
            className="flex min-h-11 items-center gap-2 rounded-md font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none md:hidden"
          >
            <BrandMark className="size-8" />
            <span>شیفت پرستاران</span>
          </Link>
          <p className="hidden truncate text-sm text-muted-foreground md:block">
            <span className="font-medium text-foreground">
              {context.user.displayName}
            </span>
            {roles.length > 0 && <span> — {roles.join("، ")}</span>}
          </p>
          <form action={logoutAction}>
            <button
              type="submit"
              className={buttonClasses(
                "ghost",
                "min-w-11 px-3 max-md:hover:bg-sidebar-accent max-md:hover:text-sidebar-foreground max-md:focus-visible:ring-sidebar-ring",
              )}
            >
              <LogOut aria-hidden="true" className="size-5 rtl:-scale-x-100" />
              <span className="max-sm:sr-only">خروج</span>
            </button>
          </form>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="flex-1 px-4 py-6 pb-28 md:px-8 md:pb-10"
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
