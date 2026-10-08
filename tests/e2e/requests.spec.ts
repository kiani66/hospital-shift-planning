import { expect, test, type Locator, type Page } from "@playwright/test";

import { mainNav, signInAndWait } from "./support/auth";
import {
  provisionApprovalDepartment,
  type ApprovalDepartment,
} from "./support/approval";

/**
 * Nurse Shift Change Requests (Phase 9, Slice C): create, cancel and swap
 * consent, on a freshly provisioned department whose Aban schedule is
 * FINALIZED (2 Aban: nurse 1 M, nurse 2 E, nurse 3 N; 3 Aban: nurse 1 N).
 */

const SAT_2_ABAN = "شنبه ۲ آبان ۱۴۰۵";
const SUN_3_ABAN = "یکشنبه ۳ آبان ۱۴۰۵";

const main = (page: Page) => page.locator("main");
const nurseEmail = (d: ApprovalDepartment, n: number) =>
  d.nurseEmail.replace("nurse1.", `nurse${n}.`);

const expectNoHorizontalOverflow = async (page: Page, step: string) => {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, step).toBeLessThanOrEqual(0);
};

async function switchUser(page: Page, email: string) {
  await page.context().clearCookies();
  await signInAndWait(page, email);
}

async function openRequests(page: Page) {
  await mainNav(page).getByRole("link", { name: "درخواست‌ها" }).click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "درخواست‌ها",
  );
}

/** A request card, by its title ("<type> · <date>"). */
const requestCard = (page: Page, title: string) =>
  main(page).getByRole("article", { name: title, exact: true });

/** The upcoming-shift row of a day. */
const shiftRow = (page: Page, day: string) =>
  main(page)
    .getByRole("region", { name: "آبان ۱۴۰۵" })
    .getByRole("listitem", { name: day, exact: true });

async function openNewRequest(page: Page, day: string) {
  await shiftRow(page, day)
    .getByRole("button", { name: `درخواست تغییر برای ${day}` })
    .click();
  const dialog = page.getByRole("dialog", { name: "درخواست تغییر شیفت" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmIn(
  card: Locator,
  page: Page,
  trigger: string,
  confirm: string,
) {
  await card.getByRole("button", { name: trigger }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

test.describe("nurse change requests", () => {
  test("create a shift-change request (Other needs a note), see it pending, then cancel it", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await signInAndWait(page, department.nurseEmail);
    await openRequests(page);
    await expect(
      main(page).getByRole("heading", { name: "هنوز درخواستی ثبت نکرده‌اید" }),
    ).toBeVisible();
    await expect(shiftRow(page, SAT_2_ABAN)).toContainText("صبح");
    await expectNoHorizontalOverflow(page, "requests page");

    const dialog = await openNewRequest(page, SAT_2_ABAN);
    await dialog.getByRole("radio", { name: /^تغییر شیفت/ }).check();
    await dialog.getByRole("radio", { name: "E — عصر" }).check();
    await dialog.getByLabel("علت").selectOption({ label: "سایر" });
    await expect(dialog.getByLabel("توضیح (الزامی)")).toBeVisible();
    // The server refuses "Other" without a note and says which field.
    await dialog.getByRole("button", { name: "ثبت درخواست" }).click();
    await expect(dialog.getByRole("alert")).toContainText("اصلاح کنید");
    await expect(dialog).toContainText("برای این علت توضیح لازم است");
    await dialog.getByLabel("توضیح (الزامی)").fill("کلاس آموزشی صبح دارم");
    await dialog.getByRole("button", { name: "ثبت درخواست" }).click();
    await expect(dialog).toBeHidden();

    const title = `تغییر شیفت · ${SAT_2_ABAN}`;
    const card = requestCard(page, title);
    await expect(card).toContainText("در انتظار بررسی");
    await expect(card).toContainText("شیفت صبح به شیفت عصر تغییر کند.");
    await expect(card).toContainText("کلاس آموزشی صبح دارم");
    await expectNoHorizontalOverflow(page, "with a request");
    await expect(shiftRow(page, SAT_2_ABAN)).toContainText("درخواست در جریان");

    await confirmIn(card, page, "لغو درخواست", "بله، لغو شود");
    await expect(card).toContainText("لغو شد");
    await expect(card.getByRole("button", { name: "لغو درخواست" })).toHaveCount(
      0,
    );
    // The day can be requested again; the cancelled request stays in history.
    await expect(
      shiftRow(page, SAT_2_ABAN).getByRole("button", {
        name: `درخواست تغییر برای ${SAT_2_ABAN}`,
      }),
    ).toBeVisible();
  });

  test("swap: the partner sees the request and consents; others never see it", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    const [, partner] = department.nurseNames as [string, string];
    await signInAndWait(page, department.nurseEmail);
    await openRequests(page);

    const dialog = await openNewRequest(page, SAT_2_ABAN);
    await dialog.getByRole("radio", { name: /^جابه‌جایی با همکار/ }).check();
    await dialog
      .getByLabel("همکار برای جابه‌جایی")
      .selectOption({ label: `${partner} — شیفت عصر (E)` });
    await dialog.getByLabel("علت").selectOption({ label: "کار شخصی" });
    await dialog.getByRole("button", { name: "ثبت درخواست" }).click();
    await expect(dialog).toBeHidden();
    const title = `جابه‌جایی با همکار · ${SAT_2_ABAN}`;
    await expect(requestCard(page, title)).toContainText(
      "در انتظار موافقت همکار",
    );

    // The partner answers from their own requests page.
    await switchUser(page, nurseEmail(department, 2));
    await openRequests(page);
    const inbox = main(page).getByRole("region", {
      name: "درخواست‌های جابه‌جایی منتظر پاسخ شما",
    });
    const card = inbox.getByRole("article", { name: title });
    await expect(card).toContainText(
      "شیفت صبح خود را با شیفت عصر شما جابه‌جا کند",
    );
    await confirmIn(card, page, "موافقت با جابه‌جایی", "بله، موافقم");
    await expect(
      main(page).getByRole("article", { name: title }),
    ).toContainText("همکار موافقت کرد");

    // The requester sees the consent; the schedule itself is unchanged.
    await switchUser(page, department.nurseEmail);
    await openRequests(page);
    await expect(requestCard(page, title)).toContainText("همکار موافقت کرد");
    await expect(requestCard(page, title)).toContainText("در انتظار بررسی");

    // A colleague who is not involved sees nothing of it.
    await switchUser(page, nurseEmail(department, 3));
    await openRequests(page);
    await expect(main(page).getByRole("article")).toHaveCount(0);
  });

  test("swap: the partner declines and the requester sees the outcome", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    const [, partner] = department.nurseNames as [string, string];
    await signInAndWait(page, department.nurseEmail);
    await openRequests(page);

    // 3 Aban: nurse 1 works N, nurse 2 is off.
    const dialog = await openNewRequest(page, SUN_3_ABAN);
    await dialog.getByRole("radio", { name: /^جابه‌جایی با همکار/ }).check();
    await dialog
      .getByLabel("همکار برای جابه‌جایی")
      .selectOption({ label: `${partner} — استراحت (OFF)` });
    await dialog.getByLabel("علت").selectOption({ label: "بیماری" });
    await dialog.getByRole("button", { name: "ثبت درخواست" }).click();
    await expect(dialog).toBeHidden();

    await switchUser(page, nurseEmail(department, 2));
    await openRequests(page);
    const title = `جابه‌جایی با همکار · ${SUN_3_ABAN}`;
    await confirmIn(
      main(page).getByRole("article", { name: title }),
      page,
      "مخالفت",
      "بله، مخالفم",
    );
    await expect(
      main(page).getByRole("region", {
        name: "درخواست‌های جابه‌جایی منتظر پاسخ شما",
      }),
    ).toHaveCount(0);

    await switchUser(page, department.nurseEmail);
    await openRequests(page);
    const card = requestCard(page, title);
    await expect(card).toContainText("رد شد");
    await expect(card).toContainText("همکار با جابه‌جایی موافقت نکرد.");
    await expect(card.getByRole("button")).toHaveCount(0);
  });
});
