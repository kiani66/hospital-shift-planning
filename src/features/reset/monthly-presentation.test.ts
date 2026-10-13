import { describe, expect, it } from "vitest";

import {
  monthlyResetDeletedLine,
  monthlyResetDescription,
  monthlyResetLeaveWarning,
} from "./monthly-presentation";

describe("Monthly Reset confirmation wording (D114, D118)", () => {
  it("says up front that recorded leave days are cleared too", () => {
    expect(monthlyResetDescription("مرخصی")).toBe(
      "همه شیفت‌ها، روزهای مرخصی ثبت‌شده و تغییرات چیدمان پاک می‌شوند. این کار قابل بازگردانی نیست.",
    );
  });

  it("counts leave apart from the other decisions", () => {
    expect(
      monthlyResetDeletedLine({
        assignments: 5,
        leaveDays: 2,
        changes: 1,
        changeCells: 2,
      }),
    ).toBe("۳ شیفت، ۱ تغییر و ۲ سلول وابسته حذف می‌شود.");
  });

  it("warns explicitly that recorded H leave days are deleted and not restored", () => {
    expect(monthlyResetLeaveWarning(2, "مرخصی")).toBe(
      "۲ روز مرخصی ثبت‌شده (H) نیز حذف می‌شود و بازگردانده نمی‌شود؛ پس از بازنشانی باید دوباره ثبت شود.",
    );
  });

  it("states the rule even when no leave is recorded", () => {
    expect(monthlyResetLeaveWarning(0, "مرخصی")).toBe(
      "روزهای مرخصی ثبت‌شده (H) نیز با چیدمان حذف می‌شوند؛ در این برنامه روز مرخصی ثبت نشده است.",
    );
  });

  it("takes the leave name from the stored label (D112), never a fixed word", () => {
    expect(monthlyResetLeaveWarning(1, "غیبت مجاز")).toContain(
      "۱ روز غیبت مجاز ثبت‌شده (H)",
    );
    expect(monthlyResetDescription("غیبت مجاز")).toContain(
      "روزهای غیبت مجاز ثبت‌شده",
    );
  });
});
