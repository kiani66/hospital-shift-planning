import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { readWorkbook } from "../support/excel-templates";
import { signInAndWait, signOut } from "./support/auth";
import { MEHR_1405, provisionExcelExport } from "./support/excel-export";

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function fillMapping(page: Page) {
  await page.getByLabel("نام Sheet").fill("برنامه ماهانه");
  await page.getByLabel("ستون شماره پرسنلی").fill("B");
  await page.getByLabel("ردیف شروع پرسنل").fill("7");
  await page.getByLabel("ردیف پایان پرسنل").fill("12");
  await page.getByLabel("ستون روز اول").fill("F");
}

test("Head Nurse uploads a template, exports a partial DRAFT and replaces the template", async ({
  page,
}) => {
  const fixture = await provisionExcelExport();
  const code = fixture.department.code;
  await signInAndWait(page, fixture.head.email!);

  // Without a template the button explains what to do first.
  await page.goto(`/departments/${code}/schedule?month=1405-07`);
  await expect(page.getByRole("button", { name: "خروجی اکسل" })).toBeDisabled();
  await expect(
    page.getByText("برای خروجی اکسل ابتدا باید قالب Excel بخش بارگذاری شود"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "تنظیمات بخش", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/departments/${code}/settings$`));
  await expect(
    page.getByRole("heading", { name: "قالب خروجی اکسل" }),
  ).toBeVisible();

  await page.getByLabel("فایل قالب Excel").setInputFiles({
    name: "nicu-template.xlsx",
    mimeType: XLSX,
    buffer: fixture.template,
  });
  await fillMapping(page);
  await expect(
    page.getByRole("button", { name: "بارگذاری قالب" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "بررسی قالب" }).click();
  const summary = page.getByRole("region", { name: "خلاصه نگاشت" });
  await expect(summary).toContainText("قالب قابل فعال‌سازی است");
  await expect(summary).toContainText("B7:B12");
  await expect(summary).toContainText("(ستون پنهان)");
  await page.getByRole("button", { name: "بارگذاری قالب" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "قالب بارگذاری و فعال شد" }),
  ).toBeVisible();
  await expect(page.getByText("فعال و معتبر")).toBeVisible();
  await expect(page.getByText("nicu-template.xlsx").first()).toBeVisible();

  // The stored template downloads unchanged.
  const stored = page.waitForEvent("download");
  await page.getByRole("link", { name: "دانلود قالب فعلی" }).click();
  const storedFile = await stored;
  expect(storedFile.suggestedFilename()).toBe("nicu-template.xlsx");
  expect(await readFile((await storedFile.path())!)).toEqual(fixture.template);

  // Export the partially planned DRAFT.
  await page.goto(`/departments/${code}/schedule?month=1405-07`);
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی اکسل" }).click();
  const download = await exported;
  expect(download.suggestedFilename()).toBe(
    `${code.toUpperCase()}-schedule-1405-07.xlsx`,
  );
  const sheet = (
    await readWorkbook(new Uint8Array(await readFile((await download.path())!)))
  ).getWorksheet("برنامه ماهانه")!;
  const day = (row: number, d: number) =>
    sheet.getCell(row, 5 + d).value ?? null;
  // Rows: secretary 7, nurse 9, head 11 (the template's order, not the database's).
  expect([day(7, 1), day(7, 2), day(7, 3)]).toEqual(["M", null, "H"]);
  expect([day(9, 1), day(9, 2), day(9, 3)]).toEqual(["N", "OFF", null]);
  expect(Array.from({ length: 31 }, (_, d) => day(11, d + 1))).toEqual(
    Array(31).fill(null),
  );
  expect(sheet.getCell("B7").value).toBe(fixture.secretary.personnelNumber);
  expect(sheet.getCell("A3").value).toBe("برنامه ماه مهر ۱۴۰۵");
  expect(sheet.pageSetup.orientation).toBe("landscape");
  expect(MEHR_1405.start).toBe("2026-09-23");

  // Replacing asks for confirmation and takes effect at once.
  await page.goto(`/departments/${code}/settings`);
  await page.getByLabel("فایل قالب Excel").setInputFiles({
    name: "replacement.xlsx",
    mimeType: XLSX,
    buffer: fixture.replacement,
  });
  await page.getByRole("button", { name: "بررسی قالب" }).click();
  await expect(page.getByRole("region", { name: "خلاصه نگاشت" })).toContainText(
    "قالب قابل فعال‌سازی است",
  );
  await page.getByRole("button", { name: "جایگزینی قالب" }).click();
  const dialog = page.getByRole("dialog", { name: "جایگزینی قالب فعلی" });
  await dialog.getByLabel("جایگزینی قالب فعلی را تأیید می‌کنم.").check();
  await dialog.getByRole("button", { name: "جایگزینی قالب" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "قالب جدید جایگزین شد" }),
  ).toBeVisible();
  await expect(page.getByText("replacement.xlsx").first()).toBeVisible();

  await page.goto(`/departments/${code}/schedule?month=1405-07`);
  const again = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی اکسل" }).click();
  const second = (
    await readWorkbook(
      new Uint8Array(await readFile((await (await again).path())!)),
    )
  ).getWorksheet("برنامه ماهانه")!;
  // The nurse is now in row 7.
  expect(second.getCell(7, 6).value).toBe("N");
  expect(second.getCell(7, 7).value).toBe("OFF");

  // A secretary cannot open the settings.
  await signOut(page);
  await signInAndWait(page, fixture.secretary.email!);
  await page.goto(`/departments/${code}/settings`);
  await expect(
    page.getByRole("heading", { name: "قالب خروجی اکسل" }),
  ).toHaveCount(0);
  const response = await page.request.get(
    `/api/schedules/${fixture.schedule.id}/excel`,
  );
  expect(response.status()).toBe(404);
});

test("an invalid mapping shows the cell reference and cannot be saved", async ({
  page,
}) => {
  const fixture = await provisionExcelExport();
  await signInAndWait(page, fixture.head.email!);
  await page.goto(`/departments/${fixture.department.code}/settings`);
  await page.getByLabel("فایل قالب Excel").setInputFiles({
    name: "t.xlsx",
    mimeType: XLSX,
    buffer: fixture.template,
  });
  await fillMapping(page);
  // Day 1 in column C reads the names: not shift codes.
  await page.getByLabel("ستون روز اول").fill("C");
  await page.getByLabel("ستون شماره پرسنلی").fill("AL");
  await page.getByRole("button", { name: "بررسی قالب" }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "این قالب قابل فعال‌سازی نیست",
  );
  await expect(
    page.getByRole("button", { name: "بارگذاری قالب" }),
  ).toBeDisabled();
});
