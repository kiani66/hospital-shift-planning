import { describe, expect, it } from "vitest";

import { isoDate } from "../shared/dates";
import {
  planPersonnelImport,
  type CandidateRow,
  type ExistingAccount,
  type ImportContext,
  type ImportPerson,
} from "./personnel-import";

const START = isoDate("2026-10-10");

const person = (over: Partial<ImportPerson> = {}): ImportPerson => ({
  personnelNumber: "00125",
  displayName: "سارا احمدی",
  email: null,
  mobile: null,
  role: "NURSE",
  ...over,
});
const row = (line: number, over: Partial<ImportPerson> = {}): CandidateRow => ({
  line,
  person: person(over),
  errors: [],
});
const account = (over: Partial<ExistingAccount> = {}): ExistingAccount => ({
  id: "user-1",
  personnelNumber: "00125",
  displayName: "سارا احمدی",
  email: null,
  mobile: null,
  isActive: true,
  memberships: [],
  ...over,
});
const context = (
  accounts: ExistingAccount[] = [],
  emails: [string, string][] = [],
): ImportContext => ({
  startedOn: START,
  accountsByPersonnelNumber: new Map(
    accounts.map((a) => [a.personnelNumber, a]),
  ),
  emailOwners: new Map(emails),
});

describe("planPersonnelImport", () => {
  it("creates unknown personnel and counts actions", () => {
    const plan = planPersonnelImport(
      [row(2), row(3, { personnelNumber: "720", email: "a@x.invalid" })],
      context(),
    );
    expect(plan.rows.map((r) => [r.line, r.action, r.userId])).toEqual([
      [2, "CREATE", null],
      [3, "CREATE", null],
    ]);
    expect(plan.counts).toEqual({
      CREATE: 2,
      ADD_MEMBERSHIP: 0,
      UNCHANGED: 0,
      ERROR: 0,
    });
    expect(plan).toMatchObject({ committable: true, hasChanges: true });
  });

  it("adds a membership to a matched account outside the department", () => {
    const plan = planPersonnelImport(
      [row(2)],
      context([
        account({
          memberships: [
            {
              role: "NURSE",
              startedOn: isoDate("2025-01-01"),
              endedOn: isoDate("2026-01-01"),
            },
          ],
        }),
      ]),
    );
    expect(plan.rows[0]).toMatchObject({
      action: "ADD_MEMBERSHIP",
      userId: "user-1",
      errors: [],
    });
  });

  it("changes nothing when the same open membership is already in effect (idempotent retry)", () => {
    const plan = planPersonnelImport(
      [row(2, { email: "s@x.invalid", mobile: "09121234567" })],
      context([
        account({
          email: "s@x.invalid",
          mobile: "09121234567",
          memberships: [
            { role: "NURSE", startedOn: isoDate("2026-10-01"), endedOn: null },
          ],
        }),
      ]),
    );
    expect(plan.rows[0]!.action).toBe("UNCHANGED");
    expect(plan).toMatchObject({ committable: true, hasChanges: false });
  });

  it("treats empty optional cells as no claim on stored values", () => {
    const plan = planPersonnelImport(
      [row(2)],
      context([account({ email: "s@x.invalid", mobile: "09121234567" })]),
    );
    expect(plan.rows[0]!.action).toBe("ADD_MEMBERSHIP");
  });

  it.each([
    ["display name", { displayName: "نام دیگر" }, ["displayName"]],
    ["e-mail", { email: "other@x.invalid" }, ["email"]],
    ["mobile", { mobile: "09351234567" }, ["mobile"]],
  ] as const)(
    "reports a different %s as an identity conflict, never overwrites",
    (_n, over, fields) => {
      const plan = planPersonnelImport([row(2, over)], context([account()]));
      expect(plan.rows[0]).toMatchObject({
        action: "ERROR",
        errors: ["IDENTITY_CONFLICT"],
        conflicts: fields,
        userId: "user-1",
      });
      expect(plan.committable).toBe(false);
    },
  );

  it("never reactivates: an inactive match is an error", () => {
    const plan = planPersonnelImport(
      [row(2)],
      context([account({ isActive: false })]),
    );
    expect(plan.rows[0]!.errors).toEqual(["ACCOUNT_INACTIVE"]);
  });

  it.each([
    [
      "another role",
      [{ role: "HEAD_NURSE", startedOn: isoDate("2026-01-01"), endedOn: null }],
      "ROLE_CONFLICT",
    ],
    [
      "a later start",
      [{ role: "NURSE", startedOn: isoDate("2026-11-01"), endedOn: null }],
      "MEMBERSHIP_DATES_CONFLICT",
    ],
    [
      "a fixed term",
      [
        {
          role: "NURSE",
          startedOn: isoDate("2026-01-01"),
          endedOn: isoDate("2026-12-31"),
        },
      ],
      "MEMBERSHIP_DATES_CONFLICT",
    ],
    [
      "two overlapping rows",
      [
        {
          role: "NURSE",
          startedOn: isoDate("2026-01-01"),
          endedOn: isoDate("2026-10-31"),
        },
        { role: "NURSE", startedOn: isoDate("2026-11-01"), endedOn: null },
      ],
      "MEMBERSHIP_DATES_CONFLICT",
    ],
  ] as const)(
    "reports a membership with %s as a conflict",
    (_n, memberships, error) => {
      const plan = planPersonnelImport(
        [row(2)],
        context([account({ memberships })]),
      );
      expect(plan.rows[0]!.errors).toEqual([error]);
    },
  );

  it("flags duplicate personnel numbers and e-mails within the file on every copy", () => {
    const plan = planPersonnelImport(
      [
        row(2, { email: "a@x.invalid" }),
        row(3, { email: "a@x.invalid" }),
        row(4, { personnelNumber: "9", email: "a@x.invalid" }),
      ],
      context(),
    );
    expect(plan.rows.map((r) => r.errors)).toEqual([
      ["DUPLICATE_PERSONNEL_NUMBER_IN_FILE", "DUPLICATE_EMAIL_IN_FILE"],
      ["DUPLICATE_PERSONNEL_NUMBER_IN_FILE", "DUPLICATE_EMAIL_IN_FILE"],
      ["DUPLICATE_EMAIL_IN_FILE"],
    ]);
  });

  it("refuses to create an account whose e-mail belongs to someone else", () => {
    const plan = planPersonnelImport(
      [row(2, { email: "taken@x.invalid" })],
      context([], [["taken@x.invalid", "someone"]]),
    );
    expect(plan.rows[0]).toMatchObject({
      action: "ERROR",
      errors: ["EMAIL_TAKEN"],
    });
  });

  it("never matches by e-mail alone: same e-mail, different number is a conflict", () => {
    const plan = planPersonnelImport(
      [row(2, { personnelNumber: "777", email: "s@x.invalid" })],
      context([account({ email: "s@x.invalid" })], [["s@x.invalid", "user-1"]]),
    );
    expect(plan.rows[0]).toMatchObject({
      errors: ["EMAIL_TAKEN"],
      userId: null,
    });
  });

  it("keeps validation errors from normalization and an empty file is not committable", () => {
    const plan = planPersonnelImport(
      [{ line: 5, person: null, errors: ["PERSONNEL_NUMBER_INVALID"] }],
      context(),
    );
    expect(plan.rows[0]).toEqual({
      line: 5,
      person: null,
      action: "ERROR",
      errors: ["PERSONNEL_NUMBER_INVALID"],
      conflicts: [],
      userId: null,
    });
    expect(planPersonnelImport([], context())).toMatchObject({
      committable: false,
      hasChanges: false,
    });
  });
});
