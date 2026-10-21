import { randomInt } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signInAndWait } from "./support/auth";
import { provisionReviewDepartment } from "./support/review";

const dayUrl = (code: string) =>
  `/departments/${code}/schedule?month=1405-08&day=2026-10-24`;

const noHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    return Math.max(
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      dialog ? dialog.scrollWidth - dialog.clientWidth : 0,
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
};

/**
 * Unique per run (personnel numbers are unique across the whole database) yet
 * ordered by length: numeric order differs from both name and text order.
 */
function numbers() {
  const r = String(randomInt(100_000, 1_000_000));
  return {
    nurse3: `9${r}`,
    nurse2: `10${r}`,
    nurse1: `100${r}`,
    head: `01000${r}`,
  };
}

test.describe("Personnel-number order in the day editor", () => {
  test("lists the roster by personnel number at every width, keeping leading zeros", async ({
    page,
  }) => {
    const n = numbers();
    const department = await provisionReviewDepartment({
      personnelNumbers: n,
    });
    await signInAndWait(page, department.headEmail);

    for (const [width, height] of [
      [1280, 900],
      [820, 1100],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(dayUrl(department.code));
      const dialog = page.getByRole("dialog");
      const rows = dialog.locator("li[data-nurse-row]");
      await expect(rows).toHaveCount(department.memberCount);

      // Numeric order (9… < 10… < 100… < 01000…), not name or text order.
      const text = await rows.allTextContents();
      const order = [n.nurse3, n.nurse2, n.nurse1, n.head].map((number) =>
        text.findIndex((t) => t.includes(number)),
      );
      expect(order, `${width}px`).toEqual([0, 1, 2, 3]);
      // The stored number is shown as is, leading zero included.
      await expect(
        rows.last().getByText(n.head, { exact: true }),
      ).toBeVisible();

      // Filtering by number keeps the order of what remains.
      const search = dialog.getByPlaceholder("جستجوی نام یا شماره پرسنلی…");
      await search.fill(n.nurse2);
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(n.nurse2);
      await search.fill("");
      await expect(rows).toHaveCount(department.memberCount);

      await noHorizontalOverflow(page);
      // Every number stays inside the viewport (no clipping next to long names).
      for (const box of await rows
        .locator("bdi")
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().toJSON()),
        )) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    }
  });
});
