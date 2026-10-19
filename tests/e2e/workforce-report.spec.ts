import { expect, test, type Page } from "@playwright/test";

import {
  jalaliMonthLabel,
  nextJalaliMonth,
  parseJalaliMonthParam,
} from "../../src/features/calendar/jalali";
import { DEMO_USERS, signInAndWait } from "./support/auth";
import { provisionWorkforceReport } from "./support/workforce-report";

const source = (page: Page) => page.getByRole("region", { name: "منبع گزارش" });
// dt/dd selectors match the semantic summary cards on every viewport.
const total = (page: Page, term: string) =>
  page
    .locator('dl[aria-label="خلاصه کل فهرست برنامه"] dt', { hasText: term })
    .locator("xpath=following-sibling::dd");
const visiblePerson = (page: Page, id: string) =>
  page.locator(`[data-workforce-person="${id}"]:visible`);
const reportRows = (page: Page) =>
  page.locator("[data-person-row]:visible, [data-person-card]:visible");
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
}

test.describe("Head Nurse workforce report", () => {
  test("current month, complete roster, actual period and keyboard-accessible daily detail", async ({
    page,
  }, testInfo) => {
    const fixture = await provisionWorkforceReport();
    await signInAndWait(page, fixture.head.email);
    const path = `/departments/${fixture.department.code}/workforce`;
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        name: jalaliMonthLabel(parseJalaliMonthParam(fixture.month)!),
      }),
    ).toBeVisible();
    await expect(source(page)).toContainText("گزارش موقت برنامه");
    await expect(page.getByText(/بازه واقعی گزارش:/)).toContainText("۵ روز");
    await expect(total(page, "اعضای فهرست برنامه")).toHaveText("۴");
    await expect(total(page, "شیفت‌های کاری")).toHaveText("۴");
    await expect(total(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۳۶ ساعت");
    await expect(reportRows(page)).toHaveCount(4);
    await expect(visiblePerson(page, fixture.head.id)).toBeVisible();
    await expect(visiblePerson(page, fixture.secretary.id)).toBeVisible();
    await expect(visiblePerson(page, fixture.inactive.id)).toBeVisible();
    const trigger = visiblePerson(page, fixture.nurse.id);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: `جزئیات پرسنل — ${fixture.nurse.displayName}`,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toBeFocused();
    const days = dialog.getByRole("list", { name: "تصمیم‌های روزانه پرسنل" });
    await expect(days.getByRole("listitem")).toHaveCount(5);
    await expect(days).toContainText("OFF");
    await expect(days).toContainText("H");
    await expect(days).toContainText("UNDECIDED");
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "بستن جزئیات پرسنل" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page).not.toHaveURL(/person=/);
    await noOverflow(page);
    if (testInfo.project.name === "desktop-chromium") {
      for (const [name, width, height] of [
        ["desktop", 1440, 1000],
        ["tablet", 820, 1180],
        ["mobile", 390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        await noOverflow(page);
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          window.scrollTo(0, 0);
        });
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await page.screenshot({
          path: testInfo.outputPath(`workforce-${name}.png`),
          fullPage: true,
        });
      }
      // The navigation uses the same shared sections on desktop and phone drawer.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(
        page
          .getByRole("navigation", { name: "ناوبری اصلی" })
          .getByRole("link", { name: "گزارش پرسنل", exact: true }),
      ).toBeVisible();
    }
  });

  test("multiple partial schedules require a choice; month navigation and distinct empty states", async ({
    page,
  }) => {
    const f = await provisionWorkforceReport({ multiple: true });
    await signInAndWait(page, f.head.email);
    const path = `/departments/${f.department.code}/workforce`;
    await page.goto(`${path}?month=${f.month}`);
    await expect(
      page.getByRole("heading", { name: "گزارش در دسترس نیست" }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "برنامه مورد گزارش" }),
    ).toBeVisible();
    await expect(
      page.locator('[aria-label="خلاصه کل فهرست برنامه"]'),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "برنامه مورد گزارش" })
      .selectOption(f.schedule.id);
    await page.getByRole("button", { name: "نمایش برنامه" }).click();
    await expect(reportRows(page)).toHaveCount(4);
    await page
      .getByRole("combobox", { name: "برنامه مورد گزارش" })
      .selectOption(f.second!.id);
    await page.getByRole("button", { name: "نمایش برنامه" }).click();
    await expect(
      page.getByText(
        "فهرست این برنامه عضو ندارد؛ گزارشی برای نمایش موجود نیست.",
      ),
    ).toBeVisible();
    await page.getByRole("link", { name: "ماه بعد" }).click();
    await expect(page).toHaveURL(new RegExp(`month=${f.nextMonth}`));
    await expect(page.getByText(/هنوز هیچ تصمیمی ثبت نشده است/)).toBeVisible();
    await expect(reportRows(page)).toHaveCount(4);
    await expect(total(page, "روزهای تعیین‌نشده")).toHaveText("۱۲");
    await page.getByRole("link", { name: "ماه بعد" }).click();
    const noSchedule = jalaliMonthLabel(
      nextJalaliMonth(parseJalaliMonthParam(f.nextMonth)!),
    );
    await expect(page.getByRole("heading", { name: noSchedule })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "برنامه‌ای برای این ماه وجود ندارد" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "ماه قبل" }).click();
    await expect(page.getByText(/هنوز هیچ تصمیمی ثبت نشده است/)).toBeVisible();
    await noOverflow(page);
  });

  test("approved and revision sources stay isolated through search, numeric sorting and detail", async ({
    page,
  }) => {
    const f = await provisionWorkforceReport({ approved: true });
    await signInAndWait(page, f.head.email);
    const path = `/departments/${f.department.code}/workforce?month=${f.month}&schedule=${f.schedule.id}`;
    await page.goto(path);
    await expect(source(page)).toContainText("نسخه رسمی تأییدشده");
    await expect(source(page)).toContainText("تأیید در");
    await expect(total(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۳۶ ساعت");
    await visiblePerson(page, f.nurse.id).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("list")).toContainText("UNDECIDED");
    await expect(
      dialog.getByRole("list").getByRole("listitem").first(),
    ).toContainText("M");
    await page.keyboard.press("Escape");
    await page
      .getByRole("link", { name: "پیش‌نویس اصلاحات", exact: true })
      .click();
    await expect(source(page)).toContainText("پیش‌نویس اصلاحات — تأییدنشده");
    await expect(total(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۴۶ ساعت");
    await page
      .getByRole("combobox", { name: "مرتب‌سازی", exact: true })
      .selectOption("minutes");
    await page
      .getByRole("combobox", { name: "ترتیب", exact: true })
      .selectOption("desc");
    await page.getByRole("button", { name: "اعمال", exact: true }).click();
    await expect(reportRows(page).first()).toContainText(f.nurse.displayName);
    await expect(page).toHaveURL(/source=REVISION_DRAFT/);
    await page
      .getByRole("textbox", { name: "جست‌وجوی نام یا شماره پرسنلی" })
      .fill(
        f.nurse.personnelNumber!.replace(
          /\d/g,
          (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!,
        ),
      );
    await page.getByRole("button", { name: "اعمال", exact: true }).click();
    await expect(reportRows(page)).toHaveCount(1);
    await expect(total(page, "اعضای فهرست برنامه")).toHaveText("۴");
    await visiblePerson(page, f.nurse.id).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("پیش‌نویس اصلاحات — تأییدنشده");
    await expect(dialog).toContainText(f.nurse.personnelNumber!);
    await expect(dialog.getByRole("list")).not.toContainText("UNDECIDED");
    await expect(
      dialog.getByRole("list").getByRole("listitem").first(),
    ).toContainText("E");
    await expect(page).toHaveURL(/source=REVISION_DRAFT/);
    await expect(page).toHaveURL(/sort=minutes/);
    await expect(page).toHaveURL(/order=desc/);
    await page.keyboard.press("Escape");
    await page
      .getByRole("link", { name: "نسخه رسمی تأییدشده", exact: true })
      .click();
    await expect(total(page, "ساعات برنامه‌ریزی‌شده")).toHaveText("۳۶ ساعت");
    await expect(reportRows(page)).toHaveCount(1);
    await noOverflow(page);
  });

  test("invalid identities and parameters fail closed; unavailable draft never falls back", async ({
    page,
  }) => {
    const f = await provisionWorkforceReport();
    await signInAndWait(page, f.head.email);
    const path = `/departments/${f.department.code}/workforce?month=${f.month}`;
    for (const query of [
      "schedule=bad",
      `schedule=${DEMO_USERS.icuHead.id}`,
      "source=bad",
      "source=DEFAULT&source=REVISION_DRAFT",
      "person=bad",
      `person=${DEMO_USERS.icuNurse1.id}`,
      "sort=bad",
      "month=bad",
    ]) {
      const response = await page.goto(`${path}&${query}`);
      // Streamed Next pages can return 200 with the not-found boundary; its
      // visible identity is the same for malformed, foreign and missing IDs.
      expect([200, 404]).toContain(response!.status());
      await expect(
        page.getByRole("heading", { name: /پیدا نشد/ }),
      ).toBeVisible();
      await expect(
        page.locator('[aria-label="خلاصه کل فهرست برنامه"]'),
      ).toHaveCount(0);
    }
    await page.goto(`${path}&source=REVISION_DRAFT`);
    await expect(
      page.getByRole("heading", { name: "گزارش در دسترس نیست" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "پیش‌نویس اصلاحات", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.locator('[aria-label="خلاصه کل فهرست برنامه"]'),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "مشاهده گزارش پیش‌فرض" }).click();
    await expect(source(page)).toContainText("گزارش موقت برنامه");
    for (const email of [
      f.nurse.email,
      f.secretary.email,
      DEMO_USERS.supervisor.email,
      DEMO_USERS.erHead.email,
    ]) {
      await page.context().clearCookies();
      await signInAndWait(page, email);
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: /پیدا نشد/ }),
      ).toBeVisible();
      await expect(
        page.locator('[aria-label="خلاصه کل فهرست برنامه"]'),
      ).toHaveCount(0);
    }
  });
});
