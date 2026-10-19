import { expect, test } from "@playwright/test";

import { addDays } from "../../src/domain/shared/dates";
import { todayIn } from "../../src/infrastructure/auth/actor";
import { signInAndWait } from "./support/auth";
import { provisionApprovalDepartment } from "./support/approval";
import { createRequestAs } from "./support/requests";

const week = "/my-shifts?view=week&start=2026-10-23&day=2026-10-24";

test("nurse landing defaults to seven days from today; range navigation and view preference survive reload", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment("finalized");
  await signInAndWait(page, department.nurseEmail);
  const today = todayIn("Asia/Tehran");
  const calendar = page.getByRole("list", { name: "تقویم هفتگی شیفت‌های شما" });
  await expect(calendar.getByRole("link")).toHaveCount(7);
  await expect(calendar.locator("[data-date]").first()).toHaveAttribute(
    "data-date",
    today,
  );
  await expect(calendar.locator("[data-date]").last()).toHaveAttribute(
    "data-date",
    addDays(today, 6),
  );
  await page.getByRole("link", { name: "هفت روز بعد", exact: true }).click();
  await expect(calendar.locator("[data-date]").first()).toHaveAttribute(
    "data-date",
    addDays(today, 7),
  );
  await page.getByRole("link", { name: "هفت روز قبل", exact: true }).click();
  await expect(calendar.locator("[data-date]").first()).toHaveAttribute(
    "data-date",
    today,
  );
  await page.getByRole("link", { name: "ماهانه", exact: true }).click();
  await expect(
    page
      .getByRole("navigation", { name: "نمای تقویم" })
      .getByRole("link", { name: "ماهانه" }),
  ).toHaveAttribute("aria-current", "page");
  await page.goto("/my-shifts");
  await expect(
    page
      .getByRole("navigation", { name: "نمای تقویم" })
      .getByRole("link", { name: "ماهانه" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "هفتگی", exact: true }).click();
  // A click does not wait for the Next.js navigation to commit in WebKit.
  await expect(page).toHaveURL(`/my-shifts?view=week&start=${today}`);
  await expect(calendar.getByRole("link")).toHaveCount(7);
  await page.goto("/my-shifts");
  await expect(calendar.getByRole("link")).toHaveCount(7);
});

test("selected-shift coworkers, explicit OFF and requests work in Persian RTL at narrow and wide sizes", async ({
  page,
}, testInfo) => {
  const department = await provisionApprovalDepartment("finalized");
  await createRequestAs(department, department.nurseEmail, {
    type: "UNAVAILABLE",
    date: "2026-10-24",
  });
  await signInAndWait(page, department.nurseEmail);
  await page.goto(week);
  const coworkers = page.getByRole("region", { name: "همکاران این شیفت" });
  await expect(coworkers.getByRole("listitem")).toHaveCount(1); // M overlaps Head Nurse's ME only.
  await expect(coworkers).not.toContainText(department.nurseNames[0]!);
  const requests = page.getByRole("region", { name: "درخواست‌های من" });
  await expect(requests).toContainText("عدم امکان حضور");
  await expect(requests).toContainText("در انتظار بررسی");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const selected = page.locator('[data-date="2026-10-24"]');
  await expect(selected).toHaveAttribute("data-selected", "true");
  await selected.focus();
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAccessibleName(/صبح \(M\)/);

  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      `${width}px overflow`,
    ).toBe(0);
    const layout = await page
      .getByRole("list", { name: "تقویم هفتگی شیفت‌های شما" })
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => {
          const rect = link.getBoundingClientRect();
          return {
            x: rect.x,
            width: rect.width,
            height: rect.height,
            textFits: link.scrollWidth <= link.clientWidth,
          };
        }),
      );
    expect(layout.every((cell) => cell.height >= 44 && cell.textFits)).toBe(
      true,
    );
    expect(layout[0]!.x).toBeGreaterThan(layout[6]!.x); // RTL order.
    if (
      testInfo.project.name === "desktop-chromium" &&
      (width === 375 || width === 1440)
    ) {
      await selected.blur();
      await page.screenshot({
        path: testInfo.outputPath(`nurse-dashboard-${width}.png`),
        fullPage: true,
      });
    }
  }

  // Keyboard selection changes the day and the coworker list.
  await page.locator('[data-date="2026-10-26"]').focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/day=2026-10-26/);
  await expect(coworkers).toContainText("در این روز شیفت کاری ندارید");
  await expect(
    page.getByRole("region", { name: "دوشنبه ۴ آبان ۱۴۰۵" }),
  ).toContainText("OFF");
  await page.getByRole("link", { name: "ماهانه", exact: true }).click();
  await expect(
    page.getByRole("table", { name: /تقویم شیفت‌های شما/ }),
  ).toBeVisible();
  await expect(coworkers).toContainText("در این روز شیفت کاری ندارید");
});

test("planning coworkers stay private; a missing assignment is never labeled OFF", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment("draft");
  await signInAndWait(page, department.nurseEmail);
  await page.goto(week);
  const coworkers = page.getByRole("region", { name: "همکاران این شیفت" });
  await expect(coworkers).toContainText("پس از نهایی شدن برنامه");
  await expect(coworkers.getByRole("list")).toHaveCount(0);
  await page.goto("/my-shifts?view=week&start=2026-12-01");
  const calendar = page.getByRole("list", { name: "تقویم هفتگی شیفت‌های شما" });
  await expect(calendar.getByRole("link")).toHaveCount(7);
  await expect(calendar).not.toContainText("OFF");
  await expect(calendar.getByRole("link").first()).toContainText("تعیین‌نشده");
  await expect(coworkers).toContainText("در این روز شیفت کاری ندارید");
  await expect(
    page.getByRole("region", { name: "درخواست‌های من" }),
  ).toContainText("هنوز درخواستی ثبت نشده است");
});

test("the next-shift countdown transitions to an active overnight shift and then the empty state", async ({
  page,
}) => {
  const department = await provisionApprovalDepartment("finalized");
  await signInAndWait(page, department.nurseEmail);
  await page.clock.setFixedTime(new Date("2026-10-25T15:29:01Z"));
  await expect(page.getByTestId("next-shift")).toContainText(
    "۱ دقیقه تا شروع شیفت",
  );
  await page.clock.setFixedTime(new Date("2026-10-25T15:30:00Z"));
  await expect(
    page.getByRole("heading", { name: "شیفت در حال انجام" }),
  ).toBeVisible();
  await expect(page.getByTestId("next-shift")).toContainText("N");
  await page.clock.setFixedTime(new Date("2026-10-26T01:30:00Z"));
  await expect(page.getByTestId("next-shift")).toContainText(
    "اکنون در این شیفت هستید",
  );
  await page.clock.setFixedTime(new Date("2026-10-26T03:30:00Z"));
  await expect(page.getByTestId("next-shift")).toContainText(
    "فعلاً شیفت پیش رویی برای شما ثبت نشده است",
  );
});
