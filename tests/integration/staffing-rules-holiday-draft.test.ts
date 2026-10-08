import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createRuleSetDraft,
  updateRuleSetDraft,
} from "../../src/application/staffing-rules/commands";
import type { ActionResult } from "../../src/application/result";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import {
  COVERAGE_PERIODS,
  type BaseShift,
} from "../../src/domain/shifts/shift-type";
import {
  staffingRuleSetRequirements,
  users,
} from "../../src/infrastructure/db/schema";
import {
  DEMO_ER,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import {
  findRuleSetVersion,
  loadRuleSetContent,
} from "../../src/infrastructure/repositories/staffing-rules";
import {
  contentFormValue,
  parseContentForm,
  type ContentFormValue,
} from "../../src/features/staffing-rules/presentation";
import { setupTestDatabase } from "./support/database";
import { SHIFT_LABELS } from "../support/shift-labels";

/**
 * The holiday part of a draft end to end below the browser: the editor's
 * form fields → parseContentForm → updateRuleSetDraft → staffing_rule_set_requirements
 * → loadRuleSetContent → contentFormValue (what the editor shows again).
 * "Enabled" is the presence of the HOLIDAY row of that bucket; unchecked means
 * no row, so the bucket uses the NORMAL rule on holidays.
 */

const { db } = setupTestDatabase();
const now = new Date("2026-10-01T08:00:00Z");
const today = isoDate("2026-10-01");

const ok = <T>(result: ActionResult<T>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data;
};

type Bounds = { min: number; max: number | null };
const NORMAL: Record<BaseShift, Bounds> = {
  M: { min: 3, max: 6 },
  E: { min: 3, max: 6 },
  N: { min: 3, max: 6 },
};

let admin: AppContext;
let versionId: string;

beforeEach(async () => {
  await db
    .update(users)
    .set({ isHospitalAdmin: true })
    .where(eq(users.id, U.erHead.id));
  admin = {
    db,
    actor: (await loadActor(db, U.erHead.id, today))!,
    clock: () => now,
  };
  versionId = ok(
    await createRuleSetDraft(admin, { departmentId: DEMO_ER.id }),
  ).versionId;
});

/** The fields a browser submits for the editor: a ticked box sends "on"; unticked sends nothing. */
function submit(
  holiday: Partial<Record<BaseShift, Bounds>>,
  normal: Record<BaseShift, Bounds> = NORMAL,
  note = "",
): FormData {
  const form = new FormData();
  for (const p of COVERAGE_PERIODS) {
    form.set(`normal.${p}.min`, String(normal[p].min));
    form.set(
      `normal.${p}.max`,
      normal[p].max === null ? "" : String(normal[p].max),
    );
    const h = holiday[p];
    if (!h) continue; // disabled inputs and the unticked box are not submitted
    form.set(`holiday.${p}.enabled`, "on");
    form.set(`holiday.${p}.min`, String(h.min));
    form.set(`holiday.${p}.max`, h.max === null ? "" : String(h.max));
  }
  form.set("note", note);
  return form;
}

/** Saves the form like updateDraftAction does, then reloads what the editor shows. */
async function saveAndReload(form: FormData): Promise<ContentFormValue> {
  const content = parseContentForm(form, SHIFT_LABELS);
  if (!content.ok) throw new Error(content.message);
  const version = (await findRuleSetVersion(db, versionId))!;
  ok(
    await updateRuleSetDraft(admin, {
      versionId,
      expectedRevision: version.revision,
      content: content.value,
      note: String(form.get("note") ?? "") || null,
    }),
  );
  return contentFormValue(await loadRuleSetContent(db, versionId));
}

const holidayRows = async () =>
  (
    await db
      .select()
      .from(staffingRuleSetRequirements)
      .where(eq(staffingRuleSetRequirements.versionId, versionId))
  )
    .filter((r) => r.dayType === "HOLIDAY")
    .map((r) => `${r.coveragePeriod}:${r.minStaff}-${r.maxStaff ?? ""}`)
    .sort();

describe("holiday rules of a draft", () => {
  it("persists an enabled rule and its min/max, and reproduces it on reload", async () => {
    const shown = await saveAndReload(
      submit({ M: { min: 2, max: 4 }, E: { min: 1, max: null } }),
    );
    expect(shown.holiday).toEqual({
      M: { min: 2, max: 4 },
      E: { min: 1, max: null },
    });
    expect(shown.normal).toEqual(NORMAL);
    expect(await holidayRows()).toEqual(["E:1-", "M:2-4"]);
  });

  it("persists a disabled rule as no HOLIDAY row, so the bucket falls back to NORMAL", async () => {
    await saveAndReload(submit({ N: { min: 5, max: 8 } }));
    expect(await holidayRows()).toEqual(["N:5-8"]);
    const shown = await saveAndReload(submit({}));
    expect(shown.holiday).toEqual({});
    expect(await holidayRows()).toEqual([]);
    // Re-enabling starts from the submitted values, never from the old ones.
    const again = await saveAndReload(submit({ N: { min: 2, max: 3 } }));
    expect(again.holiday).toEqual({ N: { min: 2, max: 3 } });
  });

  it("enables M, E and N independently", async () => {
    const all = {
      M: { min: 2, max: 4 },
      E: { min: 1, max: 3 },
      N: { min: 5, max: 8 },
    };
    for (const p of COVERAGE_PERIODS) {
      const only = await saveAndReload(submit({ [p]: all[p] }));
      expect(Object.keys(only.holiday)).toEqual([p]);
      expect(only.holiday[p]).toEqual(all[p]);
    }
    const every = await saveAndReload(submit(all));
    expect(every.holiday).toEqual(all);
    const noE = await saveAndReload(submit({ M: all.M, N: all.N }));
    expect(noE.holiday).toEqual({ M: all.M, N: all.N });
  });

  it("keeps the holiday rules when only unrelated draft fields change", async () => {
    const holiday = { M: { min: 2, max: 4 }, N: { min: 5, max: 8 } };
    await saveAndReload(submit(holiday));
    // Same editor state resubmitted with another note, then other NORMAL bounds.
    const withNote = await saveAndReload(submit(holiday, NORMAL, "یادداشت"));
    expect(withNote.holiday).toEqual(holiday);
    const otherNormal = await saveAndReload(
      submit(holiday, { ...NORMAL, E: { min: 4, max: 7 } }),
    );
    expect(otherNormal.holiday).toEqual(holiday);
    expect(otherNormal.normal.E).toEqual({ min: 4, max: 7 });
    expect(await holidayRows()).toEqual(["M:2-4", "N:5-8"]);
  });

  it("refuses a ticked rule without a minimum instead of dropping it silently", () => {
    const form = submit({ M: { min: 2, max: 4 } });
    form.set("holiday.M.min", "");
    expect(parseContentForm(form, SHIFT_LABELS).ok).toBe(false);
  });
});
