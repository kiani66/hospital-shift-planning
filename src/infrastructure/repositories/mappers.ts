import type { IsoDate } from "../../domain/shared/dates";
import {
  isWorkingShift,
  isAssignmentCode,
  type ShiftCode,
  type AssignmentCode,
} from "../../domain/shifts/shift-type";

// `date` columns are read in string mode, so values are already `YYYY-MM-DD`.
export const asIsoDate = (value: string): IsoDate => value as IsoDate;

// shift_code columns reference shift_types, which mirrors the domain's codes.
export function asShiftCode(value: string): ShiftCode {
  if (!isWorkingShift(value))
    throw new RangeError(`Unknown working shift code: ${value}`);
  return value;
}
export function asAssignmentCode(value: string): AssignmentCode {
  if (!isAssignmentCode(value))
    throw new RangeError(`Unknown assignment code: ${value}`);
  return value;
}
