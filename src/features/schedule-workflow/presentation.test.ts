import { describe, expect, it } from "vitest";

import type { ActionError } from "@/application/result";
import { isoDate } from "@/domain/shared/dates";

import {
  blockerLabel,
  dayList,
  shortJalaliDay,
  WORKFLOW_SUCCESS,
  workflowErrorMessage,
  type LifecycleCommand,
} from "./presentation";

const COMMANDS: LifecycleCommand[] = [
  "finalize",
  "submit",
  "withdraw",
  "approve",
  "return",
];

const error = (overrides: Partial<ActionError>): ActionError => ({
  code: "INTERNAL",
  message: "technical message",
  ...overrides,
});

const PERSIAN = /[؀-ۿ]/;

describe("day wording", () => {
  it("names a day of the period in Persian", () => {
    expect(shortJalaliDay(isoDate("2026-10-26"))).toBe("۴ آبان");
  });

  it("lists up to four days, then counts the rest", () => {
    const d = (day: number) => isoDate(`2026-10-${day}`);
    expect(dayList([d(26)])).toBe("۴ آبان");
    expect(dayList([d(26), d(28)])).toBe("۴ آبان و ۶ آبان");
    expect(dayList([d(24), d(25), d(26), d(27), d(28), d(29)])).toBe(
      "۲ آبان، ۳ آبان، ۴ آبان، ۵ آبان و ۲ روز دیگر",
    );
  });
});

describe("blockerLabel", () => {
  it("says how many findings block and where", () => {
    expect(
      blockerLabel("BLOCKING_FINDINGS", {
        count: 2,
        dates: [isoDate("2026-10-26")],
      }),
    ).toBe("۲ مغایرت مسدودکننده در ۴ آبان باید برطرف شود.");
    expect(blockerLabel("BLOCKING_FINDINGS", { count: 1, dates: [] })).toBe(
      "۱ مغایرت مسدودکننده باید برطرف شود.",
    );
  });

  it("asks to close preference collection before submitting", () => {
    expect(
      blockerLabel("PREFERENCE_WINDOW_OPEN", { count: 0, dates: [] }),
    ).toContain("ببندید");
  });
});

describe("workflowErrorMessage", () => {
  it.each(COMMANDS)("never shows a code or technical text (%s)", (command) => {
    for (const code of [
      "VALIDATION",
      "FORBIDDEN",
      "NOT_FOUND",
      "INVALID_STATE",
      "CONFLICT",
      "RULE_VIOLATION",
      "INTERNAL",
    ] as const) {
      const message = workflowErrorMessage(command, error({ code }));
      expect(message).toMatch(PERSIAN);
      expect(message).not.toMatch(/[A-Z_]{4,}|technical/);
    }
  });

  it("explains self-approval", () => {
    expect(
      workflowErrorMessage(
        "approve",
        error({ code: "FORBIDDEN", reason: "SELF_APPROVAL" }),
      ),
    ).toContain("خودتان ارسال کرده‌اید");
  });

  it("explains an open preference window on submit", () => {
    expect(
      workflowErrorMessage(
        "submit",
        error({ code: "INVALID_STATE", reason: "PREFERENCE_WINDOW_OPEN" }),
      ),
    ).toContain("ثبت ترجیحات");
  });

  it("names the days of blocking findings", () => {
    expect(
      workflowErrorMessage(
        "finalize",
        error({
          code: "RULE_VIOLATION",
          violations: [
            {
              rule: "NIGHT_REST",
              severity: "error",
              nurseId: "n",
              nightDate: isoDate("2026-10-25"),
              date: isoDate("2026-10-26"),
              shift: "M",
            },
          ],
        }),
      ),
    ).toBe(
      "۱ مغایرت مسدودکننده مانع این کار است؛ روزهای ۴ آبان را بررسی و اصلاح کنید.",
    );
  });

  it("says the state changed when someone else acted first", () => {
    expect(
      workflowErrorMessage("withdraw", error({ code: "CONFLICT" })),
    ).toContain("وضعیت تازه");
    expect(
      workflowErrorMessage(
        "withdraw",
        error({ code: "INVALID_STATE", reason: "WITHDRAW" }),
      ),
    ).toBe(
      "این برنامه دیگر در وضعیتی نیست که بتوان آن را پس گرفت. وضعیت تازه نمایش داده شد.",
    );
  });

  it("asks for the return comment", () => {
    expect(
      workflowErrorMessage(
        "return",
        error({ code: "VALIDATION", fieldErrors: { comment: ["Too small"] } }),
      ),
    ).toContain("توضیح برگشت");
  });

  it("has a Persian success message for every command", () => {
    for (const command of COMMANDS)
      expect(WORKFLOW_SUCCESS[command]).toMatch(PERSIAN);
  });
});
