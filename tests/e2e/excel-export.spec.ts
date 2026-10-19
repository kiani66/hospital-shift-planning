import { openScheduleActions } from "./support/schedule-toolbar";
import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { readWorkbook } from "../support/excel-templates";
import { signInAndWait, signOut } from "./support/auth";
import { MEHR_1405, provisionExcelExport } from "./support/excel-export";

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The template upload and mapping form (the preparation form has similar labels). */
const mappingForm = (page: Page) =>
  page.getByRole("form", { name: "فایل قالب و نگاشت" });

async function fillMapping(page: Page) {
  const form = mappingForm(page);
  await form.getByLabel("نام Sheet").fill("برنامه ماهانه");
  await form.getByLabel("ستون شماره پرسنلی").fill("B");
  await form.getByLabel("ردیف شروع پرسنل").fill("7");
  await form.getByLabel("ردیف پایان پرسنل").fill("12");
  await form.getByLabel("ستون روز اول").fill("F");
}

test("Head Nurse uploads a template, exports a partial DRAFT and replaces the template", async ({
  page,
}) => {
  const fixture = await provisionExcelExport();
  const code = fixture.department.code;
  await signInAndWait(page, fixture.head.email!);

  // Without a template the button explains what to do first.
  await page.goto(`/departments/${code}/schedule?month=1405-07`);
  await openScheduleActions(page);
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
  await openScheduleActions(page);
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
  // OFF is a blank cell; an undecided day is ?, never blank.
  expect([day(7, 1), day(7, 2), day(7, 3)]).toEqual(["M", "?", "H"]);
  expect([day(9, 1), day(9, 2), day(9, 3)]).toEqual(["N", null, "?"]);
  expect(Array.from({ length: 31 }, (_, d) => day(11, d + 1))).toEqual([
    ...Array(30).fill("?"),
    null, // Mehr has 30 days.
  ]);
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
  await openScheduleActions(page);
  await page.getByRole("button", { name: "خروجی اکسل" }).click();
  const second = (
    await readWorkbook(
      new Uint8Array(await readFile((await (await again).path())!)),
    )
  ).getWorksheet("برنامه ماهانه")!;
  // The nurse is now in row 7.
  expect(second.getCell(7, 6).value).toBe("N");
  expect(second.getCell(7, 7).value ?? null).toBeNull();

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
  await mappingForm(page).getByLabel("ستون روز اول").fill("C");
  await mappingForm(page).getByLabel("ستون شماره پرسنلی").fill("AL");
  await page.getByRole("button", { name: "بررسی قالب" }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "این قالب قابل فعال‌سازی نیست",
  );
  await expect(
    page.getByRole("button", { name: "بارگذاری قالب" }),
  ).toBeDisabled();
});

test("NICU workbook: printed personnel numbers, calendar, Fridays, statistics and print layout", async ({
  page,
}) => {
  const fixture = await provisionExcelExport();
  const code = fixture.department.code;
  await signInAndWait(page, fixture.head.email!);
  await page.goto(`/departments/${code}/settings`);

  // 1. Upload and validate the workbook with the NICU mapping as approved.
  const form = mappingForm(page);
  await form.getByLabel("فایل قالب Excel").setInputFiles({
    name: "Template_Export.xlsx",
    mimeType: XLSX,
    buffer: fixture.nicu,
  });
  await form.getByLabel("نام Sheet").fill("Sheet2");
  await form.getByLabel("ستون شماره پرسنلی").fill("B");
  await form.getByLabel("ردیف شروع پرسنل").fill("7");
  await form.getByLabel("ردیف پایان پرسنل").fill("22");
  await form.getByLabel("ستون روز اول").fill("N");
  await form.getByLabel("ردیف عنوان روزها").fill("6");
  // The statistics in H–L and the coverage in rows 23–25 are kept by hand:
  // no statistic column is mapped, and the coverage rows are manual.
  await form.getByLabel("ردیف‌های خلاصه دستی").fill("23, 24, 25");
  await form.getByLabel("ردیف روزهای هفته").fill("5");
  await form.getByLabel("شکل روز هفته").selectOption("NARROW");
  await form.getByLabel("خانه عنوان ماه").fill("U3");
  await form.getByLabel("خانه رنگ جمعه").fill("P7");
  await form.getByLabel("ستون رنگ روز عادی").fill("O");
  await form.getByRole("button", { name: "بررسی قالب" }).click();
  const summary = page.getByRole("region", { name: "خلاصه نگاشت" });
  await expect(summary).toContainText("قالب قابل فعال‌سازی است");
  await expect(summary).toContainText("B7:B22");
  await expect(summary).toContainText("مقدار دستی حفظ می‌شود");
  await expect(summary).not.toContainText("آمار پرسنل");
  await expect(summary).not.toContainText("(ستون پنهان)");
  await expect(summary).toContainText(fixture.nurse.displayName);
  await expect(summary).toContainText("A1:AS31");
  // The header rows already carry the holiday fill on every day.
  await expect(summary).toContainText("همان رنگ تعطیل است");
  await form.getByRole("button", { name: "بارگذاری قالب" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "قالب بارگذاری و فعال شد" }),
  ).toBeVisible();

  // 2. Export the partially planned Mehr 1405 DRAFT.
  await page.goto(`/departments/${code}/schedule?month=1405-07`);
  const exported = page.waitForEvent("download");
  await openScheduleActions(page);
  await page.getByRole("button", { name: "خروجی اکسل" }).click();
  const sheet = (
    await readWorkbook(
      new Uint8Array(await readFile((await (await exported).path())!)),
    )
  ).getWorksheet("Sheet2")!;
  const day = (row: number, d: number) =>
    sheet.getCell(row, 13 + d).value ?? null;
  expect([day(8, 1), day(8, 2), day(8, 3)]).toEqual(["N", null, "?"]);
  expect([day(22, 1), day(22, 2), day(22, 3)]).toEqual(["M", "?", "H"]);
  expect(day(7, 1)).toBe("?");
  expect(day(8, 31)).toBeNull(); // Mehr has 30 days.
  // The hospital's own statistics and coverage stay exactly as uploaded.
  const saved = (await readWorkbook(new Uint8Array(fixture.nicu))).getWorksheet(
    "Sheet2",
  )!;
  for (const address of ["H8", "I8", "J8", "K8", "L8", "J22", "L22"])
    expect(sheet.getCell(address).value, address).toEqual(
      saved.getCell(address).value,
    );
  expect(saved.getCell("L8").value).not.toBeNull();
  for (const row of [23, 24, 25]) {
    expect(day(row, 1)).toBe(saved.getCell(row, 14).value);
    expect(day(row, 29)).toBe(saved.getCell(row, 42).value);
    // Mehr has 30 days: the saved 31st day's coverage is cleared.
    expect(saved.getCell(row, 44).value ?? null).not.toBeNull();
    expect(day(row, 31)).toBeNull();
  }
  // Calendar: 1 Mehr 1405 is a Wednesday; Fridays are 3, 10, 17 and 24.
  expect(sheet.getCell("U3").value).toBe("مهر\u200cماه 1405");
  expect([day(5, 1), day(5, 2), day(5, 3)]).toEqual(["چ", "پ", "ج"]);
  expect([day(6, 30), day(6, 31)]).toEqual([30, null]);
  expect(day(5, 31)).toBeNull();
  const theme = (address: string) =>
    (sheet.getCell(address).fill as { fgColor?: { theme?: number } })?.fgColor
      ?.theme;
  expect(["P8", "W8", "AD8", "AK8"].map(theme)).toEqual([3, 3, 3, 3]);
  expect(["N8", "O8", "Q8", "AR8"].map(theme)).toEqual([0, 0, 0, 0]);
  expect(sheet.getCell("V28").value).toBe("مهر و امضاء سرپرستار");
  expect(sheet.getCell("B8").value).toBe(fixture.nurse.personnelNumber);
  expect(sheet.pageSetup.orientation).toBe("landscape");
  expect(sheet.pageSetup.scale).toBe(89);
});
