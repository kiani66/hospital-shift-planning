import type { IsoDate } from "../shared/dates";
import type { AssignmentCode } from "./shift-type";

/** One explicit nurse-day decision (working or OFF). No row means UNDECIDED. */
export interface Assignment {
  readonly nurseId: string;
  readonly date: IsoDate;
  readonly shift: AssignmentCode;
}
