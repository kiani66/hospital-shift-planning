import { describe, expect, it } from "vitest";

import type { ActionError } from "@/application/result";
import { isoDate } from "@/domain/shared/dates";

import {
  blockerLabel,
  validationBlockerLines,
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
  "discard",
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

const CLEAN = {
  undecided: 0,
  undecidedDays: 0,
  coverageProblems: 0,
  shortages: 0,
  overstaffing: 0,
  ruleViolations: 0,
};

describe("blockerLabel / validationBlockerLines (D104)", () => {
  it("names each open category separately, never as conflicts", () => {
    const counts = {
      undecided: 80,
      undecidedDays: 12,
      coverageProblems: 24,
      shortages: 20,
      overstaffing: 4,
      ruleViolations: 7,
    };
    expect(validationBlockerLines(counts)).toEqual([
      "۸۰ تصمیم تعیین‌نشده در ۱۲ روز",
      "۲۴ مشکل پوشش (۲۰ کمبود نیرو، ۴ مازاد نیرو)",
      "۷ نقض قانون",
    ]);
    const label = blockerLabel("VALIDATION", counts);
    expect(label).toContain("۸۰ تصمیم تعیین‌نشده در ۱۲ روز");
    expect(label).not.toMatch(/مغایرت/);
  });

  it("lists only open categories", () => {
    expect(
      validationBlockerLines({ ...CLEAN, undecided: 3, undecidedDays: 1 }),
    ).toEqual(["۳ تصمیم تعیین‌نشده در ۱ روز"]);
    expect(
      validationBlockerLines({
        ...CLEAN,
        coverageProblems: 1,
        overstaffing: 1,
      }),
    ).toEqual(["۱ مشکل پوشش (۱ مازاد نیرو)"]);
  });

  it("asks to close preference collection before submitting", () => {
    expect(blockerLabel("PREFERENCE_WINDOW_OPEN", CLEAN)).toContain("ببندید");
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

  it("explains a refusal per category with the days to fix", () => {
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
      "این کار انجام نشد، چون برنامه هنوز کامل و معتبر نیست: ۱ نقض قانون. روزهای ۴ آبان را بررسی کنید.",
    );
    const mixed = workflowErrorMessage(
      "finalize",
      error({
        code: "RULE_VIOLATION",
        violations: [
          {
            rule: "UNDECIDED",
            severity: "error",
            nurseId: "a",
            date: isoDate("2026-10-24"),
          },
          {
            rule: "UNDECIDED",
            severity: "error",
            nurseId: "b",
            date: isoDate("2026-10-24"),
          },
          {
            rule: "STAFFING",
            severity: "error",
            date: isoDate("2026-10-25"),
            period: "N",
            covered: 7,
            status: "ABOVE_MAXIMUM",
            bounds: { min: 3, max: 6 },
          },
        ],
      }),
    );
    expect(mixed).toContain("۲ تصمیم تعیین‌نشده در ۱ روز");
    expect(mixed).toContain("۱ مشکل پوشش (۱ مازاد نیرو)");
    expect(mixed).not.toMatch(/مغایرت|نقض قانون/);
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
