import type { MembershipRole } from "../authz/actor";
import type { IsoDate } from "../shared/dates";

/**
 * Bulk personnel import planning (Decision 6). Pure: the application layer
 * parses and normalizes the CSV and loads the existing accounts; this decides,
 * per row, what a confirmed import would do. Matching is by normalized
 * personnel number only, never by name, mobile or e-mail. Nothing is ever
 * overwritten: any difference with stored identity, role or membership dates
 * is an error for the admin to resolve.
 */

export const IMPORT_FIELDS = [
  "personnelNumber",
  "displayName",
  "email",
  "mobile",
  "role",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportRowError =
  | "PERSONNEL_NUMBER_REQUIRED"
  | "PERSONNEL_NUMBER_INVALID"
  | "DISPLAY_NAME_REQUIRED"
  | "DISPLAY_NAME_TOO_LONG"
  | "EMAIL_INVALID"
  | "MOBILE_INVALID"
  | "ROLE_INVALID"
  | "EXTRA_CELLS"
  | "DUPLICATE_PERSONNEL_NUMBER_IN_FILE"
  | "DUPLICATE_EMAIL_IN_FILE"
  | "EMAIL_TAKEN"
  | "IDENTITY_CONFLICT"
  | "ACCOUNT_INACTIVE"
  | "ROLE_CONFLICT"
  | "MEMBERSHIP_DATES_CONFLICT";

export interface ImportPerson {
  readonly personnelNumber: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly mobile: string | null;
  readonly role: MembershipRole;
}

/** One data row after normalization; `person` is null when a field is invalid. */
export interface CandidateRow {
  readonly line: number;
  readonly person: ImportPerson | null;
  readonly errors: readonly ImportRowError[];
}

export interface ExistingMembership {
  readonly role: MembershipRole;
  readonly startedOn: IsoDate;
  readonly endedOn: IsoDate | null;
}

export interface ExistingAccount {
  readonly id: string;
  readonly personnelNumber: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly mobile: string | null;
  readonly isActive: boolean;
  /** Memberships in the destination department only. */
  readonly memberships: readonly ExistingMembership[];
}

export interface ImportContext {
  /** First day of the new memberships (inclusive, open-ended). */
  readonly startedOn: IsoDate;
  readonly accountsByPersonnelNumber: ReadonlyMap<string, ExistingAccount>;
  /** Lower-cased e-mail → id of the account that holds it. */
  readonly emailOwners: ReadonlyMap<string, string>;
}

export type ImportAction = "CREATE" | "ADD_MEMBERSHIP" | "UNCHANGED" | "ERROR";

export interface PlannedRow {
  readonly line: number;
  readonly person: ImportPerson | null;
  readonly action: ImportAction;
  readonly errors: readonly ImportRowError[];
  /** Stored identity fields that differ from the row (IDENTITY_CONFLICT). */
  readonly conflicts: readonly ImportField[];
  /** The matched account, if any. */
  readonly userId: string | null;
}

export interface ImportPlan {
  readonly rows: readonly PlannedRow[];
  readonly counts: Readonly<Record<ImportAction, number>>;
  /** No row has an error (the import is all-or-nothing). */
  readonly committable: boolean;
  /** At least one row would write; a committable plan without changes is a no-op. */
  readonly hasChanges: boolean;
}

function countBy<T>(items: readonly T[], key: (item: T) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/** Same valid membership: same role, open-ended, already in effect by the start day. */
function membershipOutcome(
  memberships: readonly ExistingMembership[],
  role: MembershipRole,
  startedOn: IsoDate,
): "ADD_MEMBERSHIP" | "UNCHANGED" | ImportRowError {
  const overlapping = memberships.filter(
    (m) => m.endedOn === null || m.endedOn >= startedOn,
  );
  if (overlapping.length === 0) return "ADD_MEMBERSHIP";
  if (overlapping.some((m) => m.role !== role)) return "ROLE_CONFLICT";
  const [only] = overlapping;
  return overlapping.length === 1 &&
    only!.endedOn === null &&
    only!.startedOn <= startedOn
    ? "UNCHANGED"
    : "MEMBERSHIP_DATES_CONFLICT";
}

function identityConflicts(
  account: ExistingAccount,
  person: ImportPerson,
): ImportField[] {
  const conflicts: ImportField[] = [];
  if (account.displayName !== person.displayName) conflicts.push("displayName");
  // An empty cell claims nothing; a filled one must equal what is stored.
  if (person.email !== null && account.email !== person.email)
    conflicts.push("email");
  if (person.mobile !== null && account.mobile !== person.mobile)
    conflicts.push("mobile");
  return conflicts;
}

export function planPersonnelImport(
  candidates: readonly CandidateRow[],
  context: ImportContext,
): ImportPlan {
  const numberCounts = countBy(
    candidates,
    (c) => c.person?.personnelNumber ?? null,
  );
  const emailCounts = countBy(candidates, (c) => c.person?.email ?? null);

  const rows = candidates.map((candidate): PlannedRow => {
    const errors = [...candidate.errors];
    const { person } = candidate;
    let action: ImportAction = "ERROR";
    let conflicts: ImportField[] = [];
    let userId: string | null = null;

    if (person) {
      if (numberCounts.get(person.personnelNumber)! > 1)
        errors.push("DUPLICATE_PERSONNEL_NUMBER_IN_FILE");
      if (person.email !== null && emailCounts.get(person.email)! > 1)
        errors.push("DUPLICATE_EMAIL_IN_FILE");

      const account = context.accountsByPersonnelNumber.get(
        person.personnelNumber,
      );
      const emailOwner =
        person.email === null
          ? undefined
          : context.emailOwners.get(person.email);
      if (account) {
        userId = account.id;
        conflicts = identityConflicts(account, person);
        if (conflicts.length > 0) errors.push("IDENTITY_CONFLICT");
        if (!account.isActive) errors.push("ACCOUNT_INACTIVE");
        const outcome = membershipOutcome(
          account.memberships,
          person.role,
          context.startedOn,
        );
        if (outcome === "ADD_MEMBERSHIP" || outcome === "UNCHANGED")
          action = outcome;
        else errors.push(outcome);
      } else {
        if (emailOwner !== undefined) errors.push("EMAIL_TAKEN");
        action = "CREATE";
      }
    }

    return errors.length > 0
      ? {
          line: candidate.line,
          person,
          action: "ERROR",
          errors,
          conflicts,
          userId,
        }
      : { line: candidate.line, person, action, errors, conflicts, userId };
  });

  const counts: Record<ImportAction, number> = {
    CREATE: 0,
    ADD_MEMBERSHIP: 0,
    UNCHANGED: 0,
    ERROR: 0,
  };
  for (const row of rows) counts[row.action]++;
  return {
    rows,
    counts,
    committable: rows.length > 0 && counts.ERROR === 0,
    hasChanges: counts.CREATE + counts.ADD_MEMBERSHIP > 0,
  };
}
