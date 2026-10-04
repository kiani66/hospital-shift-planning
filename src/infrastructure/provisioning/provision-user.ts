import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import type { MembershipRole } from "../../domain/authz/actor";
import { parseOptionalMobileNumber } from "../../domain/identity/mobile";
import { normalizeDisplayName } from "../../domain/identity/normalize";
import { parsePersonnelNumber } from "../../domain/identity/personnel-number";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../../domain/identity/password-policy";
import type { IsoDate } from "../../domain/shared/dates";
import { APP_TIMEZONE, todayIn } from "../auth/actor";
import { accountThrottleKey, normalizeEmail } from "../auth/credentials";
import { hashPassword } from "../auth/password";
import type { Database, DbExecutor } from "../db/database";
import { departmentMemberships, departments } from "../db/schema";
import { recordAuditEvent } from "../repositories/audit";
import { createDepartment } from "../repositories/departments";
import { clearFailedLogins } from "../repositories/login-throttles";
import { lockHospitalAdministration } from "../repositories/management";
import { activeOn, addMembership } from "../repositories/memberships";
import {
  createUser,
  findUserByEmail,
  findUserByPersonnelNumber,
  replacePassword,
  setPersonnelNumber,
  type UserRecord,
} from "../repositories/users";

/**
 * Production-safe operator provisioning (`pnpm db:provision-user`). Unlike the
 * demo seed it only inserts or updates the rows it names: it never resets,
 * truncates or deletes anything, so it is allowed in production.
 *
 * Three explicit modes (Decision 7). Re-running any of them can never silently
 * reset a password, reactivate a disabled account, overwrite identity data or
 * change memberships:
 * - `create` (default): creates one new account (personnel number required)
 *   with a temporary password and its membership. If the account already
 *   exists with exactly the given identity, it changes nothing (idempotent);
 *   any difference is an error. A membership is added to an existing account
 *   only with `PROVISION_ALLOW_NEW_MEMBERSHIP=yes`.
 * - `reset-password`: explicit administrative recovery, with a confirmation
 *   phrase. Sets a temporary password, ends every session, never reactivates.
 * - `assign-personnel-number`: the operator backfill for a legacy account
 *   found by e-mail that has no personnel number yet; never overwrites one.
 * Every write is audited (actor: the target account, `source: operatorCli`).
 */

export const PROVISIONABLE_ROLES = ["HEAD_NURSE", "NURSE"] as const;
export const PROVISION_MODES = [
  "create",
  "reset-password",
  "assign-personnel-number",
] as const;
export const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;
export const CONFIRM_RESET = "RESET_PASSWORD";
export const CONFIRM_ASSIGN = "ASSIGN_PERSONNEL_NUMBER";

const optional = (v: string | undefined) =>
  v === undefined || v.trim() === "" ? undefined : v;

const nonEmpty = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const emailField = z
  .string()
  .transform(normalizeEmail)
  .pipe(
    z
      .string()
      .max(320, "PROVISION_EMAIL is too long")
      .pipe(z.email("PROVISION_EMAIL must be a valid e-mail address")),
  );

const personnelNumberField = z.string().transform((value, ctx) => {
  const parsed = parsePersonnelNumber(value);
  if (parsed.ok) return parsed.value as string;
  ctx.addIssue({
    code: "custom",
    message: "PROVISION_PERSONNEL_NUMBER must be 1 to 20 digits",
  });
  return z.NEVER;
});

const mobileField = z.string().transform((value, ctx) => {
  const parsed = parseOptionalMobileNumber(value);
  if (parsed.ok) return (parsed.value as string | null) ?? undefined;
  ctx.addIssue({
    code: "custom",
    message: "PROVISION_MOBILE must be an Iranian mobile number",
  });
  return z.NEVER;
});

// Not trimmed: the login form does not trim passwords either.
const passwordField = z
  .string({ error: "PROVISION_PASSWORD is required" })
  .min(
    PASSWORD_MIN_LENGTH,
    `PROVISION_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `PROVISION_PASSWORD must be at most ${PASSWORD_MAX_LENGTH} characters`,
  );

const createSchema = z.object({
  mode: z.literal("create"),
  personnelNumber: personnelNumberField,
  email: emailField.optional(),
  mobile: mobileField.optional(),
  displayName: nonEmpty("PROVISION_DISPLAY_NAME")
    .max(200)
    .transform(normalizeDisplayName),
  /** Required only when the account is created; never applied to an existing one. */
  password: passwordField.optional(),
  departmentCode: nonEmpty("PROVISION_DEPARTMENT_CODE"),
  role: z.enum(PROVISIONABLE_ROLES, {
    error: `PROVISION_ROLE must be one of: ${PROVISIONABLE_ROLES.join(", ")}`,
  }),
  /** Only used when the department does not exist yet; never renames one. */
  departmentName: nonEmpty("PROVISION_DEPARTMENT_NAME").max(200).optional(),
  allowNewMembership: z.boolean(),
});

const resetSchema = z
  .object({
    mode: z.literal("reset-password"),
    personnelNumber: personnelNumberField.optional(),
    email: emailField.optional(),
    password: passwordField,
    confirm: z.literal(CONFIRM_RESET, {
      error: `PROVISION_CONFIRM must be ${CONFIRM_RESET} for reset-password`,
    }),
  })
  .refine((v) => v.personnelNumber !== undefined || v.email !== undefined, {
    message: "PROVISION_PERSONNEL_NUMBER or PROVISION_EMAIL is required",
  });

const assignSchema = z.object({
  mode: z.literal("assign-personnel-number"),
  email: emailField,
  personnelNumber: personnelNumberField,
  confirm: z.literal(CONFIRM_ASSIGN, {
    error: `PROVISION_CONFIRM must be ${CONFIRM_ASSIGN} for assign-personnel-number`,
  }),
});

export const provisionInputSchema = z.discriminatedUnion("mode", [
  createSchema,
  resetSchema,
  assignSchema,
]);

export type ProvisionInput = z.infer<typeof provisionInputSchema>;
export type CreateInput = z.infer<typeof createSchema>;

export class ProvisionError extends Error {
  override readonly name = "ProvisionError";
}

/** Reads and validates the `PROVISION_*` variables. Messages never echo values. */
export function parseProvisionEnv(
  env: Record<string, string | undefined>,
): ProvisionInput {
  const mode = optional(env.PROVISION_MODE) ?? "create";
  if (!(PROVISION_MODES as readonly string[]).includes(mode))
    throw new ProvisionError(
      `Invalid provisioning input:\n  - PROVISION_MODE must be one of: ${PROVISION_MODES.join(", ")}`,
    );
  const result = provisionInputSchema.safeParse({
    mode,
    personnelNumber: optional(env.PROVISION_PERSONNEL_NUMBER),
    email: optional(env.PROVISION_EMAIL),
    mobile: optional(env.PROVISION_MOBILE),
    displayName: optional(env.PROVISION_DISPLAY_NAME),
    password: optional(env.PROVISION_PASSWORD),
    departmentCode: env.PROVISION_DEPARTMENT_CODE,
    role: env.PROVISION_ROLE,
    departmentName: optional(env.PROVISION_DEPARTMENT_NAME),
    allowNewMembership: env.PROVISION_ALLOW_NEW_MEMBERSHIP === "yes",
    confirm: optional(env.PROVISION_CONFIRM),
  });
  if (result.success) return result.data;
  throw new ProvisionError(
    `Invalid provisioning input:\n${result.error.issues
      .map((i) =>
        i.path[0] === "personnelNumber" && i.code === "invalid_type"
          ? "  - PROVISION_PERSONNEL_NUMBER is required"
          : `  - ${i.message}`,
      )
      .join("\n")}`,
  );
}

export type ProvisionResult =
  | {
      readonly mode: "create";
      readonly personnelNumber: string;
      readonly departmentCode: string;
      readonly departmentStatus: "created" | "existing";
      readonly role: MembershipRole;
      readonly user: "created" | "unchanged";
      readonly membership: "created" | "unchanged";
      /** For an existing account a supplied password is never applied. */
      readonly password: "set (temporary)" | "unchanged";
    }
  | { readonly mode: "reset-password"; readonly userId: string }
  | {
      readonly mode: "assign-personnel-number";
      readonly personnelNumber: string;
      readonly result: "assigned" | "unchanged";
    };

/**
 * Exact code first, then a case-insensitive match if it is unambiguous.
 * Null when there is none; throws for an ambiguous code.
 */
async function findDepartment(db: DbExecutor, code: string) {
  const rows = await db
    .select({
      id: departments.id,
      code: departments.code,
      isActive: departments.isActive,
    })
    .from(departments)
    .where(sql`lower(${departments.code}) = lower(${code})`);
  const exact = rows.find((r) => r.code === code);
  if (exact) return exact;
  if (rows.length > 1)
    throw new ProvisionError(
      `Department code "${code}" is ambiguous; use the exact code`,
    );
  return rows[0] ?? null;
}

/**
 * The department to grant membership in. An existing one is used as is (never
 * renamed or reactivated); a missing one is created only when a name was given
 * explicitly, with the code exactly as supplied.
 */
async function resolveDepartment(db: DbExecutor, input: CreateInput) {
  // Serializes concurrent runs for the same code (case-insensitively, which the
  // unique index on `code` does not cover) until this transaction ends, so a
  // racing run finds the committed department instead of inserting a second one.
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtext(${"provision-department:" + input.departmentCode.toLowerCase()}))`,
  );

  const existing = await findDepartment(db, input.departmentCode);
  if (existing) {
    if (!existing.isActive)
      throw new ProvisionError(`Department "${existing.code}" is inactive`);
    return { ...existing, status: "existing" as const };
  }

  if (!input.departmentName)
    throw new ProvisionError(
      `Department "${input.departmentCode}" does not exist. To create it as part of ` +
        `the first bootstrap, also set PROVISION_DEPARTMENT_NAME.`,
    );
  const created = await createDepartment(db, {
    code: input.departmentCode,
    name: input.departmentName,
  });
  return { ...created, status: "created" as const };
}

async function ensureMembership(
  db: DbExecutor,
  input: { userId: string; departmentId: string; role: MembershipRole },
  today: IsoDate,
  allowCreate: boolean,
): Promise<"created" | "unchanged"> {
  const where = and(
    eq(departmentMemberships.userId, input.userId),
    eq(departmentMemberships.departmentId, input.departmentId),
  );
  const [current] = await db
    .select({ role: departmentMemberships.role })
    .from(departmentMemberships)
    .where(and(where, activeOn(departmentMemberships, today)));
  if (current) {
    if (current.role === input.role) return "unchanged";
    throw new ProvisionError(
      `The user already has a current ${current.role} membership in this department; ` +
        `this command does not change roles. Use the Hospital Admin personnel screens.`,
    );
  }

  const [upcoming] = await db
    .select({ startedOn: departmentMemberships.startedOn })
    .from(departmentMemberships)
    .where(and(where, gt(departmentMemberships.startedOn, today)));
  if (upcoming)
    throw new ProvisionError(
      `The user has a membership in this department starting ${upcoming.startedOn}; ` +
        `it would overlap a new one. Resolve it deliberately first.`,
    );
  if (!allowCreate)
    throw new ProvisionError(
      "The account exists but has no current membership in this department. " +
        "Adding one to an existing account must be explicit: set " +
        "PROVISION_ALLOW_NEW_MEMBERSHIP=yes, or use the Hospital Admin personnel screens.",
    );

  await addMembership(db, { ...input, startedOn: today });
  return "created";
}

/** Both identifiers must point at the same account (or none). */
async function resolveAccount(
  db: DbExecutor,
  ids: { personnelNumber?: string; email?: string },
): Promise<UserRecord | null> {
  const byNumber = ids.personnelNumber
    ? await findUserByPersonnelNumber(db, ids.personnelNumber)
    : null;
  const byEmail = ids.email ? await findUserByEmail(db, ids.email) : null;
  if (byNumber && byEmail && byNumber.id !== byEmail.id)
    throw new ProvisionError(
      "The personnel number and the e-mail belong to two different accounts; nothing was changed.",
    );
  return byNumber ?? byEmail;
}

/** Never overwrites: every supplied identity value must equal what is stored. */
function assertSameIdentity(user: UserRecord, input: CreateInput): void {
  const mismatches: string[] = [];
  if (user.personnelNumber === null)
    throw new ProvisionError(
      "An account with this e-mail exists but has no personnel number. Assign the " +
        "genuine number first (PROVISION_MODE=assign-personnel-number or the " +
        "Hospital Admin screens); nothing was changed.",
    );
  if (user.personnelNumber !== input.personnelNumber)
    mismatches.push("personnel number");
  if (input.email !== undefined && user.email !== input.email)
    mismatches.push("e-mail");
  if (input.mobile !== undefined && user.mobile !== input.mobile)
    mismatches.push("mobile");
  if (user.displayName !== input.displayName) mismatches.push("display name");
  if (mismatches.length > 0)
    throw new ProvisionError(
      `The account already exists with a different ${mismatches.join(", ")}. ` +
        "This command never overwrites identity data; nothing was changed.",
    );
  if (!user.isActive)
    throw new ProvisionError(
      "The account exists but is deactivated. This command never reactivates " +
        "accounts; use the Hospital Admin screens. Nothing was changed.",
    );
}

async function provisionCreate(
  db: Database,
  input: CreateInput,
  now: Date,
): Promise<ProvisionResult> {
  // Hashed before the transaction: it is slow and needs no database.
  const passwordHash = input.password
    ? await hashPassword(input.password)
    : null;
  const today = todayIn(APP_TIMEZONE, now);

  return db.transaction(async (tx) => {
    await lockHospitalAdministration(tx);
    const department = await resolveDepartment(tx, input);
    const existing = await resolveAccount(tx, input);

    let user: UserRecord;
    if (existing) {
      assertSameIdentity(existing, input);
      user = existing;
    } else {
      if (!passwordHash)
        throw new ProvisionError(
          "PROVISION_PASSWORD is required to create an account",
        );
      user = await createUser(tx, {
        personnelNumber: input.personnelNumber,
        email: input.email ?? null,
        mobile: input.mobile ?? null,
        displayName: input.displayName,
        passwordHash,
        mustChangePassword: true,
        isActive: true,
      });
      await recordAuditEvent(tx, {
        actorId: user.id,
        action: "user.created",
        entityType: "user",
        entityId: user.id,
        data: {
          personnelNumber: user.personnelNumber,
          email: user.email,
          mobile: user.mobile,
          displayName: user.displayName,
          isActive: true,
          credentials: "temporary",
          source: "operatorCli",
        },
      });
    }

    const membership = await ensureMembership(
      tx,
      { userId: user.id, departmentId: department.id, role: input.role },
      today,
      !existing || input.allowNewMembership,
    );
    if (membership === "created")
      await recordAuditEvent(tx, {
        actorId: user.id,
        action: "membership.added",
        entityType: "membership",
        entityId: user.id,
        departmentId: department.id,
        data: {
          after: { userId: user.id, role: input.role, startedOn: today },
          source: "operatorCli",
        },
      });

    return {
      mode: "create",
      personnelNumber: input.personnelNumber,
      departmentCode: department.code,
      departmentStatus: department.status,
      role: input.role,
      user: existing ? "unchanged" : "created",
      membership,
      password: existing ? "unchanged" : "set (temporary)",
    };
  });
}

async function provisionReset(
  db: Database,
  input: Extract<ProvisionInput, { mode: "reset-password" }>,
  now: Date,
): Promise<ProvisionResult> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await lockHospitalAdministration(tx);
    const user = await resolveAccount(tx, input);
    if (!user)
      throw new ProvisionError("No matching account; nothing was changed.");
    if (!user.isActive)
      throw new ProvisionError(
        "The account is deactivated; reset-password never reactivates. Nothing was changed.",
      );
    await replacePassword(tx, user.id, {
      passwordHash,
      mustChangePassword: true,
      now,
    });
    await clearFailedLogins(tx, accountThrottleKey(user.id));
    await recordAuditEvent(tx, {
      actorId: user.id,
      action: "user.temporaryCredentialIssued",
      entityType: "user",
      entityId: user.id,
      data: { source: "operatorCli", changeRequiredAtSignIn: true },
    });
    return { mode: "reset-password", userId: user.id };
  });
}

async function provisionAssign(
  db: Database,
  input: Extract<ProvisionInput, { mode: "assign-personnel-number" }>,
  now: Date,
): Promise<ProvisionResult> {
  return db.transaction(async (tx) => {
    await lockHospitalAdministration(tx);
    const user = await findUserByEmail(tx, input.email);
    if (!user)
      throw new ProvisionError(
        "No account with this e-mail; nothing was changed.",
      );
    if (user.personnelNumber === input.personnelNumber)
      return {
        mode: "assign-personnel-number",
        personnelNumber: input.personnelNumber,
        result: "unchanged",
      };
    if (user.personnelNumber !== null)
      throw new ProvisionError(
        "The account already has a different personnel number. Corrections are made " +
          "by a Hospital Admin in the personnel screens (audited); nothing was changed.",
      );
    if (await findUserByPersonnelNumber(tx, input.personnelNumber))
      throw new ProvisionError(
        "This personnel number already belongs to another account; nothing was changed.",
      );
    await setPersonnelNumber(tx, user.id, input.personnelNumber, now);
    await recordAuditEvent(tx, {
      actorId: user.id,
      action: "user.personnelNumberAssigned",
      entityType: "user",
      entityId: user.id,
      data: {
        before: null,
        after: input.personnelNumber,
        source: "operatorCli",
      },
    });
    return {
      mode: "assign-personnel-number",
      personnelNumber: input.personnelNumber,
      result: "assigned",
    };
  });
}

export async function provisionUser(
  db: Database,
  input: ProvisionInput,
  now: Date = new Date(),
): Promise<ProvisionResult> {
  switch (input.mode) {
    case "create":
      return provisionCreate(db, input, now);
    case "reset-password":
      return provisionReset(db, input, now);
    case "assign-personnel-number":
      return provisionAssign(db, input, now);
  }
}
