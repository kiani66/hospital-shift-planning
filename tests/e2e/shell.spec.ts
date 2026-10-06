import { expect, test } from "@playwright/test";

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
