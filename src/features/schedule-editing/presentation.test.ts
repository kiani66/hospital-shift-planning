import { describe, expect, it } from "vitest";

import type { ActionError } from "@/application/result";
import { isoDate } from "@/domain/shared/dates";

import {
  editDenialLabel,
  editFailure,
  NETWORK_FAILURE,
  preferenceFitLabel,
  savedMessage,
} from "./presentation";

const PERSIAN = /^[؀-ۿ«]/;
const RAW = /[A-Z_]{4,}|\d{4}-\d{2}-\d{2}|Error|stack/;

describe("editFailure: every error kind gets its own Persian message", () => {
  const cases: [ActionError, string, RegExp][] = [
    [{ code: "FORBIDDEN", message: "x" }, "FORBIDDEN", /اجازه ویرایش/],
    [{ code: "NOT_FOUND", message: "x" }, "FORBIDDEN", /در دسترس نیست/],
    [
      { code: "VALIDATION", message: "x", fieldErrors: { nurseId: ["x"] } },
      "INVALID",
      /در فهرست پرسنل این برنامه نیست/,
    ],
    [
      { code: "VALIDATION", message: "x", fieldErrors: { date: ["x"] } },
      "INVALID",
      /در دوره این برنامه نیست/,
    ],
    [{ code: "VALIDATION", message: "x" }, "INVALID", /معتبر نبود/],
    [{ code: "CONFLICT", message: "x" }, "CONFLICT", /در جای دیگری/],
    [
      { code: "INVALID_STATE", message: "x", reason: "EDIT_ASSIGNMENT" },
      "LOCKED",
      /قفل است/,
    ],
    [
      {
        code: "INVALID_STATE",
        message: "x",
        reason: "EDIT_ASSIGNMENT_OUTSIDE_REVISION_SCOPE",
      },
      "LOCKED",
      /محدوده بازنگری/,
    ],
    [{ code: "INTERNAL", message: "boom at db.ts" }, "SERVER", /خطای سرور/],
    [{ code: "RULE_VIOLATION", message: "x" }, "SERVER", /خطای سرور/],
  ];

  it.each(cases)("%j → %s", (error, kind, text) => {
    const failure = editFailure(error);
    expect(failure.kind).toBe(kind);
    expect(failure.message).toMatch(text);
    expect(failure.message).toMatch(PERSIAN);
    // Says that nothing was saved; never leaks codes or server text.
    expect(failure.message).toContain("تغییری ثبت نشد");
    expect(failure.message).not.toMatch(RAW);
  });

  it("has a message for a request that never got an answer", () => {
    expect(NETWORK_FAILURE).toMatchObject({ kind: "SERVER" });
    expect(NETWORK_FAILURE.message).toMatch(/ارتباط با سرور/);
  });
});

describe("savedMessage", () => {
  const names = new Map([["n1", "سارا نمونه"]]);
  const label = (d: string) => (d === "2026-10-24" ? "شنبه ۲ آبان ۱۴۰۵" : d);
  const change = (
    date: string,
    before: "M" | "N" | null,
    after: "M" | "E" | null,
  ) => ({ nurseId: "n1", date: isoDate(date), before, after });

  it("words an assignment, a change and a clear (the nurse stays on the roster)", () => {
    expect(savedMessage([change("2026-10-24", null, "M")], names, label)).toBe(
      "صبح (M) برای «سارا نمونه» در شنبه ۲ آبان ۱۴۰۵ ثبت شد.",
    );
    expect(savedMessage([change("2026-10-24", "M", "E")], names, label)).toBe(
      "عصر (E) برای «سارا نمونه» در شنبه ۲ آبان ۱۴۰۵ ثبت شد.",
    );
    expect(savedMessage([change("2026-10-24", "N", null)], names, label)).toBe(
      "شیفت «سارا نمونه» در شنبه ۲ آبان ۱۴۰۵ پاک شد؛ در فهرست پرسنل می‌ماند.",
    );
  });

  it("summarizes a range, a mixed request, a no-op and an undo", () => {
    const range = [
      change("2026-10-24", null, "E"),
      change("2026-10-25", "M", "E"),
    ];
    expect(savedMessage(range, names, label)).toBe(
      "عصر (E) برای «سارا نمونه» در ۲ روز ثبت شد.",
    );
    expect(
      savedMessage(
        [change("2026-10-24", null, "E"), change("2026-10-25", "M", null)],
        names,
        label,
      ),
    ).toBe("۲ تغییر ثبت شد.");
    expect(savedMessage([], names, label)).toMatch(/تغییری لازم نبود/);
    expect(savedMessage(range, names, label, true)).toBe(
      "آخرین تغییر بازگردانده شد (۲ مورد).",
    );
    expect(
      savedMessage(
        [{ ...change("2026-10-24", null, "M"), nurseId: "x" }],
        names,
        label,
      ),
    ).toContain("«—»");
  });
});

describe("editDenialLabel and preferenceFitLabel", () => {
  it("explains every reason a day is read-only", () => {
    for (const reason of [
      "SCHEDULE_LOCKED",
      "DATE_OUTSIDE_REVISION_SCOPE",
      "DATE_OUTSIDE_PERIOD",
      "NOT_AUTHORIZED",
    ] as const)
      expect(editDenialLabel(reason)).toMatch(PERSIAN);
  });

  it("words a differing wish neutrally and shows nothing without a decision", () => {
    expect(preferenceFitLabel("DIFFERS")).toBe("متفاوت با ترجیح");
    expect(preferenceFitLabel("MATCHES")).toBe("مطابق ترجیح");
    expect(preferenceFitLabel("NONE")).toBeNull();
    expect(preferenceFitLabel("PENDING")).toBeNull();
    // Never worded as an error or a rule.
    expect(preferenceFitLabel("DIFFERS")).not.toMatch(
      /خطا|نامعتبر|ایراد|غیرمجاز/,
    );
  });
});
