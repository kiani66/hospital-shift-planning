import { expect, test, type Locator, type Page } from "@playwright/test";

import { isDesktop, signInAndWait } from "./support/auth";
import { provisionRulesDepartment } from "./support/staffing-rules";

/**
 * The separate holiday rule of a draft (D105): ticking «قانون جدا» for a
 * bucket stores HOLIDAY bounds for it; unticked means the bucket uses the
 * NORMAL rule on holidays. What was saved must be exactly what the editor
 * shows after the save and after a reload.
 */

const PERIODS = ["M", "E", "N"] as const;

async function openDraft(page: Page, departmentName: string): Promise<Locator> {
  await page.goto("/admin/staffing-rules");
  const scope = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        level: 2,
        name: new RegExp(departmentName),
      }),
    })
    .first();
  const create = scope.getByRole("button", {
    name: "تعریف قوانین ویژه این بخش",
  });
  if (await create.isVisible()) await create.click();
  const draft = scope.locator('article[data-state="DRAFT"]');
  await expect(draft).toBeVisible();
  return draft;
}

const toggle = (draft: Locator, p: string) =>
  draft.locator(`input[name="holiday.${p}.enabled"]`);

async function save(draft: Locator) {
  await draft.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
  await expect(draft.getByText("پیش‌نویس ذخیره شد.")).toBeVisible();
}

/** The holiday part of the editor as the user sees it: enabled flag + values. */
async function holidayState(draft: Locator) {
  const state: Record<string, unknown> = {};
  for (const p of PERIODS) {
    const enabled = await toggle(draft, p).isChecked();
    state[p] = enabled
      ? {
          min: await draft
            .locator(`input[name="holiday.${p}.min"]`)
            .inputValue(),
          max: await draft
            .locator(`input[name="holiday.${p}.max"]`)
            .inputValue(),
        }
      : null;
  }
  return state;
}

test("holiday rules of a draft persist per bucket, through save and reload", async ({
  page,
}) => {
  test.skip(!isDesktop(page), "admin editor journey, desktop only");
  test.setTimeout(120_000);
  const department = await provisionRulesDepartment();
  await signInAndWait(page, department.adminEmail);
  let draft = await openDraft(page, department.name);

  for (const p of PERIODS) {
    await draft.locator(`input[name="normal.${p}.min"]`).fill("3");
    await draft.locator(`input[name="normal.${p}.max"]`).fill("6");
  }
  // 1+2. Enabling all three separate holiday rules, with their own min/max.
  const holidayBounds = { M: [2, 4], E: [1, 3], N: [5, 8] } as const;
  for (const p of PERIODS) {
    await toggle(draft, p).check();
    await draft
      .locator(`input[name="holiday.${p}.min"]`)
      .fill(String(holidayBounds[p][0]));
    await draft
      .locator(`input[name="holiday.${p}.max"]`)
      .fill(String(holidayBounds[p][1]));
  }
  await save(draft);
  // Right after the save (no reload) the checkboxes must still be ticked.
  for (const p of PERIODS) await expect(toggle(draft, p)).toBeChecked();
  expect(await holidayState(draft)).toEqual({
    M: { min: "2", max: "4" },
    E: { min: "1", max: "3" },
    N: { min: "5", max: "8" },
  });
  // A second save from the same page (no reload) must not drop the rules.
  await save(draft);

  await page.reload();
  draft = await openDraft(page, department.name);
  expect(await holidayState(draft)).toEqual({
    M: { min: "2", max: "4" },
    E: { min: "1", max: "3" },
    N: { min: "5", max: "8" },
  });

  // 5. Saving an unrelated field (the note) does not reset the holiday rules.
  await draft.locator('[name="note"]').fill("یادداشت آزمایشی");
  await save(draft);
  await page.reload();
  draft = await openDraft(page, department.name);
  expect(await holidayState(draft)).toEqual({
    M: { min: "2", max: "4" },
    E: { min: "1", max: "3" },
    N: { min: "5", max: "8" },
  });

  // 4. Buckets are independent: disable only E; M and N keep their rule.
  await toggle(draft, "E").uncheck();
  await save(draft);
  await expect(toggle(draft, "M")).toBeChecked();
  await expect(toggle(draft, "E")).not.toBeChecked();
  await expect(toggle(draft, "N")).toBeChecked();
  await page.reload();
  draft = await openDraft(page, department.name);
  // 3. Disabled means no stored holiday rule: E falls back to NORMAL.
  expect(await holidayState(draft)).toEqual({
    M: { min: "2", max: "4" },
    E: null,
    N: { min: "5", max: "8" },
  });

  // Re-enabling E starts from a blank rule, never from stale values.
  await toggle(draft, "E").check();
  await expect(draft.locator('input[name="holiday.E.min"]')).toHaveValue("");
});
