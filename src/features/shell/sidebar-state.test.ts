import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DESKTOP_ATTRIBUTE,
  DESKTOP_MEDIA,
  SIDEBAR_MEDIA,
  SIDEBAR_PREPAINT_SCRIPT,
  SIDEBAR_STORAGE_KEY,
  TABLET_ATTRIBUTE,
  isCollapsedPreference,
  isSidebarCollapsed,
  preferenceValue,
  tooltipInsetStart,
} from "./sidebar-state";

/** Runs the pre-paint script against fake storage and returns `<html>`'s attributes. */
function runPrepaint(storage: { getItem: (key: string) => string | null }) {
  const attributes = new Map<string, string>();
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
    },
  };
  new Function("localStorage", "document", SIDEBAR_PREPAINT_SCRIPT)(
    storage,
    document,
  );
  return attributes;
}

const stored = (value: string | null) => ({
  getItem: (key: string) => (key === SIDEBAR_STORAGE_KEY ? value : null),
});

describe("sidebar collapse state", () => {
  it("desktop is expanded unless the user collapsed it", () => {
    const state = { desktopCollapsed: false, tabletExpanded: false };
    expect(isSidebarCollapsed("desktop", state)).toBe(false);
    expect(
      isSidebarCollapsed("desktop", { ...state, desktopCollapsed: true }),
    ).toBe(true);
  });

  it("tablet is collapsed unless the user expanded it", () => {
    const state = { desktopCollapsed: false, tabletExpanded: false };
    expect(isSidebarCollapsed("tablet", state)).toBe(true);
    expect(
      isSidebarCollapsed("tablet", { ...state, tabletExpanded: true }),
    ).toBe(false);
  });

  it("keeps the two layouts independent", () => {
    // Collapsing on desktop does not expand the tablet rail, and vice versa.
    expect(
      isSidebarCollapsed("tablet", {
        desktopCollapsed: true,
        tabletExpanded: true,
      }),
    ).toBe(false);
    expect(
      isSidebarCollapsed("desktop", {
        desktopCollapsed: false,
        tabletExpanded: false,
      }),
    ).toBe(false);
  });

  it("only an explicit 'collapsed' preference collapses", () => {
    expect(isCollapsedPreference("collapsed")).toBe(true);
    for (const value of [null, "", "expanded", "true", "COLLAPSED"])
      expect(isCollapsedPreference(value), String(value)).toBe(false);
  });

  it("round-trips the stored preference", () => {
    for (const collapsed of [true, false])
      expect(isCollapsedPreference(preferenceValue(collapsed))).toBe(collapsed);
  });
});

describe("pre-paint script", () => {
  it("applies a remembered collapse before the first paint", () => {
    expect(runPrepaint(stored("collapsed"))).toEqual(
      new Map([[DESKTOP_ATTRIBUTE, "collapsed"]]),
    );
  });

  it("leaves the default (expanded) otherwise", () => {
    expect(runPrepaint(stored(null)).size).toBe(0);
    expect(runPrepaint(stored("expanded")).size).toBe(0);
  });

  it("never throws when storage is unavailable", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(runPrepaint(blocked).size).toBe(0);
  });
});

describe("collapsed-rail CSS variant", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
    "utf8",
  );
  const variant = css.slice(
    css.indexOf("@custom-variant sidebar-collapsed"),
    css.indexOf("@custom-variant sidebar-collapsed") + 400,
  );

  it("reads the same <html> attributes the script and component set", () => {
    expect(variant).toContain(`:root:not([${TABLET_ATTRIBUTE}="expanded"])`);
    expect(variant).toContain(`:root[${DESKTOP_ATTRIBUTE}="collapsed"]`);
  });

  it("uses the same breakpoints as the component's media queries", () => {
    expect(SIDEBAR_MEDIA).toBe("(min-width: 48rem)");
    expect(DESKTOP_MEDIA).toBe("(min-width: 64rem)");
    expect(variant).toContain("(width >= 48rem) and (width < 64rem)");
    expect(variant).toContain("(width >= 64rem)");
  });
});

describe("collapsed-rail tooltip position", () => {
  it("sits just left of the rail in RTL", () => {
    // A 72px rail at the right edge of a 1280px viewport: the tooltip's
    // right edge is 8px left of the rail, over the content.
    const rail = { left: 1208, right: 1280 };
    expect(tooltipInsetStart(rail, 1280, "rtl")).toBe(1280 - 1208 + 8);
  });

  it("mirrors in LTR", () => {
    expect(tooltipInsetStart({ left: 0, right: 72 }, 1280, "ltr")).toBe(80);
  });
});
