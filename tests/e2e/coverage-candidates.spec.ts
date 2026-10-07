import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../../src/infrastructure/db/database";
import { auditEvents } from "../../src/infrastructure/db/schema";
import { isoDate } from "../../src/domain/shared/dates";
import {
  listAssignments,
  setAssignment,
} from "../../src/infrastructure/repositories/assignments";
import { setPreference } from "../../src/infrastructure/repositories/preferences";
import { findScheduleById } from "../../src/infrastructure/repositories/schedules";
import { findUserByEmail } from "../../src/infrastructure/repositories/users";
import { signInAndWait } from "./support/auth";
import { provisionApprovalDepartment } from "./support/approval";
import {
  forceScheduleStatus,
  provisionReviewDepartment,
  type ReviewDepartment,
} from "./support/review";

const DATE = "2026-10-25";
const url = (d: ReviewDepartment, date = DATE) =>
  `/departments/${d.code}/schedule?month=1405-08&day=${date}`;
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
    return {
      schedule: await findScheduleById(db, d.abanId),
      assignments: await listAssignments(db, d.abanId),
      audits: await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.scheduleId, d.abanId)),
    };
  } finally {
    await pool.end();
  }
}
async function assign(
  d: ReviewDepartment,
  userId: string,
  shift: "M" | "N" | "OFF",
  date = DATE,
) {
  const { db, pool } = database();
  try {
    const head = (await findUserByEmail(db, d.headEmail))!;
    await setAssignment(db, {
      scheduleId: d.abanId,
      userId,
      date: isoDate(date),
      shift,
      updatedBy: head.id,
    });
  } finally {
    await pool.end();
  }
}

test("shortage preview preserves OFF, soft preferences, findings and all persisted state", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [, off, blocked] = await people(d);
  await assign(d, off!.id, "OFF");
  await assign(d, blocked!.id, "N", "2026-10-24");
  const { db, pool } = database();
  try {
    await setPreference(db, {
      scheduleId: d.abanId,
      userId: off!.id,
      date: isoDate(DATE),
      value: "OFF",
    });
  } finally {
    await pool.end();
  }
  const before = await snapshot(d);
  await signInAndWait(page, d.headEmail);
  await page.goto(url(d));
  const panel = page.getByRole("region", { name: "افراد برای جبران کمبود" });
  await expect(
    panel.getByRole("button", { name: /^افراد برای کمبود/ }),
  ).toHaveCount(2); // E and M; N is already filled.
  await panel.getByRole("button", { name: /کمبود صبح \(M\)/ }).press("Enter");
  const available = panel.getByRole("region", {
    name: "قابل انتخاب",
    exact: true,
  });
  const forbidden = panel.getByRole("region", { name: "غیرمجاز", exact: true });
  await expect(
    available.getByText(off!.displayName, { exact: true }),
  ).toBeVisible();
  await expect(available).toContainText("تصمیم OFF باید تغییر کند");
  await expect(available).toContainText("مانع انتخاب نیست");
  await expect(forbidden).toContainText(blocked!.displayName);
  await expect(forbidden).toContainText("استراحت");
  await expect(available.getByRole("button")).toHaveCount(2);
  await expect(forbidden.getByRole("button")).toHaveCount(0);
  expect(await panel.innerText()).not.toMatch(
    /[a-f0-9]{8}-[a-f0-9]{4}-|امتیاز|درصد|بهترین|ساعت/,
  );
  expect(
    await page.evaluate(() => {
      const d = document.querySelector("dialog[open]")!;
      return d.scrollWidth - d.clientWidth;
    }),
  ).toBeLessThanOrEqual(0);
  expect(await snapshot(d)).toEqual(before);
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("loading, query failure, retry and stale resolved shortage", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  const [head] = await people(d);
  await signInAndWait(page, d.headEmail);
  await page.goto(url(d));
  const panel = page.getByRole("region", { name: "افراد برای جبران کمبود" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    if (!route.request().headers()["next-action"]) return route.continue();
    await gate;
    await route.abort("failed");
  });
  await panel.getByRole("button", { name: /کمبود صبح \(M\)/ }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "در حال دریافت یا ثبت اطلاعات…",
  );
  release();
  await expect(panel.getByRole("alert")).toContainText("دریافت افراد ممکن نشد");
  await page.unroute("**/*");
  await assign(d, head!.id, "M");
  await panel.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(panel).toHaveAttribute("aria-busy", "false");
  await expect(panel.getByRole("status")).toContainText("تکمیل شد");
  await expect(
    panel.getByRole("region", { name: "قابل انتخاب", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(panel.getByRole("button", { name: /کمبود صبح/ })).toHaveCount(0);
});

test("empty Available and fully covered days have no generic candidate entry", async ({
  page,
}) => {
  const d = await provisionReviewDepartment();
  for (const person of await people(d)) await assign(d, person!.id, "N");
  await signInAndWait(page, d.headEmail);
  await page.goto(url(d));
  const panel = page.getByRole("region", { name: "افراد برای جبران کمبود" });
  await panel.getByRole("button", { name: /کمبود صبح \(M\)/ }).click();
  await expect(panel).toContainText(
    "فرد قابل انتخابی برای این کمبود وجود ندارد",
  );
  await page.goto(url(d, "2026-10-24"));
  await expect(
    page.getByRole("region", { name: "افراد برای جبران کمبود" }),
  ).toHaveCount(0);
});

test("Supervisor visibility follows existing schedule authorization and remains read-only", async ({
  page,
}) => {
  const d = await provisionApprovalDepartment("planning");
  const initial = await snapshot(d);
  for (const row of initial.assignments.filter((a) => a.date === DATE))
    await assign(d, row.nurseId, "OFF");
  {
    await signInAndWait(page, d.supervisorEmail);
    const path = `/review/${d.abanId}?day=${DATE}`;
    await page.goto(path);
    await expect(
      page.getByRole("region", { name: "افراد برای جبران کمبود" }),
    ).toHaveCount(0);
    await forceScheduleStatus(d.abanId, "FINALIZED");
    await page.goto(path);
    const panel = page.getByRole("region", { name: "افراد برای جبران کمبود" });
    await panel.getByRole("button", { name: /کمبود صبح \(M\)/ }).click();
    await expect(
      panel.getByRole("region", { name: "قابل انتخاب", exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText("فقط مشاهده");
    await expect(
      panel
        .getByRole("region", { name: "قابل انتخاب", exact: true })
        .getByRole("button"),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: /کمبود صبح \(M\)/ }).click();
    await forceScheduleStatus(d.abanId, "PLANNING");
    await panel.getByRole("button", { name: /کمبود صبح \(M\)/ }).click();
    await expect(panel.getByRole("alert")).toContainText("اجازه مشاهده");
    await expect(
      panel.getByRole("region", { name: "قابل انتخاب", exact: true }),
    ).toHaveCount(0);
  }
});
