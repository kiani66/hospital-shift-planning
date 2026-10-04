import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, isDesktop, signInAndWait } from "./support/auth";
import { provisionApprovalDepartment } from "./support/approval";

/**
 * The review department's Aban after finalizing: nurse 1 works M on 2 Aban
 * (Saturday) and N on 3 Aban (Sunday); nurse 2 works E on 2 Aban. Azar
 * exists as a DRAFT; Dey has no schedule.
 */
const ABAN = "/my-shifts?month=1405-08";

const notice = (page: Page, state: string) =>
  page.locator(`[data-publication="${state}"]`);
const calendar = (page: Page) =>
  page.getByRole("table", { name: /تقویم شیفت‌های شما/ });
const tile = (page: Page, term: string) =>
  page.locator("dt", { hasText: term }).locator("xpath=following-sibling::dd");

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function switchUser(page: Page, email: string) {
  await page.context().clearCookies();
  await signInAndWait(page, email);
}

test.describe("my shifts", () => {
  test("a temporary schedule: own shifts, a prominent warning, totals and day detail", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await signInAndWait(page, department.nurseEmail);
    await page.goto(ABAN);

    await expect(
      page.getByRole("heading", { level: 2, name: "آبان ۱۴۰۵" }),
    ).toBeVisible();
    await expect(notice(page, "TEMPORARY")).toContainText(
      "برنامه موقت است؛ شیفت‌ها ممکن است تغییر کنند",
    );
    await expect(page.getByText("موقت", { exact: true }).first()).toBeVisible();

    // Totals: M 7h + N 12h, one night.
    await expect(tile(page, "شیفت‌ها")).toHaveText("۲");
    await expect(tile(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۱۹ ساعت");
    await expect(tile(page, "شیفت شب")).toHaveText("۱");

    // Only the nurse's own shifts are in the calendar.
    const table = calendar(page);
    await expect(
      table.getByRole("link", { name: "شنبه ۲ آبان ۱۴۰۵: صبح (M)، موقت" }),
    ).toBeVisible();
    await expect(table.locator('[data-shifts~="E"]')).toHaveCount(0);

    // Opening a day shows its hours and duration.
    await table
      .getByRole("link", { name: "یکشنبه ۳ آبان ۱۴۰۵: شب (N)، موقت" })
      .click();
    await expect(page).toHaveURL(/day=2026-10-25/);
    const detail = page.getByRole("region", { name: "یکشنبه ۳ آبان ۱۴۰۵" });
    await expect(detail).toContainText("۱۹:۰۰ تا ۰۷:۰۰ روز بعد");
    await expect(detail).toContainText("۱۲ ساعت");
    await expect(detail).toContainText("موقت");

    // The month's list has both shifts in date order.
    const agenda = page.getByRole("region", { name: "فهرست شیفت‌های ماه" });
    await expect(agenda.getByRole("listitem")).toHaveCount(2);
    await expectNoHorizontalScroll(page);

    // Another nurse of the same department sees only their own shift; there
    // is no way to address someone else's schedule (a user id is ignored).
    await switchUser(page, department.nurseEmail.replace("nurse1.", "nurse2."));
    await page.goto(`${ABAN}&user=${DEMO_USERS.icuNurse1.id}`);
    await expect(tile(page, "شیفت‌ها")).toHaveText("۱");
    await expect(
      calendar(page).getByRole("link", {
        name: "شنبه ۲ آبان ۱۴۰۵: عصر (E)، موقت",
      }),
    ).toBeVisible();
    await expect(
      calendar(page).getByRole("link", {
        name: "یکشنبه ۳ آبان ۱۴۰۵: بدون شیفت",
      }),
    ).toBeVisible();
  });

  test("awaiting approval and approved schedules read differently", async ({
    page,
  }) => {
    test.slow();
    const submitted = await provisionApprovalDepartment("submitted");
    await signInAndWait(page, submitted.nurseEmail);
    await page.goto(ABAN);
    await expect(notice(page, "AWAITING_APPROVAL")).toContainText(
      "در انتظار تأیید سوپروایزر؛ هنوز رسمی نیست",
    );
    await expect(notice(page, "TEMPORARY")).toHaveCount(0);
    await expect(
      calendar(page).getByRole("link", {
        name: "شنبه ۲ آبان ۱۴۰۵: صبح (M)، در انتظار تأیید سوپروایزر",
      }),
    ).toBeVisible();

    const approved = await provisionApprovalDepartment("approved");
    await switchUser(page, approved.nurseEmail);
    await page.goto(ABAN);
    await expect(notice(page, "OFFICIAL")).toContainText(
      "برنامه رسمی و تأییدشده",
    );
    await expect(notice(page, "TEMPORARY")).toHaveCount(0);
    await expect(notice(page, "AWAITING_APPROVAL")).toHaveCount(0);
    await expect(
      calendar(page).getByRole("link", {
        name: "شنبه ۲ آبان ۱۴۰۵: صبح (M)، تأییدشده (رسمی)",
      }),
    ).toBeVisible();
    await expect(page.getByText("شامل شیفت‌های تأییدنشده")).toHaveCount(0);
  });

  test("moves by calendar month, with distinct empty states", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await signInAndWait(page, department.nurseEmail);
    await page.goto(ABAN);

    // Azar exists but is still a draft: status only, no calendar.
    await page.getByRole("link", { name: "ماه بعد: آذر ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/month=1405-09/);
    await expect(notice(page, "NOT_PUBLISHED")).toContainText(
      "برنامه این ماه هنوز منتشر نشده است",
    );
    await expect(calendar(page)).toHaveCount(0);

    // Dey has no schedule at all.
    await page.getByRole("link", { name: "ماه بعد: دی ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/month=1405-10/);
    await expect(
      page.getByRole("heading", { name: "برای این ماه برنامه‌ای ندارید" }),
    ).toBeVisible();

    // Back to the current month from anywhere.
    await page.getByRole("link", { name: "رفتن به ماه جاری" }).click();
    await expect(page).toHaveURL(/\/my-shifts\?month=\d{4}-\d{2}$/);
    await expect(
      page.getByRole("link", { name: "رفتن به ماه جاری" }),
    ).toHaveCount(0);
  });

  test("someone on no roster gets an explanation, not an empty calendar", async ({
    page,
  }) => {
    await signInAndWait(page, DEMO_USERS.supervisor.email);
    await page.goto("/my-shifts");
    await expect(
      page.getByRole("heading", { name: "هنوز در برنامه هیچ بخشی نیستید" }),
    ).toBeVisible();
    await expect(calendar(page)).toHaveCount(0);
  });

  test("days open from the keyboard with a visible focus ring", async ({
    page,
  }) => {
    test.skip(!isDesktop(page), "keyboard navigation is checked on desktop");
    const department = await provisionApprovalDepartment("finalized");
    await signInAndWait(page, department.nurseEmail);
    await page.goto(ABAN);
    const day = calendar(page).getByRole("link", {
      name: "یکشنبه ۳ آبان ۱۴۰۵: شب (N)، موقت",
    });
    await day.focus();
    expect(await day.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(
      "none",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/day=2026-10-25/);
    await expect(
      page.getByRole("region", { name: "یکشنبه ۳ آبان ۱۴۰۵" }),
    ).toBeVisible();
  });

  for (const width of [360, 390]) {
    test(`fits a ${width}px phone without horizontal scrolling`, async ({
      page,
    }) => {
      const department = await provisionApprovalDepartment("finalized");
      await page.setViewportSize({ width, height: 800 });
      await signInAndWait(page, department.nurseEmail);
      await page.goto(`${ABAN}&day=2026-10-25`);
      await expect(calendar(page)).toBeVisible();
      await expectNoHorizontalScroll(page);
      const box = (await calendar(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // Day cells stay comfortable touch targets.
      const cell = (await calendar(page)
        .getByRole("link", { name: /یکشنبه ۳ آبان ۱۴۰۵/ })
        .boundingBox())!;
      expect(cell.width).toBeGreaterThanOrEqual(40);
      expect(cell.height).toBeGreaterThanOrEqual(44);
    });
  }
});
