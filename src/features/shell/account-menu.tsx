"use client";

import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { logoutAction } from "@/features/auth/actions";
import { initials } from "@/features/schedule-review/presentation";
import { cn } from "@/lib/utils";

const focusRing =
  "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none";

const menuAction = cn(
  "flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-start text-sm font-medium hover:bg-accent hover:text-accent-foreground",
  focusRing,
);

/**
 * Who is signed in, on every authenticated page: an initials monogram and
 * the name in the header (with the department roles beside it on desktop),
 * opening a panel with the full name, personnel number, every current role
 * and department, and the account actions (change password, sign out).
 * On a shared ward device this answers «با حساب چه کسی وارد شده‌ام؟» in one
 * tap. Presentation only: everything shown comes from the shell context the
 * server built from the signed-in actor.
 *
 * A disclosure (button + panel, not an ARIA menu): the panel follows the
 * button in the DOM so Tab moves into it; Escape, a click outside, leaving
 * it with Tab and navigating all close it.
 */
export function AccountMenu({
  name,
  personnelNumber,
  roles,
}: {
  name: string;
  personnelNumber: string | null;
  /** One line per department relation, e.g. "سرپرستار · ICU". */
  roles: readonly string[];
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // A navigation (e.g. «تغییر رمز عبور») closes the panel.
  const pathname = usePathname();
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    trigger.current?.focus();
  }

  const monogram = (size: string) => (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground ring-2 ring-background",
        size,
      )}
    >
      {initials(name)}
    </span>
  );

  return (
    <div
      ref={root}
      className="relative min-w-0"
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !root.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex min-h-11 max-w-full min-w-11 items-center gap-2 rounded-md px-1.5 text-start",
          "hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none",
          "md:gap-2.5 md:hover:bg-background/80 md:focus-visible:ring-ring",
        )}
      >
        {monogram("size-8 text-[0.6875rem] md:size-9 md:text-xs")}
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="sr-only">حساب کاربری: </span>
          <span className="truncate text-sm font-semibold">{name}</span>
          {roles.length > 0 && (
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              <span className="sr-only">، </span>
              {roles.join("، ")}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 opacity-70 transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      <section
        id={panelId}
        aria-label="حساب کاربری"
        hidden={!open}
        className="absolute end-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
      >
        <div className="flex items-start gap-3 p-2">
          {monogram("size-10 text-sm")}
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">وارد شده با حساب</p>
            <p
              data-account="name"
              className="leading-snug font-semibold break-words"
            >
              {name}
            </p>
            {personnelNumber && (
              <p className="text-xs text-muted-foreground">
                شماره پرسنلی:{" "}
                <span
                  dir="ltr"
                  data-account="personnel-number"
                  className="font-medium text-foreground tabular-nums"
                >
                  {personnelNumber}
                </span>
              </p>
            )}
          </div>
        </div>
        {roles.length > 0 && (
          <div className="border-t px-2 py-2">
            <p className="mb-1 text-xs text-muted-foreground">نقش و بخش</p>
            <ul aria-label="نقش و بخش" className="flex flex-col gap-1">
              {roles.map((role) => (
                <li
                  key={role}
                  data-account="role"
                  className="text-sm leading-snug font-medium"
                >
                  {role}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-col gap-0.5 border-t pt-2">
          <Link href="/account/password" className={menuAction}>
            <KeyRound
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            تغییر رمز عبور
          </Link>
          <form action={logoutAction}>
            <button type="submit" className={menuAction}>
              <LogOut
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
              />
              خروج
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
