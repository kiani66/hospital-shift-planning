import { expect, test, type Page } from "@playwright/test";

import { signInAndWait } from "./support/auth";
import {
  provisionApprovalDepartment,
  type ApprovalDepartment,
} from "./support/approval";
import { abanState, approveAban, createRequestAs } from "./support/requests";

/**
 * Phase 9, Slice E: a request on an APPROVED schedule, end to end through the
 * revision and the existing approval workflow, and the discard path. Aban
 * 1405 is approved as version 1; nurse 1 works M on 2 Aban (24 Oct).
 */

const SAT_2_ABAN = "شنبه ۲ آبان ۱۴۰۵";
const TITLE = `پرستار آزمایشی ۱ · تغییر شیفت · ${SAT_2_ABAN}`;

const main = (page: Page) => page.locator("main");
const header = (page: Page) =>
  page.locator('section[aria-labelledby="schedule-month-heading"]');

async function switchUser(page: Page, email: string) {
  await page.context().clearCookies();
  await signInAndWait(page, email);
}

async function confirmIn(
  page: Page,
  scope: ReturnType<Page["locator"]>,
  trigger: string,
  title: RegExp,
  confirmLabel: string,
) {
  await scope.getByRole("button", { name: trigger }).click();
  // The confirmation by its own title (it may sit inside the request detail).
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmLabel }).click();
  await expect(dialog).toBeHidden();
}

/** Approved Aban, a CHANGE_SHIFT request (M → E on 2 Aban), applied by the Head Nurse in the UI. */
async function appliedInRevision(page: Page): Promise<ApprovalDepartment> {
  const department = await provisionApprovalDepartment("submitted");
  await approveAban(department);
  await createRequestAs(department, department.nurseEmail, {
    type: "CHANGE_SHIFT",
    date: "2026-10-24",
    targetShift: "E",
  });
  await signInAndWait(page, department.headEmail);
  await page.goto(`/departments/${department.code}/requests`);
  await main(page)
    .getByRole("link", { name: `بررسی درخواست ${TITLE}` })
    .click();
  const detail = page.getByRole("dialog", { name: TITLE });
  await confirmIn(
    page,
    detail,
    "اعمال درخواست",
    /^اعمال درخواست$/,
    "بله، اعمال شود",
  );
  await expect(detail).toContainText("در بازنگری، در انتظار تأیید");
  expect(
    await abanState(department, department.nurseEmail, "2026-10-24"),
  ).toEqual({ status: "REVISING", shift: "E", approvedShift: "M" });
  return department;
}

test.describe("request on an approved schedule", () => {
  test("revision → submit → Supervisor approval: version 2 becomes executable", async ({
    page,
  }) => {
    test.slow();
    const department = await appliedInRevision(page);

    // The Head Nurse submits the revision with the existing workflow.
    await page.goto(`/departments/${department.code}/schedule?month=1405-08`);
    await expect(
      header(page).getByText("در حال بازنگری", { exact: true }),
    ).toBeVisible();
    await confirmIn(
      page,
      header(page),
      "ارسال برای تأیید",
      /^ارسال برنامه/,
      "بله، ارسال شود",
    );
    await expect(
      header(page).getByText("ارسال‌شده برای تأیید", { exact: true }),
    ).toBeVisible();

    // The Supervisor approves it.
    await switchUser(page, department.supervisorEmail);
    await page.goto(`/review/${department.abanId}`);
    await confirmIn(
      page,
      header(page),
      "تأیید برنامه",
      /^تأیید برنامه/,
      "بله، تأیید شود",
    );
    await expect(
      header(page).getByText("تأییدشده", { exact: true }),
    ).toBeVisible();
    // Version 2 is now the executable schedule; the request stays APPLIED.
    expect(
      await abanState(department, department.nurseEmail, "2026-10-24"),
    ).toEqual({ status: "APPROVED", shift: "E", approvedShift: "E" });

    await switchUser(page, department.nurseEmail);
    await page.goto("/requests");
    const card = main(page).getByRole("article", {
      name: `تغییر شیفت · ${SAT_2_ABAN}`,
    });
    await expect(card).toContainText("اعمال شد");
    await expect(card).toContainText(
      "بخشی از برنامه یا بازنگری‌ای بود که سوپروایزر تأیید کرد",
    );
  });

  test("discarding the revision restores version 1; the applied request says it is not executable", async ({
    page,
  }) => {
    test.slow();
    const department = await appliedInRevision(page);

    await page.goto(`/departments/${department.code}/schedule?month=1405-08`);
    await confirmIn(
      page,
      header(page),
      "کنار گذاشتن بازنگری",
      /^کنار گذاشتن بازنگری/,
      "بله، کنار گذاشته شود",
    );
    await expect(
      header(page).getByText("تأییدشده", { exact: true }),
    ).toBeVisible();
    expect(
      await abanState(department, department.nurseEmail, "2026-10-24"),
    ).toEqual({ status: "APPROVED", shift: "M", approvedShift: "M" });

    // The Head Nurse's queue keeps the request APPLIED but marks the change discarded.
    await page.goto(`/departments/${department.code}/requests?status=APPLIED`);
    const row = main(page).getByRole("article", { name: TITLE });
    await expect(row).toContainText("اعمال شد");
    await expect(row).toContainText("بازنگری کنار گذاشته شد");

    // The nurse sees the same, and was notified.
    await switchUser(page, department.nurseEmail);
    await page.goto("/requests");
    await expect(
      main(page).getByRole("article", { name: `تغییر شیفت · ${SAT_2_ABAN}` }),
    ).toContainText("تغییر در برنامه اجرایی نیست");
    await page.goto("/notifications");
    await expect(main(page)).toContainText("تغییر درخواست شما کنار گذاشته شد");
  });
});
