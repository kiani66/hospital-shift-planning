/**
 * The collapsible sidebar's state, shared by the pre-paint script in the
 * root layout, the sidebar component and the `sidebar-collapsed` CSS variant
 * (globals.css). Framework-free so it can be unit tested.
 *
 * Three layouts, on the Tailwind breakpoints:
 *   phone   (< md, 48rem)  no sidebar column; navigation opens as a drawer.
 *   tablet  (md to < lg)   collapsed (icons only) by default; expanding it
 *                          lasts for the visit.
 *   desktop (lg, 64rem +)  expanded by default; collapsing it is remembered
 *                          in localStorage.
 *
 * The state lives as attributes on `<html>`, so the inline script can apply
 * the remembered desktop choice before the first paint (no layout jump) and
 * CSS alone decides what a collapsed sidebar looks like.
 */

export const SIDEBAR_STORAGE_KEY = "hsp.sidebar.desktop";

/** On `<html>`: "collapsed" when the user collapsed the desktop sidebar. */
export const DESKTOP_ATTRIBUTE = "data-sidebar-desktop";

/** On `<html>`: "expanded" while the user has expanded the tablet sidebar. */
export const TABLET_ATTRIBUTE = "data-sidebar-tablet";

/** Matches Tailwind's `lg` breakpoint. */
export const DESKTOP_MEDIA = "(min-width: 64rem)";

/** Matches Tailwind's `md` breakpoint: from here the sidebar is a column. */
export const SIDEBAR_MEDIA = "(min-width: 48rem)";

export type SidebarLayout = "tablet" | "desktop";

/** Only an explicit "collapsed" collapses; anything else is the default. */
export const isCollapsedPreference = (stored: string | null): boolean =>
  stored === "collapsed";

export const preferenceValue = (collapsed: boolean) =>
  collapsed ? "collapsed" : "expanded";

/** Whether the sidebar shows icons only, for the current layout. */
export function isSidebarCollapsed(
  layout: SidebarLayout,
  state: { desktopCollapsed: boolean; tabletExpanded: boolean },
): boolean {
  return layout === "desktop" ? state.desktopCollapsed : !state.tabletExpanded;
}

/**
 * Runs in `<head>` while the HTML is parsed, before the first paint. Storage
 * may be unavailable (private mode, blocked site data): the default stands.
 */
export const SIDEBAR_PREPAINT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  SIDEBAR_STORAGE_KEY,
)})==="collapsed")document.documentElement.setAttribute(${JSON.stringify(
  DESKTOP_ATTRIBUTE,
)},"collapsed")}catch(e){}`;

/**
 * Where a collapsed rail's tooltip starts, as a fixed-position
 * `inset-inline-start`: just past the rail's inner edge, over the content
 * (left of the rail in RTL, right of it in LTR).
 */
export function tooltipInsetStart(
  rail: { left: number; right: number },
  viewportWidth: number,
  direction: "rtl" | "ltr",
  gap = 8,
): number {
  return direction === "rtl"
    ? viewportWidth - rail.left + gap
    : rail.right + gap;
}
