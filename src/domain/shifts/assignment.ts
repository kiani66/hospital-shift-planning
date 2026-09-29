import type { IsoDate } from "../shared/dates";
import type { ShiftCode } from "./shift-type";

/** One nurse working one shift on one day. No row means the nurse is off. */
export interface Assignment {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly shift: ShiftCode;
}
