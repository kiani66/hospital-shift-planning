import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import type { MembershipRole } from "../../domain/authz/actor";
import type { IsoDate } from "../../domain/shared/dates";
import { APP_TIMEZONE, todayIn } from "../auth/actor";
import { normalizeEmail } from "../auth/credentials";
import { hashPassword } from "../auth/password";
import type { Database, DbExecutor } from "../db/database";
import { departmentMemberships, departments } from "../db/schema";
import { createDepartment } from "../repositories/departments";
import { activeOn, addMembership } from "../repositories/memberships";
import {
  createUser,
  findUserByEmail,
  setUserCredentials,
} from "../repositories/users";

/**
 * Production-safe provisioning of one real user (`pnpm db:provision-user`).
 * Unlike the demo seed it only inserts or updates the rows it names: it never
 * resets, truncates or deletes anything, so it is allowed in production.
 */

/** Roles this command can grant. Both are ordinary department membership roles. */
export const PROVISIONABLE_ROLES = ["HEAD_NURSE", "NURSE"] as const;

export const MIN_PASSWORD_LENGTH = 12;

const nonEmpty = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

export const provisionInputSchema = z.object({
  // Same normalization as sign-in; the caps match the login form's.
  email: z
    .string({ error: "PROVISION_EMAIL is required" })
    .transform(normalizeEmail)
    .pipe(
      z
        .string()
        .max(320, "PROVISION_EMAIL is too long")
        .pipe(z.email("PROVISION_EMAIL must be a valid e-mail address")),
    ),
  // Not trimmed: the login form does not trim passwords either.
  password: z
    .string({ error: "PROVISION_PASSWORD is required" })
    .min(
      MIN_PASSWORD_LENGTH,
      `PROVISION_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`,
    )
    .max(256, "PROVISION_PASSWORD must be at most 256 characters"),
  departmentCode: nonEmpty("PROVISION_DEPARTMENT_CODE"),
  role: z.enum(PROVISIONABLE_ROLES, {
    error: `PROVISION_ROLE must be one of: ${PROVISIONABLE_ROLES.join(", ")}`,
  }),
  /** Only used when the user is created; defaults to the e-mail's local part. */
  displayName: nonEmpty("PROVISION_DISPLAY_NAME").max(200).optional(),
  /** Only used when the department does not exist yet; never renames one. */
  departmentName: nonEmpty("PROVISION_DEPARTMENT_NAME").max(200).optional(),
});

export type ProvisionInput = z.infer<typeof provisionInputSchema>;

export class ProvisionError extends Error {
  override readonly name = "ProvisionError";
}

/** Reads and validates the `PROVISION_*` variables. Messages never echo values. */
export function parseProvisionEnv(
  env: Record<string, string | undefined>,
): ProvisionInput {
  const blankToUndefined = (v: string | undefined) =>
    v === undefined || v.trim() === "" ? undefined : v;
  const result = provisionInputSchema.safeParse({
    email: env.PROVISION_EMAIL,
    password: env.PROVISION_PASSWORD,
    departmentCode: env.PROVISION_DEPARTMENT_CODE,
    role: env.PROVISION_ROLE,
    displayName: blankToUndefined(env.PROVISION_DISPLAY_NAME),
    departmentName: blankToUndefined(env.PROVISION_DEPARTMENT_NAME),
  });
  if (result.success) return result.data;
  throw new ProvisionError(
    `Invalid provisioning input:\n${result.error.issues
      .map((i) => `  - ${i.message}`)
      .join("\n")}`,
  );
}

export interface ProvisionResult {
  readonly email: string;
  readonly departmentCode: string;
  readonly departmentStatus: "created" | "existing";
  readonly role: MembershipRole;
  readonly isActive: true;
  readonly userCreated: boolean;
  readonly membership: "created" | "unchanged";
}

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
async function resolveDepartment(db: DbExecutor, input: ProvisionInput) {
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
        `this command does not change roles. End that membership deliberately first.`,
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

  await addMembership(db, { ...input, startedOn: today });
  return "created";
}

/**
 * Ensures the department (creating it only when a name was given), creates or
 * updates the user and ensures the membership, all in one transaction (any failure leaves nothing behind).
 *
 * Idempotent apart from the password: a repeat run reuses the user, keeps the
 * existing membership and only refreshes the password hash (a new salt every
 * time) and `is_active = true`.
 */
export async function provisionUser(
  db: Database,
  input: ProvisionInput,
  now: Date = new Date(),
): Promise<ProvisionResult> {
  // Hashed before the transaction: it is slow and needs no database.
  const passwordHash = await hashPassword(input.password);
  const today = todayIn(APP_TIMEZONE, now);

  return db.transaction(async (tx) => {
    const department = await resolveDepartment(tx, input);

    const existing = await findUserByEmail(tx, input.email);
    let userId: string;
    if (existing) {
      userId = existing.id;
      await setUserCredentials(tx, userId, { passwordHash, isActive: true });
    } else {
      const created = await createUser(tx, {
        email: input.email,
        displayName: input.displayName ?? input.email.split("@")[0]!,
        passwordHash,
        isActive: true,
      });
      userId = created.id;
    }

    const membership = await ensureMembership(
      tx,
      { userId, departmentId: department.id, role: input.role },
      today,
    );

    return {
      email: input.email,
      departmentCode: department.code,
      departmentStatus: department.status,
      role: input.role,
      isActive: true,
      userCreated: !existing,
      membership,
    };
  });
}
