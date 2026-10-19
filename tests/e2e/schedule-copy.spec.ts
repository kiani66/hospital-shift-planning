import { openScheduleActions } from "./support/schedule-toolbar";
import { expect, test } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import {
  provisionBoundaryCopyDepartment,
  provisionCopyDepartment,
  copyState,
} from "./support/schedule-copy";

const copyDialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "کپی برنامه", exact: true });

test("Head Nurse previews conflicts and target preferences, then applies only allowed assignments", async ({
  page,
}, testInfo) => {
  const d = await provisionCopyDepartment();
  const before = await copyState(d);
  await signInAndWait(page, d.headEmail);
  await page.goto(`/departments/${d.code}/schedule?month=1405-09`);
  await openScheduleActions(page);
  await page.getByRole("button", { name: "کپی برنامه", exact: true }).click();
  const dialog = copyDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("برنامه مبدأ").selectOption(d.abanId);
  await dialog.getByLabel("نوع کپی").selectOption("DAY");
  await dialog
    .getByRole("combobox", { name: "روز مبدأ", exact: true })
    .selectOption("2026-10-24");
  await dialog
    .getByRole("combobox", { name: "روز مقصد", exact: true })
    .selectOption("2026-11-23");
  await dialog.getByRole("button", { name: "پیش‌نمایش کپی" }).click();
  const result = dialog.getByRole("region", { name: "نتیجه پیش‌نمایش کپی" });
  await expect(result).toContainText("۴ انتساب بررسی شد");
  await expect(result).toContainText("۳ قابل انتقال");
  await expect(result).toContainText("۱ تداخل");
  await expect(result).toContainText("مرخصی ثبت‌شده مقصد حفظ می‌شود");
  await result.getByText("۱ مغایرت با ترجیح مقصد (توصیه‌ای)").click();
  await expect(result).toContainText("مانع ثبت نیست");
  expect(await copyState(d)).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath("copy-preview.png"),
    fullPage: true,
  });
  await testInfo.attach("Copy preview", {
    path: testInfo.outputPath("copy-preview.png"),
    contentType: "image/png",
  });
  await dialog.getByRole("button", { name: "تأیید و کپی برنامه" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("status").filter({ hasText: "۳ انتساب کپی شد" }),
  ).toBeVisible();
  const after = await copyState(d);
  expect(after.source).toEqual(before.source);
  expect(after.target).toHaveLength(4);
  expect(after.target.map((a) => a.shift).sort()).toEqual([
    "H",
    "M",
    "ME",
    "N",
  ]);
  await page.goto(
    `/departments/${d.code}/schedule?month=1405-09&day=2026-11-23`,
  );
  await expect(page.getByRole("dialog")).toContainText("پرستار آزمایشی ۱");
  await expect(page.getByRole("dialog")).toContainText("مرخصی");
  await page.screenshot({
    path: testInfo.outputPath("copy-calendar.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("full-month correctable rule preview allows Apply and Cancel leaves all data untouched", async ({
  page,
}, testInfo) => {
  const d = await provisionCopyDepartment();
  const before = await copyState(d);
  await signInAndWait(page, d.headEmail);
  await page.goto(`/departments/${d.code}/schedule?month=1405-09`);
  await openScheduleActions(page);
  await page.getByRole("button", { name: "کپی برنامه", exact: true }).click();
  const dialog = copyDialog(page);
  await dialog.getByRole("button", { name: "پیش‌نمایش کپی" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "تا زمان رفع خطاهای الزامی",
  );
  await expect(dialog.getByRole("status")).toContainText("قابل انتقال");
  await expect(dialog.getByRole("alert")).toContainText("روز بعد");
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("عدم رعایت استراحت پس از شیفت شب");
  await expect(alert).toContainText("کمبود نیروی موردنیاز");
  await expect(alert).not.toContainText(
    /NIGHT_REST|STAFFING|BELOW_MINIMUM|ABOVE_MAXIMUM|\d{4}-\d{2}-\d{2}/,
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    dialog.getByRole("button", { name: "تأیید و کپی برنامه" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("copy-hard-conflict.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await copyState(d)).toEqual(before);
});

test("same-schedule overlapping range and selected personnel preserve occupied cells", async ({
  page,
}) => {
  const d = await provisionCopyDepartment();
  const before = await copyState(d);
  await signInAndWait(page, d.headEmail);
  await page.goto(`/departments/${d.code}/schedule?month=1405-08`);
  await openScheduleActions(page);
  await page.getByRole("button", { name: "کپی برنامه", exact: true }).click();
  const dialog = copyDialog(page);
  await dialog.getByLabel("برنامه مبدأ").selectOption(d.abanId);
  await dialog.getByLabel("نوع کپی").selectOption("RANGE");
  await dialog
    .getByRole("combobox", { name: "شروع مبدأ", exact: true })
    .selectOption("2026-10-24");
  await dialog
    .getByRole("combobox", { name: "پایان مبدأ", exact: true })
    .selectOption("2026-10-26");
  await dialog
    .getByRole("combobox", { name: "شروع مقصد", exact: true })
    .selectOption("2026-10-25");
  await dialog.getByLabel("فقط پرسنل انتخاب‌شده").check();
  await dialog.getByLabel("پرستار آزمایشی ۱", { exact: true }).check();
  await dialog.getByRole("button", { name: "پیش‌نمایش کپی" }).click();
  await expect(dialog).toContainText("۳ انتساب بررسی شد");
  await expect(dialog).toContainText("۱ قابل انتقال");
  await expect(dialog).toContainText("۲ تداخل");
  await dialog.getByRole("button", { name: "تأیید و کپی برنامه" }).click();
  await expect(dialog).toBeHidden();
  const after = await copyState(d);
  expect(after.target).toEqual(before.target);
  expect(after.source).toHaveLength(before.source.length + 1);
  expect(after.source.filter((a) => a.date !== "2026-10-27")).toEqual(
    before.source,
  );
  expect(after.source.find((a) => a.date === "2026-10-27")!.shift).toBe("M");
});

test("Mehr-to-Aban copy keeps cross-month rest visible until corrected before Finalize", async ({
  page,
}, testInfo) => {
  const d = await provisionBoundaryCopyDepartment();
  await signInAndWait(page, d.headEmail);
  await page.goto(`/departments/${d.code}/schedule?month=1405-08`);
  await openScheduleActions(page);
  await page.getByRole("button", { name: "کپی برنامه", exact: true }).click();
  const dialog = copyDialog(page);
  await dialog.getByLabel("برنامه مبدأ").selectOption(d.mehrId);
  await dialog.getByRole("button", { name: "پیش‌نمایش کپی" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("عدم رعایت استراحت پس از شیفت شب");
  await expect(alert).not.toContainText(
    /NIGHT_REST|STAFFING|BELOW_MINIMUM|ABOVE_MAXIMUM/,
  );
  await expect(alert).toContainText("ماه قبل");
  await expect(alert).toContainText(d.nurseNames[0]!);
  await expect(
    dialog.getByRole("button", { name: "تأیید و کپی برنامه" }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("cross-month-preview.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "تأیید و کپی برنامه" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "برخی مغایرت‌ها نیاز به اصلاح دارند" }),
  ).toBeVisible();
  const header = page.locator(
    'section[aria-labelledby="schedule-month-heading"]',
  );
  await expect(
    header.getByRole("button", { name: "نهایی‌سازی برنامه" }),
  ).toBeDisabled();
  await expect(page.locator("#workflow-blockers")).toContainText("۱ نقض قانون");
  await page.goto(
    `/departments/${d.code}/schedule?month=1405-08&day=2026-10-23`,
  );
  const day = page.getByRole("dialog");
  await expect(day).toContainText("مانع نهایی‌سازی");
  await expect(day).toContainText("۳۰ مهر");
  await day
    .getByRole("group", { name: `شیفت ${d.nurseNames[0]}` })
    .getByRole("button", { name: "استراحت (OFF)" })
    .click();
  await expect(day.getByRole("status").first()).toContainText("ثبت شد");
  await day.getByRole("button", { name: "بستن جزئیات روز" }).click();
  await expect(page.locator("#workflow-blockers")).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: "نهایی‌سازی برنامه" }),
  ).toBeEnabled();
  await header.getByRole("button", { name: "نهایی‌سازی برنامه" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "بله، نهایی شود" })
    .click();
  await expect(header.getByText("نهایی‌شده", { exact: true })).toBeVisible();
});
