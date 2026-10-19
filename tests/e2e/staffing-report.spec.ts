import { expect, test, type Page } from "@playwright/test";

import {
  formatJalaliRange,
  jalaliMonthPeriod,
  nextJalaliMonth,
  parseJalaliMonthParam,
  jalaliMonthParam,
} from "../../src/features/calendar/jalali";
import { addDays } from "../../src/domain/shared/dates";
import { DEMO_USERS, signInAndWait } from "./support/auth";
import { provisionStaffingReport } from "./support/staffing-report";

const source = (page: Page) =>
  page.getByRole("region", { name: "منبع گزارش", exact: true });
const rows = (page: Page) =>
  page.locator("[data-staffing-row]:visible, [data-staffing-card]:visible");
const total = (page: Page, term: string) =>
  page
    .locator('dl[aria-label="خلاصه کل بازه گزارش"] dt')
    .filter({ hasText: term })
    .locator("xpath=following-sibling::dd");
async function noOverflow(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

test.describe("Head Nurse staffing coverage report", () => {
  test("provisional report, nursing coverage, accurate units, filters, keyboard and responsive layouts", async ({
    page,
  }, testInfo) => {
    const f = await provisionStaffingReport();
    await signInAndWait(page, f.head.email);
    await page.goto(`/departments/${f.department.code}/staffing`);
    await expect(
      page.getByRole("heading", {
        name: "گزارش پوشش و کمبود نیرو",
        exact: true,
      }),
    ).toBeVisible();
    await expect(source(page)).toContainText("گزارش موقت برنامه");
    await expect(page.getByText(/بازه واقعی گزارش:/)).toContainText("۵ روز");
    await expect(rows(page)).toHaveCount(15);
    await expect(total(page, "نوبت‌های دارای کمبود")).toHaveText("۱۲");
    await expect(total(page, "روزهای دارای کمبود")).toHaveText("۵");
    await expect(total(page, "نوبت‌های دارای مازاد")).toHaveText("۱");
    await expect(total(page, "جمع کمبود نفر-نوبت")).toHaveText("۱۲");
    await expect(rows(page).first()).toContainText("مازاد ۱ نفر-نوبت");
    await expect(rows(page).nth(1)).toContainText("بدون حداکثر");
    await expect(rows(page).first()).toContainText("استثنای تاریخ");
    await expect(
      page.getByText(
        "شیفت ME در پوشش صبح و عصر محاسبه می‌شود؛ منشی در پوشش پرستاری محاسبه نمی‌شود.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "تصمیم‌های برنامه کامل نیست؛ پوشش بر اساس تصمیم‌های ثبت‌شده محاسبه شده است.",
      ),
    ).toBeVisible();
    const status = page.getByRole("combobox", { name: "وضعیت پوشش" });
    await status.selectOption("EXCESS");
    const apply = page.getByRole("button", { name: "اعمال فیلتر" });
    await apply.focus();
    await expect(apply).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(1);
    await expect(page).toHaveURL(new RegExp(`schedule=${f.schedule.id}`));
    await expect(total(page, "نوبت‌های دارای کمبود")).toHaveText("۱۲");
    await expect(page.getByRole("status")).toContainText("نمایش ۱ از ۱۵ نوبت");
    await page.getByRole("combobox", { name: "نوبت پوشش" }).selectOption("N");
    await apply.click();
    await expect(
      page.getByRole("heading", { name: "نوبتی با این فیلتر وجود ندارد" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "نمایش همه نوبت‌ها" }).click();
    await expect(rows(page)).toHaveCount(15);
    await expect(
      page.getByRole("combobox", { name: "وضعیت پوشش" }),
    ).toHaveValue("ALL");
    await expect(page.getByRole("combobox", { name: "نوبت پوشش" })).toHaveValue(
      "ALL",
    );
    await noOverflow(page);
    if (testInfo.project.name === "desktop-chromium") {
      for (const [name, width, height] of [
        ["desktop", 1440, 1000],
        ["tablet", 820, 1180],
        ["mobile", 390, 844],
        ["narrow-mobile", 320, 740],
      ] as const) {
        await page.setViewportSize({ width, height });
        await noOverflow(page);
        await page.screenshot({
          path: testInfo.outputPath(`staffing-${name}.png`),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(
        page
          .getByRole("navigation", { name: "ناوبری اصلی" })
          .getByRole("link", { name: "گزارش پوشش نیرو", exact: true }),
      ).toBeVisible();
    }
  });

  test("official and eligible revision draft keep assignments AND rule pins isolated through filters", async ({
    page,
  }) => {
    const f = await provisionStaffingReport({ approved: true });
    await signInAndWait(page, f.head.email);
    await page.goto(
      `/departments/${f.department.code}/staffing?month=${f.month}&schedule=${f.schedule.id}`,
    );
    await expect(source(page)).toContainText("نسخه رسمی تأییدشده");
    await expect(source(page)).toContainText("تأیید در");
    await expect(page.locator("[data-rule-version]")).toHaveAttribute(
      "data-rule-version",
      f.officialPin,
    );
    await expect(total(page, "نوبت‌های دارای کمبود")).toHaveText("۱۲");
    await page
      .getByRole("link", { name: "پیش‌نویس اصلاحات — تأییدنشده", exact: true })
      .click();
    await expect(source(page)).toContainText("پیش‌نویس اصلاحات — تأییدنشده");
    await expect(source(page)).toContainText("نسخه رسمی مبنا");
    await expect(page.locator("[data-rule-version]")).toHaveAttribute(
      "data-rule-version",
      f.currentPin,
    );
    await expect(total(page, "نوبت‌های دارای کمبود")).toHaveText("۱۵");
    await expect(total(page, "جمع کمبود نفر-نوبت")).toHaveText("۳۹");
    await page.getByRole("combobox", { name: "نوبت پوشش" }).selectOption("N");
    await page.getByRole("button", { name: "اعمال فیلتر" }).click();
    await expect(rows(page)).toHaveCount(5);
    await expect(page).toHaveURL(/source=REVISION_DRAFT/);
    await expect(total(page, "جمع کمبود نفر-نوبت")).toHaveText("۳۹");
    await page
      .getByRole("link", { name: "نسخه رسمی تأییدشده", exact: true })
      .click();
    await expect(rows(page)).toHaveCount(5);
    await expect(total(page, "نوبت‌های دارای مازاد")).toHaveText("۱");
    await expect(page.locator("[data-rule-version]")).toHaveAttribute(
      "data-rule-version",
      f.officialPin,
    );
    await noOverflow(page);
  });

  test("overlapping partial schedules require a choice and empty schedules retain zero-coverage rows", async ({
    page,
  }) => {
    const f = await provisionStaffingReport({ multiple: true });
    await signInAndWait(page, f.head.email);
    await page.goto(
      `/departments/${f.department.code}/staffing?month=${f.month}`,
    );
    await expect(
      page.getByRole("heading", { name: "گزارش در دسترس نیست" }),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "برنامه مورد گزارش" })
      .selectOption(f.schedule.id);
    await page.getByRole("button", { name: "نمایش برنامه" }).click();
    await expect(rows(page)).toHaveCount(15);
    await page
      .getByRole("combobox", { name: "برنامه مورد گزارش" })
      .selectOption(f.second!.id);
    await page.getByRole("button", { name: "نمایش برنامه" }).click();
    await expect(rows(page)).toHaveCount(9);
    await expect(total(page, "نوبت‌های دارای کمبود")).toHaveText("۹");
    await expect(page.getByText(/بازه واقعی گزارش:/)).toContainText("۳ روز");
    await page.getByRole("link", { name: "ماه بعد" }).click();
    await expect(page).toHaveURL(new RegExp(`month=${f.nextMonth}`));
    await expect(rows(page)).toHaveCount(9);
    await expect(
      page.getByText(
        "تصمیم‌های برنامه کامل نیست؛ پوشش بر اساس تصمیم‌های ثبت‌شده محاسبه شده است.",
      ),
    ).toBeVisible();
    await page.getByRole("link", { name: "ماه بعد" }).click();
    await expect(
      page.getByRole("heading", { name: "برنامه‌ای برای این ماه وجود ندارد" }),
    ).toBeVisible();
  });

  test("cross-month actual periods and explicit draft choice survive month navigation", async ({
    page,
  }) => {
    const f = await provisionStaffingReport({
      approved: true,
      crossMonth: true,
    });
    await signInAndWait(page, f.head.email);
    await page.goto(
      `/departments/${f.department.code}/staffing?month=${f.month}&schedule=${f.schedule.id}&source=REVISION_DRAFT&bucket=E`,
    );
    const p = jalaliMonthPeriod(parseJalaliMonthParam(f.month)!);
    await expect(page.getByText(/بازه واقعی گزارش:/)).toContainText(
      formatJalaliRange(p.start, addDays(p.end, 2)),
    );
    await page.getByRole("link", { name: "ماه بعد" }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `month=${jalaliMonthParam(nextJalaliMonth(parseJalaliMonthParam(f.month)!))}`,
      ),
    );
    await expect(page).toHaveURL(new RegExp(`schedule=${f.schedule.id}`));
    await expect(page).toHaveURL(/source=REVISION_DRAFT/);
    await expect(page).toHaveURL(/bucket=E/);
    await expect(source(page)).toContainText("پیش‌نویس اصلاحات — تأییدنشده");
    await expect(page.getByText(/بازه واقعی گزارش:/)).toContainText(
      formatJalaliRange(p.start, addDays(p.end, 2)),
    );
    await noOverflow(page);
  });

  test("invalid input and unauthorized roles fail closed; unavailable draft never falls back", async ({
    page,
  }) => {
    const f = await provisionStaffingReport();
    await signInAndWait(page, f.head.email);
    const path = `/departments/${f.department.code}/staffing?month=${f.month}`;
    for (const query of [
      "schedule=bad",
      `schedule=${DEMO_USERS.icuHead.id}`,
      "source=bad",
      "source=DEFAULT&source=REVISION_DRAFT",
      "status=bad",
      "bucket=ME",
      "month=bad",
    ]) {
      await page.goto(`${path}&${query}`);
      await expect(
        page.getByRole("heading", { name: /پیدا نشد/ }),
      ).toBeVisible();
      await expect(rows(page)).toHaveCount(0);
    }
    await page.goto(`${path}&source=REVISION_DRAFT`);
    await expect(
      page.getByRole("heading", { name: "گزارش در دسترس نیست" }),
    ).toBeVisible();
    await expect(source(page)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
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
      await page.goto("/more");
      await expect(
        page.locator(`a[href="/departments/${f.department.code}/staffing"]`),
      ).toHaveCount(0);
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: /پیدا نشد/ }),
      ).toBeVisible();
      await expect(rows(page)).toHaveCount(0);
    }
  });
});
