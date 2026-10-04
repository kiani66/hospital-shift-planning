import { describe, expect, it } from "vitest";

import type { ActionError } from "@/application/result";
import { isoDate } from "@/domain/shared/dates";

import {
  NETWORK_FAILURE,
  NO_FILTERS,
  NO_PREFERENCE_LABEL,
  editDenialLabel,
  editFailure,
  emptyListMessage,
  filterEditorNurses,
  hasActiveFilters,
  preferenceFitLabel,
  savedMessage,
  type EditorFilters,
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

  it("words every fit neutrally; no preference has its own words", () => {
    expect(preferenceFitLabel("MATCHES")).toBe("مطابق ترجیح");
    expect(preferenceFitLabel("DIFFERS")).toBe("مغایر ترجیح");
    expect(preferenceFitLabel("PENDING")).toBe("هنوز بدون شیفت");
    // No preference is not a fit: the row says so instead.
    expect(preferenceFitLabel("NONE")).toBeNull();
    expect(NO_PREFERENCE_LABEL).toBe("ترجیحی ثبت نشده");
    // A wish is never worded as an error, a rule or an approval (D35).
    for (const fit of ["MATCHES", "DIFFERS", "PENDING"] as const)
      expect(preferenceFitLabel(fit)).not.toMatch(
        /خطا|نامعتبر|ایراد|غیرمجاز|تأیید|الزام/,
      );
  });
});

describe("filterEditorNurses: filters combine and never change assignments", () => {
  const nurses = [
    { userId: "a", displayName: "سارا احمدی", preference: "N" as const },
    { userId: "b", displayName: "مریم کریمی", preference: "OFF" as const },
    { userId: "c", displayName: "زهرا کاظمی", preference: null },
    { userId: "d", displayName: "سمیرا رضایی", preference: "M" as const },
    { userId: "e", displayName: "نرگس یزدی", preference: "E" as const },
  ];
  // a: M (conflict), b: E (conflict with OFF), c: N (no preference),
  // d: M (matches), e: no shift (wish pending).
  const shifts = new Map([
    ["a", "M"],
    ["b", "E"],
    ["c", "N"],
    ["d", "M"],
  ] as const);
  const shiftOf = (id: string) => shifts.get(id as "a") ?? null;
  const ids = (filters: Partial<EditorFilters>, kept?: Set<string>) =>
    filterEditorNurses(
      nurses,
      shiftOf,
      { ...NO_FILTERS, ...filters },
      kept,
    ).map((n) => n.userId);

  it("lists everyone without filters, in roster order", () => {
    expect(ids({})).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("«فقط مغایرت‌ها» lists only assignments that conflict with a recorded preference", () => {
    // Not the nurse without a preference, the match, or the pending wish.
    expect(ids({ conflictsOnly: true })).toEqual(["a", "b"]);
  });

  it("combines the conflict filter with a shift filter (AND)", () => {
    expect(ids({ conflictsOnly: true, shift: "M" })).toEqual(["a"]);
    expect(ids({ conflictsOnly: true, shift: "E" })).toEqual(["b"]);
    expect(ids({ conflictsOnly: true, shift: "N" })).toEqual([]);
    expect(ids({ conflictsOnly: true, shift: "UNASSIGNED" })).toEqual([]);
    expect(ids({ shift: "UNASSIGNED" })).toEqual(["e"]);
  });

  it("combines the conflict filter with the name search (Arabic ي/ك typed)", () => {
    expect(ids({ conflictsOnly: true, query: "مريم" })).toEqual(["b"]);
    expect(ids({ conflictsOnly: true, query: "  سارا " })).toEqual(["a"]);
    expect(ids({ conflictsOnly: true, query: "زهرا" })).toEqual([]);
    expect(ids({ conflictsOnly: true, shift: "M", query: "سمیرا" })).toEqual(
      [],
    );
  });

  it("keeps a just-edited row in view under the shift and conflict filters, not under search", () => {
    const kept = new Set(["d"]);
    expect(ids({ conflictsOnly: true }, kept)).toEqual(["a", "b", "d"]);
    expect(ids({ conflictsOnly: true, shift: "E" }, kept)).toEqual(["b", "d"]);
    expect(ids({ conflictsOnly: true, query: "سارا" }, kept)).toEqual(["a"]);
  });

  it("reads assignments without changing them", () => {
    const before = [...shifts];
    ids({ conflictsOnly: true, shift: "M", query: "س" });
    expect([...shifts]).toEqual(before);
  });

  it("knows when any filter is active", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: "   " })).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, query: "س" })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, shift: "N" })).toBe(true);
    expect(hasActiveFilters({ ...NO_FILTERS, conflictsOnly: true })).toBe(true);
  });
});

describe("emptyListMessage: an empty list says why", () => {
  const base = { rostered: 4, withPreference: 2, conflicts: 0 };
  it("an empty roster", () => {
    expect(
      emptyListMessage({ ...base, rostered: 0, filters: NO_FILTERS }),
    ).toBe("فهرست پرسنل این برنامه خالی است.");
  });

  it("no conflict exists on the day", () => {
    expect(
      emptyListMessage({
        ...base,
        filters: { ...NO_FILTERS, conflictsOnly: true },
      }),
    ).toBe("در این روز هیچ شیفتی مغایر ترجیحات ثبت‌شده نیست.");
  });

  it("no preference is recorded for the day: nothing to conflict with", () => {
    expect(
      emptyListMessage({
        ...base,
        withPreference: 0,
        filters: { ...NO_FILTERS, conflictsOnly: true },
      }),
    ).toBe("برای این روز هیچ ترجیحی ثبت نشده است؛ مغایرتی برای نمایش نیست.");
  });

  it("conflicts exist but the other filters hide them", () => {
    expect(
      emptyListMessage({
        ...base,
        conflicts: 2,
        filters: { ...NO_FILTERS, conflictsOnly: true, shift: "N" },
      }),
    ).toBe("هیچ پرستاری با این فیلتر یا جستجو پیدا نشد.");
    expect(
      emptyListMessage({ ...base, filters: { ...NO_FILTERS, query: "x" } }),
    ).toBe("هیچ پرستاری با این فیلتر یا جستجو پیدا نشد.");
  });
});
