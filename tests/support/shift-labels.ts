import type { ShiftLabels } from "../../src/application/shifts/labels";

/**
 * The `shift_types` labels as the migrations store them. Unit tests pass
 * these (or a variant) where pages pass `loadShiftLabels()`.
 */
export const SHIFT_LABELS: ShiftLabels = {
  M: "صبح",
  E: "عصر",
  N: "شب",
  ME: "طولانی",
  OFF: "استراحت",
};

/** Different labels, to prove a screen reads names from the data, not from code. */
export const RENAMED_SHIFT_LABELS: ShiftLabels = {
  M: "بامداد",
  E: "پسین",
  N: "شبانه",
  ME: "لانگ",
  OFF: "مرخصی‌روز",
};
