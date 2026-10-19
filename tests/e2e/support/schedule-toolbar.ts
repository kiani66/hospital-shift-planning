import { expect, type Page } from "@playwright/test";

/** Secondary controls are exposed inline on wide layouts, in a disclosure otherwise. */
export async function openScheduleActions(page: Page) {
  const trigger = page
    .locator("[data-schedule-toolbar]")
    .getByRole("button", { name: "عملیات بیشتر", exact: true });
  if (
    (await trigger.isVisible()) &&
    (await trigger.getAttribute("aria-expanded")) !== "true"
  ) {
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
  }
}

/** Exercise the longest existing export action using a real saved template. */
export async function installToolbarTemplate(department: {
  headEmail: string;
  code: string;
}) {
  const { createDatabase } =
    await import("../../../src/infrastructure/db/database");
  const { findUserByEmail } =
    await import("../../../src/infrastructure/repositories/users");
  const { findDepartmentByCode } =
    await import("../../../src/infrastructure/repositories/departments");
  const { loadActor } =
    await import("../../../src/infrastructure/repositories/memberships");
  const { todayIn } = await import("../../../src/infrastructure/auth/actor");
  const { uploadExcelTemplate } =
    await import("../../../src/application/excel-export/templates");
  const { syntheticTemplate } = await import("../../support/excel-templates");
  const { db, pool } = createDatabase(process.env.DATABASE_URL!, { max: 1 });
  try {
    const head = (await findUserByEmail(db, department.headEmail))!;
    const actor = (await loadActor(db, head.id, todayIn("Asia/Tehran")))!;
    const record = (await findDepartmentByCode(db, department.code))!;
    const result = await uploadExcelTemplate(
      { db, actor },
      {
        departmentId: record.id,
        expectedTemplateId: null,
        fileName: "toolbar-template.xlsx",
        content: await syntheticTemplate({
          people: [{ row: 7, number: "12345", name: "پرستار نمونه" }],
        }),
        mapping: {
          sheetName: "برنامه ماهانه",
          personnelColumn: "B",
          firstRow: 7,
          lastRow: 7,
          firstDayColumn: "F",
        },
      },
    );
    if (!result.ok) throw new Error(result.error.message);
  } finally {
    await pool.end();
  }
}
