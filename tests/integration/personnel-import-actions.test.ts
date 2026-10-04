import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapHospitalAdmin } from "../../src/application/management/bootstrap";
import type { AppContext } from "../../src/application/use-case";
import { isoDate } from "../../src/domain/shared/dates";
import { formatJalaliInput } from "../../src/features/calendar/jalali-input";
import {
  commitImportAction,
  issueImportPasswordsAction,
  previewImportAction,
  type PreviewState,
} from "../../src/features/personnel-import/actions";
import { auditEvents } from "../../src/infrastructure/db/schema";
import {
  DEMO_ICU,
  DEMO_USERS as U,
} from "../../src/infrastructure/db/seed/demo-data";
import { loadActor } from "../../src/infrastructure/repositories/memberships";
import { findUserByPersonnelNumber } from "../../src/infrastructure/repositories/users";
import { setupTestDatabase } from "./support/database";

const adapter = vi.hoisted(() => ({
  ctx: undefined as AppContext | undefined,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/features/auth/guards", () => ({
  requireRequestContext: vi.fn(async () => adapter.ctx!),
}));

const { db } = setupTestDatabase();
const today = isoDate("2026-10-03");
const now = new Date("2026-10-03T08:00:00Z");
const as = async (id: string): Promise<AppContext> => ({
  db,
  actor: (await loadActor(db, id, today))!,
  clock: () => now,
});

beforeEach(async () => {
  await bootstrapHospitalAdmin(
    db,
    { email: U.icuHead.email, confirm: "ESTABLISH_FIRST_HOSPITAL_ADMIN" },
    now,
  );
  adapter.ctx = await as(U.icuHead.id);
  vi.mocked(revalidatePath).mockClear();
});

const CSV =
  "﻿شماره پرسنلی؛نام و نام خانوادگی؛موبایل\r\n" +
  "۰۰۷۰۱؛نسرین پاک؛۰۹۱۲۱۲۳۴۵۶۷\r\n";

const uploadForm = (
  text: string | Uint8Array<ArrayBuffer> = CSV,
  extra: Record<string, string> = {},
) => {
  const form = new FormData();
  form.set(
    "file",
    new File(
      [typeof text === "string" ? new TextEncoder().encode(text) : text],
      "staff.csv",
      {
        type: "text/csv",
      },
    ),
  );
  form.set("departmentId", DEMO_ICU.id);
  form.set("startedOn", formatJalaliInput(isoDate("2026-10-10")));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
};

async function previewOk(form = uploadForm()) {
  const state = await previewImportAction({ status: "idle" }, form);
  if (state.status !== "preview") throw new Error(JSON.stringify(state));
  return state;
}
const commitForm = (
  state: Extract<PreviewState, { status: "preview" }>,
  confirm = true,
) => {
  const form = new FormData();
  form.set("payload", JSON.stringify(state.payload));
  if (confirm) form.set("confirm", "on");
  return form;
};

describe("import Server Actions", () => {
  it("previews a Persian-locale Excel CSV (BOM, Arabic semicolon, Persian digits)", async () => {
    const state = await previewOk();
    expect(state).toMatchObject({
      department: { id: DEMO_ICU.id },
      startedOn: "2026-10-10",
      committable: true,
      hasChanges: true,
      rows: [
        {
          line: 2,
          action: "CREATE",
          values: {
            personnelNumber: "00701",
            displayName: "نسرین پاک",
            mobile: "09121234567",
          },
        },
      ],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      "no file",
      () => {
        const f = uploadForm();
        f.delete("file");
        return f;
      },
      "فایل CSV",
    ],
    [
      "a non-UTF-8 file",
      () => uploadForm(new Uint8Array([0xc7, 0xe1, 0xff])),
      "UTF-8",
    ],
    ["an oversize file", () => uploadForm("a".repeat(256 * 1024 + 1)), "۲۵۶"],
    ["a bad date", () => uploadForm(CSV, { startedOn: "tomorrow" }), "تاریخ"],
    [
      "a missing column",
      () => uploadForm("ایمیل\na@x.invalid"),
      "شماره پرسنلی",
    ],
  ])("explains %s in Persian", async (_n, make, fragment) => {
    const state = await previewImportAction({ status: "idle" }, make());
    expect(state).toMatchObject({ status: "error" });
    expect(state.status === "error" && state.message).toContain(fragment);
  });

  it("requires explicit confirmation, then commits and returns only safe fields", async () => {
    const state = await previewOk();
    expect(
      await commitImportAction({ status: "idle" }, commitForm(state, false)),
    ).toMatchObject({ status: "error" });
    expect(await findUserByPersonnelNumber(db, "00701")).toBeNull();

    const committed = await commitImportAction(
      { status: "idle" },
      commitForm(state),
    );
    expect(committed).toMatchObject({
      status: "committed",
      outcome: { membershipsAdded: 1, unchanged: 0 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    // A double submission is refused as already applied, nothing written twice.
    expect(
      await commitImportAction({ status: "idle" }, commitForm(state)),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("تغییر کرده"),
    });
  });

  it("rejects a forged payload without writing", async () => {
    const form = new FormData();
    form.set("confirm", "on");
    form.set("payload", "{not json");
    expect(await commitImportAction({ status: "idle" }, form)).toMatchObject({
      status: "error",
    });
    const before = await db.select().from(auditEvents);
    const state = await previewOk();
    const forged = commitForm(state);
    forged.set(
      "payload",
      JSON.stringify({
        ...state.payload,
        rows: [{ ...state.payload.rows[0], displayName: "x" }],
      }),
    );
    expect(await commitImportAction({ status: "idle" }, forged)).toMatchObject({
      status: "error",
    });
    expect(await db.select().from(auditEvents)).toEqual(before);
  });

  it("shows one-time passwords only for the new accounts", async () => {
    const state = await previewOk();
    const committed = await commitImportAction(
      { status: "idle" },
      commitForm(state),
    );
    if (committed.status !== "committed") throw new Error("not committed");
    const form = new FormData();
    for (const c of committed.outcome.created) form.append("userId", c.userId);
    const issued = await issueImportPasswordsAction({ status: "idle" }, form);
    expect(issued).toMatchObject({
      status: "issued",
      results: [
        {
          personnelNumber: "00701",
          status: "ISSUED",
          temporaryPassword: expect.any(String),
        },
      ],
    });
    expect(JSON.stringify(issued)).not.toMatch(/userId|hash/);
  });

  it("denies non-admins at every step", async () => {
    const state = await previewOk();
    adapter.ctx = await as(U.erHead.id);
    expect(
      await previewImportAction({ status: "idle" }, uploadForm()),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("اجازه"),
    });
    expect(
      await commitImportAction({ status: "idle" }, commitForm(state)),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("اجازه"),
    });
    expect(await findUserByPersonnelNumber(db, "00701")).toBeNull();
  });
});
