import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  DEMO_USERS,
  accountMenuButton,
  isDesktop,
  signInAndWait,
} from "./support/auth";

test.describe("authenticated shell", () => {
  test.beforeEach(async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.icuHead.email);
  });

  test("uses a start-side sidebar on desktop and a bottom bar on mobile", async ({
    page,
  }) => {
    const sidebar = page.getByRole("navigation", { name: "ناوبری اصلی" });
    const bottom = page.getByRole("navigation", { name: "ناوبری پایین" });
    if (isDesktop(page)) {
      await expect(sidebar).toBeVisible();
      await expect(bottom).toBeHidden();
      // RTL: the sidebar sits on the right, the content to its left.
      const nav = (await sidebar.boundingBox())!;
      const main = (await page.locator("main").boundingBox())!;
      expect(nav.x).toBeGreaterThan(main.x);
    } else {
      await expect(bottom).toBeVisible();
      await expect(sidebar).toBeHidden();
      const bar = (await bottom.boundingBox())!;
      expect(bar.y + bar.height).toBeCloseTo(page.viewportSize()!.height, 0);
      await expect(bottom.getByRole("link")).toHaveCount(5);
      for (const box of await bottom
        .getByRole("link")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
        expect(box).toBeGreaterThanOrEqual(44);
    }
  });

  test("reaches every destination on mobile via 'more'", async ({ page }) => {
    test.skip(isDesktop(page), "mobile only");
    await page
      .getByRole("navigation", { name: "ناوبری پایین" })
      .getByRole("link", { name: "بیشتر" })
      .click();
    const all = page.getByRole("navigation", { name: "همه بخش‌ها" });
    for (const label of ["ترجیحات", "اعلان‌ها", "برنامه بخش", "تاریخچه"])
      await expect(all.getByRole("link", { name: label })).toBeVisible();
  });

  test("does not scroll horizontally", async ({ page }) => {
    for (const path of ["/home", "/my-shifts", "/departments/icu/schedule"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("switches navigation at 768px with no overlap or overflow on either side", async ({
    page,
  }) => {
    test.skip(
      !isDesktop(page),
      "resizes a desktop browser across the breakpoint",
    );
    const sidebar = page.getByRole("navigation", { name: "ناوبری اصلی" });
    const bottom = page.getByRole("navigation", { name: "ناوبری پایین" });
    for (const width of [600, 767, 768, 900, 1023, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of [
        "/home",
        "/preferences",
        "/departments/icu/schedule",
      ]) {
        await page.goto(path);
        const step = `${width}px ${path}`;
        if (width < 768) {
          await expect(bottom, step).toBeVisible();
          await expect(sidebar, step).toBeHidden();
        } else {
          await expect(sidebar, step).toBeVisible();
          await expect(bottom, step).toBeHidden();
          // The content starts where the sidebar ends (RTL: to its left).
          const nav = (await page.locator("aside").boundingBox())!;
          const main = (await page.locator("main").boundingBox())!;
          expect(main.x + main.width, step).toBeLessThanOrEqual(nav.x + 0.5);
          expect(main.width, step).toBeGreaterThanOrEqual(width - 17 * 16);
        }
        const overflow = await page.evaluate(() => {
          const header = document.querySelector("header")!;
          return {
            page:
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            header: header.scrollWidth - header.clientWidth,
          };
        });
        expect(overflow, step).toEqual({ page: 0, header: 0 });
        await expect(accountMenuButton(page), step).toBeVisible();
      }
    }
  });

  test("lays text out from the right edge", async ({ page }) => {
    await page.goto("/my-shifts");
    const gaps = await page
      .getByRole("heading", { level: 1 })
      .evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { right: box.right - text.right, left: text.left - box.left };
      });
    expect(gaps.right).toBeLessThan(1);
    expect(gaps.left).toBeGreaterThan(50);
  });

  test("shows all four shift types with their codes", async ({ page }) => {
    await page.goto("/my-shifts");
    const legend = page
      .getByRole("list", { name: "انواع شیفت" })
      .getByRole("listitem");
    await expect(legend).toHaveCount(4);
    for (const code of ["M", "E", "N", "ME"])
      await expect(legend.getByText(code, { exact: true })).toBeVisible();
  });

  test("offers a skip link and visible keyboard focus", async ({ page }) => {
    test.skip(!isDesktop(page), "keyboard navigation is checked on desktop");
    // A full page load puts focus at the document start (after the client-side
    // sign-in redirect it is wherever the form left it).
    await page.goto("/home");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "پرش به محتوای اصلی" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    const outline = await focused.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    expect(outline).not.toBe("none");
  });
});

test.describe("collapsible sidebar", () => {
  const SCHEDULE = "/departments/icu/schedule";
  const EXPANDED_DESKTOP = 17 * 16;
  const EXPANDED_TABLET = 15 * 16;
  const RAIL = 72;

  const aside = (page: Page) => page.locator("aside");
  const sidebarNav = (page: Page) =>
    page.getByRole("navigation", { name: "ناوبری اصلی" });
  const collapseButton = (page: Page) =>
    aside(page).getByRole("button", { name: "جمع کردن منو" });
  const expandButton = (page: Page) =>
    aside(page).getByRole("button", { name: "باز کردن منو" });
  const width = async (locator: Locator) =>
    (await locator.boundingBox())?.width ?? 0;
  const pageOverflow = (page: Page) =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
  const storedPreference = (page: Page) =>
    page.evaluate(() => localStorage.getItem("hsp.sidebar.desktop"));

  test.beforeEach(async ({ page }) => {
    await signInAndWait(page, DEMO_USERS.icuHead.email);
  });

  test("desktop: expanded by default, collapses to an icon rail and remembers it", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "desktop only");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(SCHEDULE);
    const main = page.locator("main");

    await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");
    expect(await width(aside(page))).toBeCloseTo(EXPANDED_DESKTOP, 0);
    const mainBefore = await width(main);

    await collapseButton(page).click();
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => width(aside(page))).toBeLessThanOrEqual(RAIL);
    expect(await width(aside(page))).toBeGreaterThanOrEqual(64);
    // The content takes the released room.
    expect(await width(main)).toBeGreaterThanOrEqual(
      mainBefore + EXPANDED_DESKTOP - RAIL - 1,
    );
    expect(await pageOverflow(page)).toBe(0);
    expect(await storedPreference(page)).toBe("collapsed");

    // Icons only, but every link keeps its name; the current one is still marked.
    const schedule = sidebarNav(page).getByRole("link", {
      name: "برنامه بخش",
    });
    await expect(schedule).toBeVisible();
    await expect(schedule).toHaveAttribute("aria-current", "page");
    expect(await width(schedule)).toBeLessThanOrEqual(48);

    // Hover shows the label beside the rail (to its left in RTL).
    const tooltip = page.getByTestId("sidebar-tooltip");
    await schedule.hover();
    await expect(tooltip).toHaveText("برنامه بخش");
    const tip = (await tooltip.boundingBox())!;
    const rail = (await aside(page).boundingBox())!;
    expect(tip.x + tip.width).toBeLessThanOrEqual(rail.x);
    await page.keyboard.press("Escape");
    await expect(tooltip).toBeHidden();

    // Keyboard focus shows it too.
    await page.mouse.move(640, 400);
    await schedule.focus();
    await expect(tooltip).toHaveText("برنامه بخش");
    await schedule.blur();
    await expect(tooltip).toBeHidden();

    // Remembered: applied before the page is interactive, so no layout jump.
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute("data-sidebar-desktop"),
      ),
    ).toBe("collapsed");
    expect(await width(aside(page))).toBeLessThanOrEqual(RAIL);
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");

    await expandButton(page).click();
    await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => width(aside(page)))
      .toBeCloseTo(EXPANDED_DESKTOP, 0);
    expect(await storedPreference(page)).toBe("expanded");
    await expect(page.getByTestId("sidebar-tooltip")).toBeHidden();
  });

  test("desktop: the collapse control works from the keyboard", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "desktop only");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/home");
    await collapseButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(expandButton(page)).toBeFocused();
    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");
    // Tab continues into the navigation.
    await page.keyboard.press("Tab");
    await expect(sidebarNav(page).getByRole("link").first()).toBeFocused();
  });

  test("tablet: collapsed by default, expands on demand without overflow", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "resizes a desktop browser to tablet width");
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(SCHEDULE);
    const main = page.locator("main");

    await expect(expandButton(page)).toHaveAttribute("aria-expanded", "false");
    expect(await width(aside(page))).toBeLessThanOrEqual(RAIL);
    expect(await width(main)).toBeGreaterThanOrEqual(900 - RAIL - 1);
    expect(await pageOverflow(page)).toBe(0);
    await expect(
      sidebarNav(page).getByRole("link", { name: "برنامه بخش" }),
    ).toBeVisible();

    await expandButton(page).click();
    await expect(collapseButton(page)).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => width(aside(page))).toBeCloseTo(EXPANDED_TABLET, 0);
    expect(await pageOverflow(page)).toBe(0);
    // Expanding on a tablet is for this visit; the desktop choice is untouched.
    expect(await storedPreference(page)).toBeNull();

    // Client-side navigation keeps the choice.
    await sidebarNav(page).getByRole("link", { name: "تاریخچه" }).click();
    await expect(page).toHaveURL(/\/departments\/icu\/history$/);
    expect(await width(aside(page))).toBeCloseTo(EXPANDED_TABLET, 0);

    await collapseButton(page).click();
    await expect.poll(() => width(aside(page))).toBeLessThanOrEqual(RAIL);
    expect(await pageOverflow(page)).toBe(0);

    // Desktop width keeps its own default (expanded).
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect
      .poll(() => width(aside(page)))
      .toBeCloseTo(EXPANDED_DESKTOP, 0);
  });

  test("mobile: navigation opens as a drawer that reserves no space", async ({
    page,
  }) => {
    test.skip(isDesktop(page), "mobile only");
    await page.goto(SCHEDULE);
    const viewport = page.viewportSize()!;
    const main = (await page.locator("main").boundingBox())!;
    expect(main.x).toBeCloseTo(0, 0);
    expect(main.width).toBeCloseTo(viewport.width, 0);

    const menu = page
      .getByRole("banner")
      .getByRole("button", { name: "منوی ناوبری" });
    const drawer = page.getByRole("dialog", { name: "منوی ناوبری" });
    await expect(drawer).toBeHidden();

    // Opens from the inline start (right in RTL) with focus inside.
    await menu.click();
    await expect(drawer).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    // Let the slide-in finish before measuring.
    await drawer.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)),
    );
    const panel = (await drawer.boundingBox())!;
    expect(panel.x + panel.width).toBeCloseTo(viewport.width, 0);
    expect(panel.width).toBeLessThan(viewport.width);
    expect(
      await drawer.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await expect(
      drawer
        .getByRole("navigation", { name: "ناوبری اصلی" })
        .getByRole("link", { name: "برنامه بخش" }),
    ).toHaveAttribute("aria-current", "page");

    // Escape closes it and focus returns to the menu button.
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();

    // A click outside the panel closes it.
    await menu.click();
    await expect(drawer).toBeVisible();
    await page.mouse.click(8, viewport.height / 2);
    await expect(drawer).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    // Choosing a destination navigates and closes it.
    await menu.click();
    await drawer.getByRole("link", { name: "تاریخچه" }).click();
    await expect(page).toHaveURL(/\/departments\/icu\/history$/);
    await expect(drawer).toBeHidden();
    expect(await pageOverflow(page)).toBe(0);
  });
});
