import { expect, test, type Page } from "@playwright/test";

import { mainNav, signInAndWait } from "./support/auth";
import {
  provisionApprovalDepartment,
  type ApprovalDepartment,
} from "./support/approval";
import {
  abanState,
  approveAban,
  consentAs,
  createRequestAs,
  nurseEmail,
  setShift,
} from "./support/requests";

/**
 * Head Nurse request queue (Phase 9, Slice D): queue, detail with the live
 * context and validated preview, apply, reject, stale contexts, the revision
 * path for an approved schedule, the frozen SUBMITTED schedule, direct
 * adjustment, and department scope. Aban 1405, provisioned per test:
 * 2 Aban (24 Oct) nurse 1 M, nurse 2 E, nurse 3 N; 3 Aban nurse 1 N.
 */

const SAT_2_ABAN = "شنبه ۲ آبان ۱۴۰۵";
const NURSE_1 = "پرستار آزمایشی ۱";

const main = (page: Page) => page.locator("main");
const queueUrl = (d: ApprovalDepartment) => `/departments/${d.code}/requests`;
const detail = (page: Page) =>
  page.getByRole("dialog", { name: new RegExp(`^${NURSE_1} · `) });

async function openRequest(page: Page, title: string) {
  await main(page)
    .getByRole("article", { name: title })
    .getByRole("link", { name: `بررسی درخواست ${title}` })
    .click();
  await expect(detail(page)).toBeVisible();
  return detail(page);
}

/** Opens Apply, optionally ticks the stale confirmation, and confirms. */
async function apply(page: Page, { confirmStale = false } = {}) {
  await detail(page).getByRole("button", { name: "اعمال درخواست" }).click();
  const dialog = page.getByRole("dialog", { name: "اعمال درخواست" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "بله، اعمال شود" });
  if (confirmStale) {
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox").check();
  }
  await confirm.click();
  await expect(dialog).toBeHidden();
}

const title = (type: string) => `${NURSE_1} · ${type} · ${SAT_2_ABAN}`;

test.describe("Head Nurse request queue", () => {
  test("a pending request appears in the queue; applying changes the schedule and tells the nurse", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await createRequestAs(department, department.nurseEmail, {
      type: "UNAVAILABLE",
      date: "2026-10-24",
    });
    // The request alone never changes the schedule.
    expect(
      (await abanState(department, department.nurseEmail, "2026-10-24")).shift,
    ).toBe("M");

    await signInAndWait(page, department.headEmail);
    await mainNav(page).getByRole("link", { name: "درخواست‌های بخش" }).click();
    await expect(page).toHaveURL(new RegExp(`${queueUrl(department)}$`));
    await expect(
      page.getByRole("link", { name: /در انتظار/, exact: false }),
    ).toHaveAttribute("aria-current", "page");
    const row = main(page).getByRole("article", {
      name: title("عدم امکان حضور"),
    });
    await expect(row).toContainText("در انتظار بررسی");
    await expect(row).toContainText("علت: بیماری");

    const dialog = await openRequest(page, title("عدم امکان حضور"));
    await expect(
      dialog.getByRole("region", { name: "وضعیت فعلی" }),
    ).toContainText("هنوز نسخه تأییدشده‌ای نیست");
    await expect(dialog).toContainText(
      "این تغییر نقض قانون یا مشکل پوشش تازه‌ای پدید نمی‌آورد",
    );
    await expect(dialog).toContainText(
      "در برنامه کاری (هنوز تأیید نشده) اعمال می‌شود",
    );
    await apply(page);
    await expect(detail(page)).toContainText("اعمال شد");
    await expect(detail(page)).toContainText("در انتظار تأیید برنامه");
    expect(
      (await abanState(department, department.nurseEmail, "2026-10-24")).shift,
    ).toBe("OFF");

    await page.context().clearCookies();
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/requests");
    await expect(
      main(page).getByRole("article", {
        name: `عدم امکان حضور · ${SAT_2_ABAN}`,
      }),
    ).toContainText("اعمال شد");
  });

  test("rejecting with a note keeps the schedule and the nurse reads the note", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await createRequestAs(department, department.nurseEmail, {
      type: "CHANGE_SHIFT",
      date: "2026-10-24",
      targetShift: "E",
    });
    await signInAndWait(page, department.headEmail);
    await page.goto(queueUrl(department));
    const dialog = await openRequest(page, title("تغییر شیفت"));
    await dialog.getByRole("button", { name: "رد درخواست" }).click();
    const reject = page.getByRole("dialog", { name: "رد درخواست" });
    await reject
      .getByLabel("توضیح برای پرستار (اختیاری)")
      .fill("نیروی عصر کافی است");
    await reject.getByRole("button", { name: "بله، رد شود" }).click();
    await expect(reject).toBeHidden();
    await expect(detail(page)).toContainText("سرپرستار درخواست را رد کرد.");
    expect(
      (await abanState(department, department.nurseEmail, "2026-10-24")).shift,
    ).toBe("M");

    await page.context().clearCookies();
    await signInAndWait(page, department.nurseEmail);
    await page.goto("/requests");
    await expect(
      main(page).getByRole("article", { name: `تغییر شیفت · ${SAT_2_ABAN}` }),
    ).toContainText("نیروی عصر کافی است");
  });

  test("a hard violation blocks applying; the finding is shown", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    // N on 2 Aban followed by nurse 1's N on 3 Aban: night rest (D7).
    await createRequestAs(department, department.nurseEmail, {
      type: "CHANGE_SHIFT",
      date: "2026-10-24",
      targetShift: "N",
    });
    await signInAndWait(page, department.headEmail);
    await page.goto(queueUrl(department));
    const dialog = await openRequest(page, title("تغییر شیفت"));
    await expect(dialog).toContainText("این تغییر قابل اعمال نیست");
    await expect(dialog).toContainText("استراحت پس از شیفت شب");
    await expect(
      dialog.getByRole("button", { name: "اعمال درخواست" }),
    ).toBeDisabled();
  });

  test("a stale request is applied against the current shift, after explicit confirmation", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    await createRequestAs(department, department.nurseEmail, {
      type: "UNAVAILABLE",
      date: "2026-10-24",
    });
    await setShift(department, department.nurseEmail, "2026-10-24", "E");
    await signInAndWait(page, department.headEmail);
    await page.goto(queueUrl(department));
    await expect(
      main(page).getByRole("article", { name: title("عدم امکان حضور") }),
    ).toContainText("شیفت فعلی:");
    const dialog = await openRequest(page, title("عدم امکان حضور"));
    await expect(dialog).toContainText("پس از ثبت درخواست تغییر کرده است");
    await expect(dialog).toContainText("شیفت فعلی عصر (E)");
    await apply(page, { confirmStale: true });
    await expect(detail(page)).toContainText("اعمال شد");
    expect(
      (await abanState(department, department.nurseEmail, "2026-10-24")).shift,
    ).toBe("OFF");
  });

  test("a swap whose shifts changed after consent is blocked", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    const partner = nurseEmail(department, 2);
    const id = await createRequestAs(department, department.nurseEmail, {
      type: "SWAP",
      date: "2026-10-24",
      counterpartEmail: partner,
    });
    await consentAs(partner, id);
    await setShift(department, partner, "2026-10-24", "N");
    await signInAndWait(page, department.headEmail);
    await page.goto(`${queueUrl(department)}?request=${id}`);
    await expect(detail(page)).toContainText("همکار دوباره موافقت نکند");
    await expect(detail(page)).toContainText(
      "درخواست‌دهنده باید درخواست را با شیفت‌های فعلی به‌روز کند",
    );
    await expect(
      detail(page).getByRole("button", { name: "اعمال درخواست" }),
    ).toBeDisabled();
  });

  test("applying on an approved schedule opens a revision; the approved version is untouched", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("submitted");
    await approveAban(department);
    await createRequestAs(department, department.nurseEmail, {
      type: "CHANGE_SHIFT",
      date: "2026-10-24",
      targetShift: "E",
    });
    await signInAndWait(page, department.headEmail);
    await page.goto(queueUrl(department));
    const dialog = await openRequest(page, title("تغییر شیفت"));
    await expect(dialog).toContainText("نسخه ۱ (آخرین نسخه تأییدشده)");
    await expect(dialog).toContainText("نسخه تأییدشده دست نمی‌خورد");
    await apply(page);
    await expect(detail(page)).toContainText("در بازنگری، در انتظار تأیید");
    expect(
      await abanState(department, department.nurseEmail, "2026-10-24"),
    ).toEqual({
      status: "REVISING",
      shift: "E",
      approvedShift: "M",
    });
  });

  test("a submitted schedule stays frozen: applying waits for a withdrawal", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("submitted");
    await createRequestAs(department, department.nurseEmail, {
      type: "UNAVAILABLE",
      date: "2026-10-24",
    });
    await signInAndWait(page, department.headEmail);
    await page.goto(queueUrl(department));
    const dialog = await openRequest(page, title("عدم امکان حضور"));
    await expect(dialog).toContainText("ابتدا ارسال را پس بگیرید");
    await expect(
      dialog.getByRole("button", { name: "اعمال درخواست" }),
    ).toBeDisabled();
  });

  test("a direct adjustment on an approved schedule needs a reason and opens a revision", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("submitted");
    await approveAban(department);
    const nurse3 = nurseEmail(department, 1);
    await signInAndWait(page, department.headEmail);
    await page.goto(
      `/departments/${department.code}/schedule?month=1405-08&day=2026-10-27`,
    );
    const form = page.getByRole("region", { name: "تغییر عملیاتی" });
    await expect(form).toBeVisible();
    await form
      .getByLabel("پرستار")
      .selectOption({ label: "پرستار آزمایشی ۱ — استراحت" });
    await form.getByLabel("شیفت جدید").selectOption({ label: "صبح (M)" });
    await form.getByRole("button", { name: "بررسی تغییر" }).click();
    await expect(
      form.getByRole("region", { name: "نتیجه بررسی تغییر" }),
    ).toContainText("بازنگری جدیدی برای این روز باز می‌شود");
    const applyButton = form.getByRole("button", { name: "اعمال تغییر" });
    await expect(applyButton).toBeDisabled(); // no reason yet
    await form
      .getByLabel("علت تغییر")
      .selectOption({ label: "نیاز عملیاتی بخش" });
    await applyButton.click();
    // The day is now in the revision's scope: the planning editor takes over.
    await expect(form).toHaveCount(0);
    await expect(
      page.getByRole("group", { name: "شیفت پرستار آزمایشی ۱" }),
    ).toBeVisible();
    expect(await abanState(department, nurse3, "2026-10-27")).toEqual({
      status: "REVISING",
      shift: "M",
      approvedShift: "OFF",
    });
  });

  test("another department's Head Nurse and a nurse cannot open the queue", async ({
    page,
  }) => {
    const department = await provisionApprovalDepartment("finalized");
    const other = await provisionApprovalDepartment("planning");
    for (const email of [other.headEmail, department.nurseEmail]) {
      await page.context().clearCookies();
      await signInAndWait(page, email);
      const response = await page.goto(queueUrl(department));
      expect(response?.status()).toBe(404);
      await expect(main(page).getByText(department.name)).toHaveCount(0);
    }
  });
});
