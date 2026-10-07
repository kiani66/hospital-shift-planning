import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDatabase } from "../../src/infrastructure/db/database";
import { isoDate } from "../../src/domain/shared/dates";
import { setAssignment } from "../../src/infrastructure/repositories/assignments";
import { setPreference } from "../../src/infrastructure/repositories/preferences";
import {
  updateSchedule,
  findScheduleById,
} from "../../src/infrastructure/repositories/schedules";
import {
  findUserByEmail,
  setUserActive,
} from "../../src/infrastructure/repositories/users";
import {
  pinTestRuleSet,
  publishTestRuleSet,
  ruleContent,
} from "../integration/support/rule-sets";
import { signInAndWait } from "./support/auth";
import {
  provisionReviewDepartment,
  forceScheduleStatus,
  type ReviewDepartment,
} from "./support/review";

const DATE = isoDate("2026-10-25");
const url = (d: ReviewDepartment) =>
  `/departments/${d.code}/schedule?month=1405-08&day=${DATE}`;
const database = () => createDatabase(process.env.DATABASE_URL!, { max: 1 });
async function people(d: ReviewDepartment) {
  const { db, pool } = database();
  try {
    return await Promise.all(
      [
        d.headEmail,
        d.nurseEmail.replace("nurse1.", "nurse2."),
        d.nurseEmail.replace("nurse1.", "nurse3."),
      ].map((email) => findUserByEmail(db, email)),
    );
  } finally {
    await pool.end();
  }
}
async function snapshot(d: ReviewDepartment) {
  const { db, pool } = database();
  try {
    return (await findScheduleById(db, d.abanId))!;
  } finally {
    await pool.end();
  }
}
async function assignment(
  d: ReviewDepartment,
  userId: string,
  shift: "M" | "E" | "N" | "OFF",
  date = DATE,
) {
  const { db, pool } = database();
  try {
    const head = (await findUserByEmail(db, d.headEmail))!;
    await setAssignment(db, {
      scheduleId: d.abanId,
      userId,
      date,
      shift,
      updatedBy: head.id,
    });
  } finally {
    await pool.end();
  }
}
async function nightShortage(d: ReviewDepartment) {
  const { db, pool } = database();
  try {
    const schedule = (await findScheduleById(db, d.abanId))!;
    const version = await publishTestRuleSet(db, {
      departmentId: schedule.departmentId,
      createdBy: schedule.createdBy,
      content: ruleContent(
        { min: 1, max: null },
        {
          normal: {
            M: { min: 1, max: null },
            E: { min: 1, max: null },
            N: { min: 3, max: null },
          },
        },
      ),
    });
    await pinTestRuleSet(db, d.abanId, version);
  } finally {
    await pool.end();
  }
}
const panel = (page: Page) =>
  page.getByRole("region", { name: "افراد برای جبران کمبود" });
async function open(page: Page, d: ReviewDepartment, shift = "M") {
  await signInAndWait(page, d.headEmail);
  await page.goto(url(d));
  const trigger = panel(page).getByRole("button", {
    name: new RegExp(`^افراد برای کمبود.*\\(${shift}\\)`),
  });
  await trigger.click();
  const id = await trigger.getAttribute("aria-controls");
  const content = page.locator(`[id="${id}"]`);
  await expect(
    content.getByRole("region", { name: "قابل انتخاب", exact: true }),
  ).toBeVisible();
  return { content, trigger };
}
const assign = (content: Locator, name: string) =>
  content.getByRole("button", {
    name: new RegExp(`^تخصیص شیفت.*برای ${name}$`),
  });
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      return Math.max(
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        ...Array.from(document.querySelectorAll("dialog[open]")).map(
          (d) => d.scrollWidth - d.clientWidth,
        ),
      );
    }),
  ).toBeLessThanOrEqual(0);
}

test("sequential assignments use refreshed revisions, retain the panel and complete coverage; OFF preference needs no confirmation", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  await nightShortage(d);
  const [head, nurse] = await people(d);
  const { db, pool } = database();
  try {
    await setPreference(db, {
      scheduleId: d.abanId,
      userId: head!.id,
      date: DATE,
      value: "OFF",
    });
  } finally {
    await pool.end();
  }
  const before = await snapshot(d);
  const { content, trigger } = await open(page, d, "N");
  await expect(content).toContainText("مانع انتخاب نیست");
  await assign(content, head!.displayName).click();
  await expect(
    page.getByRole("dialog", { name: "جایگزینی تصمیم OFF" }),
  ).toHaveCount(0);
  await expect(panel(page).getByRole("status")).toContainText("ثبت شد");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(
    content.getByText(head!.displayName, { exact: true }),
  ).toHaveCount(0);
  expect((await snapshot(d)).revision).toBe(before.revision + 1);
  const coverage = page
    .getByRole("dialog")
    .getByRole("region", { name: "پوشش نفرات" });
  await expect(coverage.locator('[data-period="N"]')).toContainText("۲");
  await expect(coverage.locator('[data-period="N"]')).toContainText(
    "کمبود ۱ نفر",
  );
  await assign(content, nurse!.displayName).click();
  await expect(content.getByRole("status")).toHaveText(
    "پوشش موردنیاز شیفت شب تکمیل شد.",
  );
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(content.getByRole("button", { name: /^تخصیص/ })).toHaveCount(0);
  await expect(coverage.locator('[data-period="N"]')).toContainText("۳");
  await expect(coverage.locator('[data-period="N"]')).not.toContainText(
    "کمبود",
  );
  expect((await snapshot(d)).revision).toBe(before.revision + 2);
  await noOverflow(page);
  await trigger.click();
  await expect(
    panel(page).getByRole("button", { name: /کمبود.*\(N\)/ }),
  ).toHaveCount(0);
});

test("OFF confirmation names replacement and target; Cancel and Escape do not write; Confirm writes once and stays open", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [, nurse] = await people(d);
  await assignment(d, nurse!.id, "OFF");
  const before = await snapshot(d);
  const { content, trigger } = await open(page, d);
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.headers()["next-action"] &&
      request.postData()?.includes("expectedRevision")
    )
      writes++;
  });
  await assign(content, nurse!.displayName).click();
  const confirm = page.getByRole("dialog", { name: "جایگزینی تصمیم OFF" });
  await expect(confirm).toContainText(nurse!.displayName);
  await expect(confirm).toContainText("OFF حذف و شیفت صبح جایگزین");
  await expect(confirm.getByRole("button", { name: "انصراف" })).toBeFocused();
  await noOverflow(page);
  await confirm.getByRole("button", { name: "انصراف" }).click();
  expect((await snapshot(d)).revision).toBe(before.revision);
  await expect(page.getByRole("dialog").first()).toBeVisible();
  await assign(content, nurse!.displayName).click();
  await confirm.press("Escape");
  await expect(confirm).toHaveCount(0);
  expect(writes).toBe(0);
  expect((await snapshot(d)).revision).toBe(before.revision);
  await assign(content, nurse!.displayName).click();
  await confirm
    .getByRole("button", { name: "تخصیص شیفت صبح", exact: true })
    .press("Enter");
  await expect(confirm).toHaveCount(0);
  await expect(content.getByRole("status")).toContainText("تکمیل شد");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect((await snapshot(d)).revision).toBe(before.revision + 1);
  expect(writes).toBe(1);
  const { db, pool } = database();
  try {
    const { listAssignments } =
      await import("../../src/infrastructure/repositories/assignments");
    expect(
      (await listAssignments(db, d.abanId))
        .filter((a) => a.date === DATE && a.nurseId === nurse!.id)
        .map((a) => a.shift),
    ).toEqual(["M"]);
  } finally {
    await pool.end();
  }
  await noOverflow(page);
});

test("pending blocks all candidate writes across open periods and duplicate clicks, without optimistic removal", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  const { content } = await open(page, d);
  await panel(page)
    .getByRole("button", { name: /کمبود.*\(E\)/ })
    .click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route("**/*", async (route) => {
    if (
      route.request().headers()["next-action"] &&
      route.request().postData()?.includes("expectedRevision")
    ) {
      writes++;
      await gate;
    }
    await route.continue();
  });
  const button = assign(content, head!.displayName);
  await expect(button).toBeEnabled();
  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  await expect.poll(() => writes).toBe(1);
  await expect(button).toBeDisabled();
  for (const action of await panel(page)
    .getByRole("button", { name: /^تخصیص/ })
    .all())
    await expect(action).toBeDisabled();
  await expect(
    content.getByText(head!.displayName, { exact: true }),
  ).toBeVisible();
  await expect(panel(page).getByRole("status")).toContainText("در حال");
  expect(writes).toBe(1);
  release();
  await expect(content.getByRole("status")).toContainText("تکمیل شد");
  expect(writes).toBe(1);
  await noOverflow(page);
});

test("stale revision is refused, refreshed and never automatically retried", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  const { content, trigger } = await open(page, d);
  const { db, pool } = database();
  try {
    const schedule = await snapshot(d);
    await updateSchedule(db, {
      id: d.abanId,
      expectedRevision: schedule.revision,
      status: schedule.status,
    });
  } finally {
    await pool.end();
  }
  const before = await snapshot(d);
  await assign(content, head!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "برنامه از زمان نمایش این فهرست تغییر کرده",
  );
  await expect(panel(page).getByRole("alert")).toContainText(
    "اطلاعات به‌روزرسانی شد",
  );
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(assign(content, head!.displayName)).toBeEnabled();
  expect((await snapshot(d)).revision).toBe(before.revision);
  await assign(content, head!.displayName).click();
  await expect(content.getByRole("status")).toContainText("تکمیل شد");
  expect((await snapshot(d)).revision).toBe(before.revision + 1);
});

test("resolved shortage race shows completion with no stale Assign controls", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head, nurse] = await people(d);
  const { content, trigger } = await open(page, d);
  await assignment(d, nurse!.id, "M"); // Test-only concurrent write without bumping the revision to exercise NO_SHORTAGE.
  const before = await snapshot(d);
  await assign(content, head!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "کمبود این شیفت قبلاً برطرف",
  );
  await expect(content.getByRole("status")).toContainText("تکمیل شد");
  await expect(content.getByRole("button", { name: /^تخصیص/ })).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect((await snapshot(d)).revision).toBe(before.revision);
});

test("already-working candidate is refreshed away without reshuffling", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  const { content } = await open(page, d);
  await assignment(d, head!.id, "E");
  const before = await snapshot(d);
  await assign(content, head!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "قبلاً شیفت کاری ثبت",
  );
  await expect(
    content.getByText(head!.displayName, { exact: true }),
  ).toHaveCount(0);
  expect((await snapshot(d)).revision).toBe(before.revision);
});

test("no-longer-eligible candidate is removed without exposing account details", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [, nurse] = await people(d);
  const { content } = await open(page, d);
  const { db, pool } = database();
  try {
    await setUserActive(db, nurse!.id, false);
  } finally {
    await pool.end();
  }
  await assign(content, nurse!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "دیگر برای این شیفت در دسترس نیست",
  );
  await expect(
    content.getByText(nurse!.displayName, { exact: true }),
  ).toHaveCount(0);
  expect(await panel(page).innerText()).not.toMatch(
    /غیرفعال|عضویت|[a-f0-9]{8}-[a-f0-9]{4}-/,
  );
});

test("new hard-rule failure renders structured findings and moves candidate to Not Allowed without bypass", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  const { content } = await open(page, d);
  await assignment(d, head!.id, "N", isoDate("2026-10-24"));
  const before = await snapshot(d);
  await assign(content, head!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "با قوانین برنامه سازگار نیست",
  );
  await expect(
    panel(page).locator('li[data-category="RULE_VIOLATION"]').first(),
  ).toContainText("استراحت پس از شیفت شب");
  const forbidden = content.getByRole("region", {
    name: "غیرمجاز",
    exact: true,
  });
  await expect(forbidden).toContainText(head!.displayName);
  await expect(forbidden.getByRole("button")).toHaveCount(0);
  expect((await snapshot(d)).revision).toBe(before.revision);
  await noOverflow(page);
});

test("a newly locked schedule refreshes to read-only without workflow transitions", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  const { content } = await open(page, d);
  await forceScheduleStatus(d.abanId, "SUBMITTED");
  await assign(content, head!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText("قفل");
  await expect(content.getByRole("button", { name: /^تخصیص/ })).toHaveCount(0);
  await expect(content).toContainText("فقط مشاهده");
  expect((await snapshot(d)).status).toBe("SUBMITTED");
});

test("network failure leaves candidates intact; manual retry succeeds", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  const { content, trigger } = await open(page, d);
  await page.route("**/*", (route) =>
    route.request().headers()["next-action"] &&
    route.request().postData()?.includes("expectedRevision")
      ? route.abort("failed")
      : route.continue(),
  );
  const before = await snapshot(d);
  await assign(content, head!.displayName).click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "ثبت شیفت تأیید نشد",
  );
  await expect(assign(content, head!.displayName)).toBeEnabled();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect((await snapshot(d)).revision).toBe(before.revision);
  await noOverflow(page);
  await page.unroute("**/*");
  await assign(content, head!.displayName).click();
  await expect(content.getByRole("status")).toContainText("تکمیل شد");
});
