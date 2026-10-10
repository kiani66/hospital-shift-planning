"use client";

import { Menu, X } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

import { BrandMark, PRODUCT_NAME } from "./brand-mark";
import { NavSections } from "./nav-sections";
import type { NavSection } from "./navigation";
import { SIDEBAR_MEDIA } from "./sidebar-state";

const iconButton = cn(
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md",
  "hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none",
);

/**
 * Phones (< md): the full sidebar navigation as a drawer from the inline
 * start (right in RTL), opened from the header's menu button. It takes no
 * room until opened; the bottom bar stays the everyday navigation.
 *
 * A modal native `<dialog>`: focus stays inside, the page behind is inert
 * and Escape closes it; focus returns to the menu button. Choosing a link,
 * a click outside the panel (the backdrop), a navigation by any other means
 * and growing past the phone layout all close it too.
 */
export function MobileNavDrawer({
  home,
  sections,
}: {
  home: Route;
  sections: readonly NavSection[];
}) {
  const drawerId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // A navigation (back/forward included) closes the drawer.
  const pathname = usePathname();
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The drawer is phone-only: a rotation or resize into the sidebar layout
  // closes it rather than leaving an invisible modal over the page.
  useEffect(() => {
    if (!open) return;
    const wide = matchMedia(SIDEBAR_MEDIA);
    const onChange = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [open]);

  function closeOnLink(event: MouseEvent) {
    if (event.target instanceof Element && event.target.closest("a"))
      setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        aria-label="منوی ناوبری"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen(true)}
        className={cn(iconButton, "-ms-2 md:hidden")}
      >
        <Menu aria-hidden="true" className="size-6" />
      </button>
      <dialog
        ref={ref}
        id={drawerId}
        aria-label="منوی ناوبری"
        data-nav-drawer=""
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // The panel fills the dialog: a click on the element itself is the backdrop.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className={cn(
          "inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-[min(18rem,calc(100vw-3rem))] max-w-none p-0",
          "bg-sidebar text-sidebar-foreground shadow-xl backdrop:bg-sidebar/55 md:hidden",
          "motion-safe:open:animate-in motion-safe:open:duration-200 motion-safe:open:slide-in-from-start",
        )}
      >
        {open && (
          <div
            className="flex h-full flex-col overflow-y-auto"
            onClick={closeOnLink}
          >
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3">
              <Link
                href={home}
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-1 font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none"
              >
                <BrandMark className="size-8" />
                <span className="truncate">{PRODUCT_NAME}</span>
              </Link>
              <button
                type="button"
                aria-label="بستن منو"
                onClick={() => setOpen(false)}
                className={iconButton}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <nav aria-label="ناوبری اصلی" className="flex-1 px-3 py-5">
              <NavSections sections={sections} />
            </nav>
          </div>
        )}
      </dialog>
    </>
  );
}
