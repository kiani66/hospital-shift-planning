import { expect, test } from "@playwright/test";
import { signInAndWait, signOut } from "./support/auth";
import { provisionScheduleImport } from "./support/schedule-import";

test("Head Nurse previews and imports Mehr with secretary, blank OFF, H and RTL mobile grid", async ({
  page,
}) => {
  const fixture = await provisionScheduleImport();
  await signInAndWait(page, fixture.headEmail);
  await page.goto(`/departments/${fixture.department.code}/schedule/import`);
  await expect(
    page.getByRole("heading", { name: "ورود برنامه ماهانه از Excel" }),
  ).toBeVisible();
  await page.getByLabel("سال شمسی").fill("1405");
  await page.getByLabel("ماه", { exact: true }).selectOption("7");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "دانلود الگوی Excel این ماه" }).click();
  expect((await download).suggestedFilename()).toBe("schedule-1405-7.xlsx");
  await page.getByLabel("فایل برنامه ماهانه (.xlsx)").setInputFiles({
    name: "nicu-sanitized.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture.bytes,
  });
  await page.getByRole("button", { name: "بارگذاری و بررسی فایل" }).click();
  const preview = page.getByRole("region", { name: "پیش‌نمایش برنامه ماهانه" });
  await expect(preview).toBeVisible();
  await expect(preview.getByText("منشی", { exact: true })).toBeVisible();
  const grid = page.getByRole("region", { name: "جدول پیش‌نمایش ماه" });
  await expect(
    grid.getByRole("rowheader", {
      name: new RegExp(fixture.people[2]!.displayName),
    }),
  ).toContainText("منشی");
  const row = grid.getByRole("row", {
    name: new RegExp(fixture.people[2]!.displayName),
  });
  await expect(row.getByRole("cell").nth(3)).toHaveText("OFF");
  await expect(row.getByRole("cell").nth(5)).toHaveText("H");
  expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.getByLabel(/پیش‌نمایش و هشدارها را بررسی/).check();
  await page.getByRole("button", { name: "تأیید و ثبت برنامه" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "تصمیم روزانه ثبت شد" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "مشاهده برنامه ماهانه" }).click();
  await expect(page).toHaveURL(/schedule\?schedule=/);
  await page.goto(`/departments/${fixture.department.code}/schedule/import`);
  await page.getByLabel("سال شمسی").fill("1405");
  await page.getByLabel("ماه", { exact: true }).selectOption("7");
  await page.getByLabel("فایل برنامه ماهانه (.xlsx)").setInputFiles({
    name: "repeat.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture.bytes,
  });
  await page.getByRole("button", { name: "بارگذاری و بررسی فایل" }).click();
  await expect(
    page.getByRole("button", { name: "تأیید و ثبت برنامه" }),
  ).toBeDisabled();
  await signOut(page);
  await signInAndWait(page, fixture.secretaryEmail);
  await page.goto(`/departments/${fixture.department.code}/schedule/import`);
  await expect(
    page.getByRole("heading", { name: "ورود برنامه ماهانه از Excel" }),
  ).toHaveCount(0);
});

test("invalid codes block Excel commit and show cell errors", async ({
  page,
}) => {
  const fixture = await provisionScheduleImport();
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    fixture.bytes as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  workbook.worksheets[0]!.getCell("C2").value = "MN";
  await signInAndWait(page, fixture.headEmail);
  await page.goto(`/departments/${fixture.department.code}/schedule/import`);
  await page.getByLabel("سال شمسی").fill("1405");
  await page.getByLabel("ماه", { exact: true }).selectOption("7");
  await page.getByLabel("فایل برنامه ماهانه (.xlsx)").setInputFiles({
    name: "invalid.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  });
  await page.getByRole("button", { name: "بارگذاری و بررسی فایل" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "C2" })).toContainText(
    "کد روز نامعتبر",
  );
  await expect(
    page.getByRole("button", { name: "تأیید و ثبت برنامه" }),
  ).toBeDisabled();
});
