"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import {
  useId,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@/lib/utils";

import { BrandMark, PRODUCT_NAME } from "./brand-mark";
import { NavSections } from "./nav-sections";
import type { NavSection } from "./navigation";
import {
  DESKTOP_ATTRIBUTE,
  DESKTOP_MEDIA,
  SIDEBAR_STORAGE_KEY,
  TABLET_ATTRIBUTE,
  isCollapsedPreference,
  isSidebarCollapsed,
  preferenceValue,
  tooltipInsetStart,
} from "./sidebar-state";

const root = () => document.documentElement;

// The desktop preference: the `<html>` attribute is the source of truth (the
// pre-paint script sets it from storage); storage only remembers it.
const desktopListeners = new Set<() => void>();

const readDesktopCollapsed = () =>
  root().getAttribute(DESKTOP_ATTRIBUTE) === "collapsed";

function applyDesktopCollapsed(collapsed: boolean) {
  if (collapsed) root().setAttribute(DESKTOP_ATTRIBUTE, "collapsed");
  else root().removeAttribute(DESKTOP_ATTRIBUTE);
  desktopListeners.forEach((listener) => listener());
}

function readStoredCollapsed() {
  try {
    return isCollapsedPreference(localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return false;
  }
}

function setDesktopCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, preferenceValue(collapsed));
  } catch {
    // Not remembered (storage unavailable); it still applies to this visit.
  }
  applyDesktopCollapsed(collapsed);
}

function subscribeDesktopCollapsed(listener: () => void) {
  desktopListeners.add(listener);
  // Another tab changed the preference.
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_STORAGE_KEY)
      applyDesktopCollapsed(isCollapsedPreference(event.newValue));
  };
  window.addEventListener("storage", onStorage);
  return () => {
    desktopListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeDesktopMedia(listener: () => void) {
  const query = matchMedia(DESKTOP_MEDIA);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const isDesktopMedia = () => matchMedia(DESKTOP_MEDIA).matches;

type Tooltip = { label: string; top: number; insetStart: number };

/**
 * The tablet/desktop sidebar (md+): brand row, the collapse control, then
 * the navigation. Collapsed, it is a 72px icon rail: labels and section
 * titles stay in the accessibility tree (screen-reader only), and hovering
 * or focusing an item shows its label as a tooltip beside the rail (Escape
 * dismisses it). How a collapsed rail looks is CSS (`sidebar-collapsed:`),
 * driven by the `<html>` attributes, so it is right from the first paint;
 * this component only flips the attributes and labels the control.
 *
 * Desktop: expanded by default; the choice is remembered in localStorage.
 * Tablet: collapsed by default so the schedule gets the width; expanding
 * lasts for the visit.
 */
export function CollapsibleSidebar({
  home,
  sections,
}: {
  home: Route;
  sections: readonly NavSection[];
}) {
  const navId = useId();
  const desktop = useSyncExternalStore(
    subscribeDesktopMedia,
    isDesktopMedia,
    () => true,
  );
  const desktopCollapsed = useSyncExternalStore(
    subscribeDesktopCollapsed,
    readDesktopCollapsed,
    () => false,
  );
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const collapsed = isSidebarCollapsed(desktop ? "desktop" : "tablet", {
    desktopCollapsed,
    tabletExpanded,
  });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // In development, Strict Mode's remount resets `<html>` to the attributes
  // React renders, dropping the one the pre-paint script set. Re-apply it
  // from storage before paint (a no-op in production).
  useLayoutEffect(() => {
    const stored = readStoredCollapsed();
    if (stored !== readDesktopCollapsed()) applyDesktopCollapsed(stored);
  }, []);

  useLayoutEffect(() => {
    if (!tabletExpanded) return;
    root().setAttribute(TABLET_ATTRIBUTE, "expanded");
    return () => root().removeAttribute(TABLET_ATTRIBUTE);
  }, [tabletExpanded]);

  function toggle() {
    setTooltip(null);
    if (desktop) setDesktopCollapsed(!desktopCollapsed);
    else setTabletExpanded((expanded) => !expanded);
  }

  function showTooltip(rail: HTMLElement, target: EventTarget) {
    const item =
      target instanceof Element
        ? target.closest<HTMLElement>("[data-tooltip]")
        : null;
    if (!collapsed || !item) return setTooltip(null);
    const box = item.getBoundingClientRect();
    setTooltip({
      label: item.dataset.tooltip ?? "",
      // Level with the item, just outside the rail.
      top: box.top + box.height / 2,
      insetStart: tooltipInsetStart(
        rail.getBoundingClientRect(),
        root().clientWidth,
        getComputedStyle(rail).direction === "ltr" ? "ltr" : "rtl",
      ),
    });
  }

  const hideTooltip = () => setTooltip(null);
  const toggleLabel = collapsed ? "باز کردن منو" : "جمع کردن منو";

  return (
    <aside
      className="sticky top-0 flex h-dvh flex-col overflow-x-hidden overflow-y-auto text-sidebar-foreground"
      onPointerOver={(event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== "touch")
          showTooltip(event.currentTarget, event.target);
      }}
      onPointerLeave={hideTooltip}
      onFocus={(event: FocusEvent<HTMLElement>) =>
        showTooltip(event.currentTarget, event.target)
      }
      onBlur={hideTooltip}
      onScroll={hideTooltip}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Escape" && tooltip) {
          event.preventDefault();
          hideTooltip();
        }
      }}
    >
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-3">
        <Link
          href={home}
          data-tooltip={PRODUCT_NAME}
          className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-md px-2 font-bold focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none sidebar-collapsed:w-full sidebar-collapsed:justify-center sidebar-collapsed:px-0"
        >
          <BrandMark className="size-9" />
          <span className="truncate sidebar-collapsed:sr-only">
            {PRODUCT_NAME}
          </span>
        </Link>
      </div>
      <div className="px-3 pt-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={navId}
          data-tooltip={toggleLabel}
          onClick={toggle}
          className={cn(
            "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-muted-foreground transition-colors",
            "hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-sidebar-ring focus-visible:outline-none",
            "sidebar-collapsed:justify-center sidebar-collapsed:px-0",
          )}
        >
          {/* Both icons are rendered and CSS picks one, so the control is right before hydration. */}
          <PanelLeftClose
            aria-hidden="true"
            className="size-5 shrink-0 rtl:-scale-x-100 sidebar-collapsed:hidden"
          />
          <PanelLeftOpen
            aria-hidden="true"
            className="hidden size-5 shrink-0 rtl:-scale-x-100 sidebar-collapsed:block"
          />
          <span className="truncate sidebar-collapsed:sr-only">
            {toggleLabel}
          </span>
        </button>
      </div>
      <nav
        id={navId}
        aria-label="ناوبری اصلی"
        className="flex-1 px-3 pt-3 pb-5"
      >
        <NavSections sections={sections} />
      </nav>
      {collapsed && tooltip && (
        // Visual only: every item's accessible name already holds its label.
        <span
          aria-hidden="true"
          data-testid="sidebar-tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-md"
          style={{ top: tooltip.top, insetInlineStart: tooltip.insetStart }}
        >
          {tooltip.label}
        </span>
      )}
    </aside>
  );
}
