import { expect, test, type Page } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import {
  DAILY_DATE,
  provisionDailyPreferences,
  dailyState,
  changeDailyPreference,
  type DailyFixture,
} from "./support/daily-preferences";
import { forceScheduleStatus } from "./support/review";
const target = (d: DailyFixture, date = DAILY_DATE) =>
  `/departments/${d.code}/schedule?schedule=${d.abanId}&day=${date}`;
const assistant = (page: Page) =>
  page.getByRole("region", { name: "دستیار ترجیحات روزانه" });
async function open(page: Page, d: DailyFixture, date = DAILY_DATE) {
  await page.goto(target(d, date));
  await assistant(page)
    .getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" })
    .click();
  await expect(
    assistant(page).getByRole("button", { name: "تازه‌سازی پیشنهادها" }),
  ).toBeEnabled();
}
const row = (page: Page, name: string) =>
  assistant(page).getByRole("listitem", {
    name: `پیشنهاد ${name}`,
    exact: true,
  });

test("individual and bulk persist immediately; rejections reset; actual coverage and existing decisions refresh", async ({
  page,
}, info) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.headEmail);
  await open(page, d);
  const a = assistant(page);
  for (const shift of ["M", "E", "N", "ME"])
    await expect(
      a.getByRole("region", { name: `گروه ${shift}`, exact: true }),
    ).toBeVisible();
  await expect(
    a.getByRole("region", { name: "ترجیحات استراحت" }),
  ).toContainText("فقط جهت اطلاع");
  await expect(row(page, "منشی آزمایشی")).toContainText("خارج از پوشش پرستاری");
  await expect(row(page, "منشی آزمایشی").getByRole("button")).toHaveCount(0);
  await row(page, d.names[1]!)
    .getByRole("button", { name: "رد پیشنهاد", exact: true })
    .click();
  await expect(
    row(page, d.names[1]!).getByRole("button", { name: /^تأیید پیشنهاد/ }),
  ).toBeDisabled();
  await a.getByRole("button", { name: "تأیید همه پیشنهادهای مجاز" }).click();
  await expect(a.getByRole("status")).toContainText("۲ تخصیص ثبت شد");
  await expect(row(page, d.names[0]!)).toContainText("قبلاً تخصیص یافته");
  const state = await dailyState(d);
  expect(state.assignments.filter((x) => x.date === DAILY_DATE)).toHaveLength(
    2,
  );
  expect(
    state.assignments.some(
      (x) => x.date === DAILY_DATE && x.nurseId === d.ids[1],
    ),
  ).toBe(false);
  await a.getByRole("button", { name: "بستن دستیار" }).click();
  await expect(
    a.getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" }),
  ).toBeFocused();
  await a
    .getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" })
    .press("Enter");
  await expect(
    row(page, d.names[1]!).getByRole("button", { name: /^تأیید پیشنهاد/ }),
  ).toBeEnabled();
  await row(page, d.names[1]!)
    .getByRole("button", { name: /^تأیید پیشنهاد/ })
    .click();
  await expect(a.getByRole("status")).toContainText("۱ تخصیص ثبت شد");
  await expect(row(page, d.names[1]!)).toContainText("قبلاً تخصیص یافته");
  expect(
    (await dailyState(d)).assignments.filter((x) => x.date === DAILY_DATE),
  ).toHaveLength(3);
  await expect(a.getByText("پوشش فعلی: ۲", { exact: true })).toHaveCount(1);
  await expect(a.getByText("کمبود باقی‌مانده: ۰", { exact: true })).toHaveCount(
    3,
  );
  await a.getByText("جزئیات نتیجه", { exact: true }).click();
  await expect(a).toContainText(`${d.names[1]} · ME · ثبت شد`);
  await page.screenshot({
    path: info.outputPath("daily-assistant-accepted.png"),
  });
  await info.attach("accepted assistant", {
    path: info.outputPath("daily-assistant-accepted.png"),
    contentType: "image/png",
  });
  await open(page, d, "2026-10-28");
  for (const name of d.names.slice(0, 3))
    await expect(
      row(page, name!).getByRole("button", { name: /^تأیید پیشنهاد/ }),
    ).toBeDisabled();
  await expect(row(page, d.names[0]!)).toContainText("OFF");
  await expect(row(page, d.names[1]!)).toContainText("H");
  await expect(row(page, d.names[2]!)).toContainText("استراحت");
  await expect(row(page, d.names[3]!)).toContainText("قبلاً تخصیص یافته");
});

test("contention remains manual after rejection; independent night group proceeds; RTL layout fits 320/768/1280px", async ({
  page,
}, info) => {
  const d = await provisionDailyPreferences(true);
  await signInAndWait(page, d.headEmail);
  await open(page, d);
  const a = assistant(page);
  for (const shift of ["M", "ME"])
    await expect(
      a.getByRole("region", { name: `گروه ${shift}`, exact: true }),
    ).toContainText("انتخاب دستی");
  await row(page, d.names[1]!)
    .getByRole("button", { name: "رد پیشنهاد", exact: true })
    .click();
  await a.getByRole("button", { name: "تأیید همه پیشنهادهای مجاز" }).click();
  await expect(a.getByRole("status")).toContainText("۱ تخصیص ثبت شد");
  const created = (await dailyState(d)).assignments.filter(
    (x) => x.date === DAILY_DATE,
  );
  expect(created.map((x) => x.shift)).toEqual(["N"]);
  await expect(
    a.getByRole("region", { name: "گروه M", exact: true }),
  ).toContainText("انتخاب دستی");
  await expect(
    a.getByRole("button", { name: "تأیید همه پیشنهادهای مجاز" }),
  ).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await a
    .getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" })
    .scrollIntoViewIfNeeded();
  await page.getByRole("dialog").evaluate((el) => {
    el.scrollTop = 0;
  });
  const screenshot = info.outputPath("daily-assistant-capacity.png");
  await page.screenshot({ path: screenshot });
  await info.attach("daily assistant capacity", {
    path: screenshot,
    contentType: "image/png",
  });
  await a
    .getByRole("region", { name: "گروه ME", exact: true })
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  const groupScreenshot = info.outputPath("daily-assistant-group.png");
  await page.screenshot({ path: groupScreenshot });
  await info.attach("daily assistant shared-capacity group", {
    path: groupScreenshot,
    contentType: "image/png",
  });
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollWidth - innerWidth,
          ...Array.from(
            document.querySelectorAll(
              'dialog[open], section[aria-label="دستیار ترجیحات روزانه"]',
            ),
          ).map((e) => e.scrollWidth - e.clientWidth),
        ),
      ),
      `Horizontal overflow at ${width}px`,
    ).toBeLessThanOrEqual(1);
  }
  await row(page, d.names[0]!)
    .getByRole("button", { name: /^تأیید پیشنهاد/ })
    .click();
  await expect(row(page, d.names[0]!)).toContainText("قبلاً تخصیص یافته");
});

test("stale preference requires another explicit click and derives the new shift on the server", async ({
  page,
}) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.headEmail);
  await open(page, d);
  const before = await dailyState(d);
  await changeDailyPreference(d, "E");
  await row(page, d.names[0]!)
    .getByRole("button", { name: /^تأیید پیشنهاد/ })
    .click();
  await expect(assistant(page).getByRole("status")).toContainText(
    "دوباره تأیید کنید",
  );
  await expect(
    row(page, d.names[0]!).getByRole("button", { name: /^تأیید پیشنهاد/ }),
  ).toBeEnabled();
  expect(await dailyState(d)).toEqual(before);
  await expect(
    assistant(page).getByRole("region", { name: "گروه E", exact: true }),
  ).toContainText(d.names[0]!);
  await row(page, d.names[0]!)
    .getByRole("button", { name: /^تأیید پیشنهاد/ })
    .click();
  await expect(assistant(page).getByRole("status")).toContainText(
    "۱ تخصیص ثبت شد",
  );
  expect(
    (await dailyState(d)).assignments.find(
      (x) => x.date === DAILY_DATE && x.nurseId === d.ids[0],
    )?.shift,
  ).toBe("E");
});

test("empty day is read only; PLANNING is available and FINALIZED hides entry", async ({
  page,
}) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.headEmail);
  await forceScheduleStatus(d.abanId, "PLANNING");
  const before = await dailyState(d);
  await open(page, d, "2026-10-30");
  await expect(assistant(page)).toContainText(
    "برای این روز ترجیحی ثبت نشده است.",
  );
  await expect(
    assistant(page).getByRole("button", { name: /تأیید/ }),
  ).toHaveCount(0);
  expect(await dailyState(d)).toEqual(before);
  await forceScheduleStatus(d.abanId, "FINALIZED");
  await page.reload();
  await expect(assistant(page)).toHaveCount(0);
});

test("late preview cannot reopen a closed assistant or leak into another day", async ({
  page,
}) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.headEmail);
  await page.goto(target(d));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const started = new Promise<void>((resolve) => {
    received = resolve;
  });
  let intercepted = false;
  await page.route("**/departments/**/schedule**", async (route) => {
    if (
      !intercepted &&
      route.request().method() === "POST" &&
      route.request().postData()?.includes(DAILY_DATE)
    ) {
      intercepted = true;
      const response = await route.fetch();
      received();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  await assistant(page)
    .getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" })
    .click();
  await started;
  await expect(
    assistant(page).getByRole("button", { name: "تازه‌سازی پیشنهادها" }),
  ).toBeDisabled();
  await assistant(page).getByRole("button", { name: "بستن دستیار" }).click();
  await page.getByRole("link", { name: /^روز بعد:/ }).click();
  // Next serializes navigation behind an in-flight Server Action.
  release();
  await expect(page).toHaveURL(/day=2026-10-28/);
  await expect(
    assistant(page).getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" }),
  ).toHaveAttribute("aria-expanded", "false");
  await assistant(page)
    .getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" })
    .click();
  await expect(row(page, d.names[0]!)).toContainText("OFF");
  await expect(
    row(page, d.names[0]!).getByRole("button", { name: /^تأیید پیشنهاد/ }),
  ).toBeDisabled();
});

test("entry is independent of open and closed preference windows", async ({
  page,
}) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.headEmail);
  const url = `/departments/${d.code}/schedule?schedule=${d.abanId}`;
  await page.goto(url);
  await page
    .getByRole("button", { name: "باز کردن ثبت ترجیحات", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "بله، باز شود" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await open(page, d);
  await expect(
    row(page, d.names[0]!).getByRole("button", { name: /^تأیید پیشنهاد/ }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "بستن جزئیات روز" }).click();
  await page
    .getByRole("button", { name: "بستن ثبت ترجیحات", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "بله، بسته شود" })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await open(page, d);
  await row(page, d.names[0]!)
    .getByRole("button", { name: /^تأیید پیشنهاد/ })
    .click();
  await expect(assistant(page).getByRole("status")).toContainText(
    "۱ تخصیص ثبت شد",
  );
});

test("failed read is recoverable and pending acceptance cannot submit twice", async ({
  page,
}) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.headEmail);
  await page.goto(target(d));
  let failRead = true;
  await page.route("**/departments/**/schedule**", async (route) => {
    if (failRead && route.request().method() === "POST") {
      failRead = false;
      await route.abort();
    } else await route.continue();
  });
  await assistant(page)
    .getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" })
    .click();
  await expect(assistant(page).getByRole("status")).toContainText(
    "دریافت پیشنهادها ممکن نشد",
  );
  await expect(
    assistant(page).getByRole("button", { name: "تأیید همه پیشنهادهای مجاز" }),
  ).toHaveCount(0);
  await assistant(page)
    .getByRole("button", { name: "تازه‌سازی پیشنهادها" })
    .click();
  const button = row(page, d.names[0]!).getByRole("button", {
    name: /^تأیید پیشنهاد/,
  });
  await expect(button).toBeEnabled();
  await page.unroute("**/departments/**/schedule**");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route("**/departments/**/schedule**", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes('"kind":"ONE"')
    ) {
      submissions++;
      const response = await route.fetch();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  try {
    await button.evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    await expect(button).toBeDisabled();
    await expect(
      assistant(page).getByRole("button", {
        name: "تأیید همه پیشنهادهای مجاز",
      }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(assistant(page).getByRole("status")).toContainText(
    "۱ تخصیص ثبت شد",
  );
  expect(submissions).toBe(1);
  expect(
    (await dailyState(d)).assignments.filter((x) => x.date === DAILY_DATE),
  ).toHaveLength(1);
});

test("a nurse cannot access the Head Nurse assistant", async ({ page }) => {
  const d = await provisionDailyPreferences();
  await signInAndWait(page, d.nurseEmail);
  await page.goto(target(d));
  await expect(assistant(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "پیشنهاد بر اساس ترجیحات" }),
  ).toHaveCount(0);
});
