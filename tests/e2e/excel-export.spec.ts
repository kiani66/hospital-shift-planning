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

test("NICU workbook: personnel numbers from the records, statistics and print layout", async ({
  page,
}) => {
  const fixture = await provisionExcelExport();
  const code = fixture.department.code;
  await signInAndWait(page, fixture.head.email!);
  await page.goto(`/departments/${code}/settings`);

  // 1. Prepare the hidden personnel-number column from the system's records.
  await page
    .getByText("ساخت ستون شماره پرسنلی پنهان از روی پرونده پرسنل")
    .click();
  const prepare = page.getByRole("form", { name: "ساخت ستون شماره پرسنلی" });
  await prepare.getByLabel("فایل Excel بیمارستان").setInputFiles({
    name: "nicu.xlsx",
    mimeType: XLSX,
    buffer: fixture.nicu,
  });
  await prepare.getByLabel("نام Sheet").fill("Sheet2");
  await prepare.getByLabel("ردیف شروع پرسنل").fill("7");
  await prepare.getByLabel("ردیف پایان پرسنل").fill("23");
  await prepare.getByLabel("ستون روز اول").fill("M");
  await prepare.getByLabel("ستون خالی برای شماره پرسنلی").fill("BL");
  await prepare.getByRole("button", { name: "خواندن ردیف‌ها" }).click();
  await expect(prepare.getByRole("table")).toContainText("سرپرستار");
  await prepare.getByLabel("فرد ردیف ۷").selectOption(fixture.head.id);
  await prepare.getByLabel("فرد ردیف ۸").selectOption(fixture.nurse.id);
  await prepare.getByLabel("فرد ردیف ۲۳").selectOption(fixture.secretary.id);
  await prepare
    .getByRole("button", { name: "ساخت فایل با ستون شماره پرسنلی" })
    .click();
  const preparedDownload = page.waitForEvent("download");
  await prepare.getByRole("link", { name: "دانلود فایل آماده" }).click();
  const prepared = await readFile((await (await preparedDownload).path())!);
  const preparedSheet = (
    await readWorkbook(new Uint8Array(prepared))
  ).getWorksheet("Sheet2")!;
  expect(preparedSheet.getCell("BL7").value).toBe(fixture.head.personnelNumber);
  expect(preparedSheet.getCell("BL23").value).toBe(
    fixture.secretary.personnelNumber,
  );
  expect(preparedSheet.getColumn("BL").hidden).toBe(true);

  // 2. Upload and validate it with the NICU mapping and statistics.
  const form = mappingForm(page);
  await form.getByLabel("فایل قالب Excel").setInputFiles({
    name: "nicu-prepared.xlsx",
    mimeType: XLSX,
    buffer: prepared,
  });
  await form.getByLabel("نام Sheet").fill("Sheet2");
  await form.getByLabel("ستون شماره پرسنلی").fill("BL");
  await form.getByLabel("ردیف شروع پرسنل").fill("7");
  await form.getByLabel("ردیف پایان پرسنل").fill("23");
  await form.getByLabel("ستون روز اول").fill("M");
  await form.getByLabel("ردیف عنوان روزها").fill("6");
  await form.getByLabel("ستون تعداد شیفت").fill("K");
  await form.getByLabel("ستون روزهای مرخصی (H)").fill("J");
  await form.getByLabel("ستون‌های پاک‌شونده").fill("I");
  await form.getByLabel("ردیف تعداد صبح").fill("25");
  await form.getByLabel("ردیف تعداد عصر").fill("26");
  await form.getByLabel("ردیف تعداد شب").fill("27");
  await form.getByRole("button", { name: "بررسی قالب" }).click();
  const summary = page.getByRole("region", { name: "خلاصه نگاشت" });
  await expect(summary).toContainText("قالب قابل فعال‌سازی است");
  await expect(summary).toContainText("(ستون پنهان)");
  await expect(summary).toContainText(fixture.nurse.displayName);
  await expect(summary).toContainText("A1:AP31");
  // Day 31 (AQ) is outside the print area as found: a warning, not an error.
  await expect(summary).toContainText("خارج از ناحیه چاپ");
  await form.getByRole("button", { name: "بارگذاری قالب" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "قالب بارگذاری و فعال شد" }),
  ).toBeVisible();

  // 3. Export the partially planned Mehr 1405 DRAFT.
  await page.goto(`/departments/${code}/schedule?month=1405-07`);
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "خروجی اکسل" }).click();
  const sheet = (
    await readWorkbook(
      new Uint8Array(await readFile((await (await exported).path())!)),
    )
  ).getWorksheet("Sheet2")!;
  const day = (row: number, d: number) =>
    sheet.getCell(row, 12 + d).value ?? null;
  expect([day(8, 1), day(8, 2), day(8, 3)]).toEqual(["N", null, "?"]);
  expect([day(23, 1), day(23, 2), day(23, 3)]).toEqual(["M", "?", "H"]);
  expect(day(7, 1)).toBe("?");
  expect(day(8, 31)).toBeNull(); // Mehr has 30 days.
  expect(["I8", "J8", "K8"].map((a) => sheet.getCell(a).value ?? null)).toEqual(
    [null, "?", "?"],
  );
  expect(day(25, 1)).toBe("?");
  expect(sheet.getCell("AP6").value).toBe(30);
  expect(sheet.getCell("AQ6").value ?? null).toBeNull();
  expect(sheet.getCell("C30").value).toBe("امضای سرپرستار");
  expect(sheet.pageSetup.orientation).toBe("landscape");
  expect(sheet.pageSetup.fitToWidth).toBe(1);
});
