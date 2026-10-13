import { faNumber } from "@/features/calendar/jalali";

/** What a Monthly Planning Reset deletes, as the preview counted it (D114). */
export interface MonthlyResetImpactCounts {
  /** Every working-copy decision, recorded leave included. */
  readonly assignments: number;
  /** Recorded leave days (H, D118): part of `assignments`. */
  readonly leaveDays: number;
  readonly changes: number;
  readonly changeCells: number;
}

/** The dialog's one-line description: everything in the layout goes, leave included. */
export const monthlyResetDescription = (leaveLabel: string) =>
  `همه شیفت‌ها، روزهای ${leaveLabel} ثبت‌شده و تغییرات چیدمان پاک می‌شوند. این کار قابل بازگردانی نیست.`;

/** "۳ شیفت، ۱ تغییر و ۲ سلول وابسته حذف می‌شود." Leave is counted apart. */
export const monthlyResetDeletedLine = (c: MonthlyResetImpactCounts) =>
  `${faNumber(c.assignments - c.leaveDays)} شیفت، ${faNumber(c.changes)} تغییر و ${faNumber(c.changeCells)} سلول وابسته حذف می‌شود.`;

/**
 * The explicit leave warning, always shown (D118): recorded leave is part
 * of the month's layout, so the reset deletes it too and nothing restores it.
 * The label is `shift_types.label` for H (D112).
 */
export function monthlyResetLeaveWarning(
  leaveDays: number,
  leaveLabel: string,
): string {
  return leaveDays > 0
    ? `${faNumber(leaveDays)} روز ${leaveLabel} ثبت‌شده (H) نیز حذف می‌شود و بازگردانده نمی‌شود؛ پس از بازنشانی باید دوباره ثبت شود.`
    : `روزهای ${leaveLabel} ثبت‌شده (H) نیز با چیدمان حذف می‌شوند؛ در این برنامه روز ${leaveLabel} ثبت نشده است.`;
}
