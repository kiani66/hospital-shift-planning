import { expect, test } from "@playwright/test";

test.describe("application shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("renders Persian, right-to-left", async ({ page }) => {
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "سامانه برنامه‌ریزی شیفت پرستاران",
      }),
    ).toBeVisible();
  });

  test("lays text out from the right edge", async ({ page }) => {
    // Measure the rendered text (not the block box) of a short line: in RTL
    // it must hug the inline-start (right) edge of its container.
    const gaps = await page
      .getByText("فاز ۰ — زیرساخت پروژه")
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

  test("uses the Vazirmatn font", async ({ page }) => {
    await page.evaluate(() => document.fonts.ready);
    const family = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain("Vazirmatn");
    expect(
      await page.evaluate(() =>
        document.fonts.check('16px "Vazirmatn Variable"', "سلام"),
      ),
    ).toBe(true);
  });

  test("shows all four shift types", async ({ page }) => {
    const legend = page
      .getByRole("list", { name: "انواع شیفت" })
      .getByRole("listitem");
    await expect(legend).toHaveCount(4);
    for (const code of ["M", "E", "N", "ME"]) {
      await expect(legend.getByText(code, { exact: true })).toBeVisible();
    }
  });

  test("does not scroll horizontally", async ({ page }) => {
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
