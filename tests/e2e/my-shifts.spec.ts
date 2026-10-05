import { expect, test, type Page } from "@playwright/test";

import { DEMO_USERS, isDesktop, signInAndWait } from "./support/auth";
import { provisionApprovalDepartment } from "./support/approval";

/**
 * The review department's Aban (through the real use cases):
 * - planning: nurse 1 works M on 2 Aban (Saturday), N on 3 Aban (Sunday)
 *   and M on 4 Aban; nurse 2 E and the Head Nurse ME on 2 Aban.
 * - finalized and later: nurse 1's M on 4 Aban is cleared first.
 * Azar exists as an empty DRAFT; Dey has no schedule.
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
  test("planning: the nurse's current assignments with a prominent temporary warning", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("planning");
    await signInAndWait(page, department.nurseEmail);
    await page.goto(ABAN);

    await expect(
      page.getByRole("heading", { level: 2, name: "آبان ۱۴۰۵" }),
    ).toBeVisible();
    await expect(notice(page, "TEMPORARY")).toContainText(
      "برنامه موقت و در حال برنامه‌ریزی است؛ شیفت‌ها ممکن است تغییر کنند",
    );

    // Totals: M 7h + N 12h + M 7h, one night.
    await expect(tile(page, "شیفت‌ها")).toHaveText("۳");
    await expect(tile(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۲۶ ساعت");
    await expect(tile(page, "شیفت شب")).toHaveText("۱");

    // Only the nurse's own shifts are in the calendar.
    const table = calendar(page);
    await expect(
      table.getByRole("link", { name: "شنبه ۲ آبان ۱۴۰۵: صبح (M)، موقت" }),
    ).toBeVisible();
    await expect(table.locator('[data-shifts~="E"]')).toHaveCount(0);
    await expect(table.locator('[data-shifts~="ME"]')).toHaveCount(0);

    // Opening a day shows its hours and duration.
    await table
      .getByRole("link", { name: "یکشنبه ۳ آبان ۱۴۰۵: شب (N)، موقت" })
      .click();
    await expect(page).toHaveURL(/day=2026-10-25/);
    const detail = page.getByRole("region", { name: "یکشنبه ۳ آبان ۱۴۰۵" });
    await expect(detail).toContainText("۱۹:۰۰ تا ۰۷:۰۰ روز بعد");
    await expect(detail).toContainText("۱۲ ساعت");
    await expect(detail).toContainText("موقت");

    const agenda = page.getByRole("region", { name: "فهرست شیفت‌های ماه" });
    await expect(agenda.getByRole("listitem")).toHaveCount(30);
    await expectNoHorizontalScroll(page);

    // Another nurse sees only their own shift; there is no way to address
    // someone else's schedule (a user id in the URL is ignored).
    await switchUser(page, department.nurseEmail.replace("nurse1.", "nurse2."));
    await page.goto(`${ABAN}&user=${DEMO_USERS.icuNurse1.id}`);
    await expect(tile(page, "شیفت‌ها")).toHaveText("۱۴");
    await expect(
      calendar(page).getByRole("link", {
        name: "شنبه ۲ آبان ۱۴۰۵: عصر (E)، موقت",
      }),
    ).toBeVisible();
    await expect(
      calendar(page).getByRole("link", {
        name: "یکشنبه ۳ آبان ۱۴۰۵: استراحت، موقت",
      }),
    ).toBeVisible();

    // The Head Nurse sees their own planning-stage shift, and only theirs.
    await switchUser(page, department.headEmail);
    await page.goto(ABAN);
    await expect(notice(page, "TEMPORARY")).toBeVisible();
    await expect(tile(page, "شیفت‌ها")).toHaveText("۳۰");
    await expect(
      calendar(page).getByRole("link", {
        name: "شنبه ۲ آبان ۱۴۰۵: طولانی (ME)، موقت",
      }),
    ).toBeVisible();
    await expect(calendar(page).locator('[data-shifts~="N"]')).toHaveCount(0);
  });

  test("finalized: shown as not yet sent, with no approval pending", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await signInAndWait(page, department.nurseEmail);
    await page.goto(ABAN);
    const finalized = notice(page, "FINALIZED");
    await expect(finalized).toContainText(
      "نهایی‌شده، هنوز برای تأیید سوپروایزر ارسال نشده است",
    );
    await expect(finalized).toContainText("تأییدی در انتظار نیست");
    await expect(notice(page, "TEMPORARY")).toHaveCount(0);
    await expect(tile(page, "شیفت‌ها")).toHaveText("۲");
    await expect(tile(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۱۹ ساعت");
    await expect(
      calendar(page).getByRole("link", {
        name: "شنبه ۲ آبان ۱۴۰۵: صبح (M)، نهایی‌شده، ارسال‌نشده",
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
    await expect(notice(page, "FINALIZED")).toHaveCount(0);
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
    for (const state of ["TEMPORARY", "FINALIZED", "AWAITING_APPROVAL"])
      await expect(notice(page, state)).toHaveCount(0);
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

    // Azar is an empty draft: temporary, with a calendar and no shift.
    await page.getByRole("link", { name: "ماه بعد: آذر ۱۴۰۵" }).click();
    await expect(page).toHaveURL(/month=1405-09/);
    await expect(notice(page, "TEMPORARY")).toBeVisible();
    await expect(calendar(page)).toBeVisible();
    await expect(
      page.getByRole("note").filter({
        hasText: "در این ماه شیفتی برای شما ثبت نشده است.",
      }),
    ).toBeVisible();

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
      name: "یکشنبه ۳ آبان ۱۴۰۵: شب (N)، نهایی‌شده، ارسال‌نشده",
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
      // Planning carries the longest, most prominent notice.
      const department = await provisionApprovalDepartment("planning");
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
