import "server-only";

import { cache } from "react";

import { readShiftLabels } from "@/application/shifts/labels";

export type { ShiftLabels } from "@/application/shifts/labels";

/**
 * The shift labels for this request, read once however many server
 * components ask. Pages pass them down as props to whatever shows a
 * descriptive shift name; no component queries `shift_types` itself.
 */
export const loadShiftLabels = cache(readShiftLabels);
