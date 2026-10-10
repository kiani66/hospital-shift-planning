import "server-only";

import { cache } from "react";

import {
  readShiftLabels,
  ShiftReferenceDataError,
} from "@/application/shifts/labels";

export type { ShiftLabels } from "@/application/shifts/labels";

/**
 * The shift labels for this request, read once however many server
 * components ask. Pages pass them down as props to whatever shows a
 * descriptive shift name; no component queries `shift_types` itself.
 */
export const loadShiftLabels = cache(readShiftLabels);

/** Pilot resets may explicitly remove reference data. Never invent replacement labels. */
export const loadOptionalShiftLabels = cache(async () => {
  try {
    return await loadShiftLabels();
  } catch (error) {
    if (error instanceof ShiftReferenceDataError) return null;
    throw error;
  }
});
