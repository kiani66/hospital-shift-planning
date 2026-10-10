import { createHash } from "node:crypto";

import { z } from "zod";

import { authorize } from "../../domain/authz/policies";
import {
  planPersonnelImport,
  type CandidateRow,
  type ImportPlan,
} from "../../domain/management/personnel-import";
import { ValidationError } from "../../domain/shared/errors";
import type { IsoDate } from "../../domain/shared/dates";
import { unwrap } from "../../domain/shared/result";
import { APP_TIMEZONE, todayIn } from "../../infrastructure/auth/actor";
import type { DbExecutor } from "../../infrastructure/db/database";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { insertMembership } from "../../infrastructure/repositories/management";
import { loadActor } from "../../infrastructure/repositories/memberships";
import {
  findAccountsByPersonnelNumbers,
  findEmailOwners,
  listDepartmentMembershipsOf,
} from "../../infrastructure/repositories/personnel-import";
import { createUser } from "../../infrastructure/repositories/users";
import { ConflictError, NotFoundError } from "../errors";
import { authorizeAdministration } from "../management/context";
import { managementDay } from "../management/input";
import { defineCommand, type AppContext } from "../use-case";
import { analyzePersonnelCsv, candidateFromFields } from "./rows";

async function buildPlan(
  db: DbExecutor,
  candidates: readonly CandidateRow[],
  departmentId: string,
  startedOn: IsoDate,
): Promise<ImportPlan> {
  const people = candidates.flatMap((c) => (c.person ? [c.person] : []));
  const accounts = await findAccountsByPersonnelNumbers(
    db,
    people.map((p) => p.personnelNumber),
  );
  const [memberships, emailOwners] = await Promise.all([
    listDepartmentMembershipsOf(
      db,
      accounts.map((a) => a.id),
      departmentId,
    ),
    findEmailOwners(
      db,
      people.flatMap((p) => (p.email ? [p.email] : [])),
    ),
  ]);
  return planPersonnelImport(candidates, {
    startedOn,
    emailOwners,
    accountsByPersonnelNumber: new Map(
      accounts.map((a) => [
        a.personnelNumber!,
        {
          ...a,
          personnelNumber: a.personnelNumber!,
          memberships: memberships.filter((m) => m.userId === a.id),
        },
      ]),
    ),
  });
}

/**
 * What a confirmed import would do, as a stable digest: destination, start
 * day and, per row, the action, the matched account and the normalized
 * values. The commit recomputes it inside its transaction; any difference
 * (someone created, changed or imported the same people in between) is a
 * conflict, never a silently different write.
 */
export function planFingerprint(
  departmentId: string,
  startedOn: IsoDate,
  plan: ImportPlan,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        departmentId,
        startedOn,
        plan.rows.map((r) => [r.line, r.action, r.userId, r.person]),
      ]),
    )
    .digest("hex");
}

const target = z.object({
  departmentId: z.uuid(),
  startedOn: managementDay,
});

async function requireImportDepartment(db: DbExecutor, departmentId: string) {
  const department = await findDepartmentById(db, departmentId);
  if (!department?.isActive) throw new NotFoundError("Department");
  return department;
}

export type ImportPreview =
  | {
      readonly ok: false;
      readonly fileError: string;
      readonly fields?: readonly string[];
    }
  | {
      readonly ok: true;
      readonly department: { id: string; code: string; name: string };
      readonly startedOn: IsoDate;
      readonly plan: ImportPlan;
      /** The cells as written, aligned with `plan.rows`. */
      readonly raw: readonly Partial<Record<string, string>>[];
      readonly ignoredColumns: readonly string[];
      readonly fingerprint: string;
      readonly accountIdsByLine: Readonly<Record<number, readonly string[]>>;
    };

/**
 * Validates an uploaded CSV completely and reports per row what a commit
 * would do. Writes nothing. Hospital Admin only, rechecked against the
 * database like every management read.
 */
export async function previewPersonnelImport(
  ctx: AppContext,
  rawInput: { departmentId: unknown; startedOn: unknown; text: string },
): Promise<ImportPreview> {
  unwrap(authorize(ctx.actor, "personnel.import", {}));
  const today = todayIn(APP_TIMEZONE, ctx.clock?.());
  const current = await loadActor(ctx.db, ctx.actor.userId, today);
  unwrap(
    authorize(
      current ?? { ...ctx.actor, isActive: false },
      "personnel.import",
      {},
    ),
  );
  const input = target.safeParse(rawInput);
  if (!input.success)
    throw new ValidationError(
      "Choose a department and a start date",
      "departmentId",
    );
  const department = await requireImportDepartment(
    ctx.db,
    input.data.departmentId,
  );

  const analyzed = analyzePersonnelCsv(rawInput.text);
  if (!analyzed.ok)
    return {
      ok: false,
      fileError: analyzed.error,
      ...(analyzed.fields && { fields: analyzed.fields }),
    };
  const plan = await buildPlan(
    ctx.db,
    analyzed.candidates,
    department.id,
    input.data.startedOn,
  );
  const emailOwners = await findEmailOwners(
    ctx.db,
    plan.rows.flatMap((r) => (r.person?.email ? [r.person.email] : [])),
  );
  return {
    accountIdsByLine: Object.fromEntries(
      plan.rows.map((r) => [
        r.line,
        [
          ...new Set(
            [
              r.userId,
              r.person?.email ? emailOwners.get(r.person.email) : null,
            ].filter((id): id is string => !!id),
          ),
        ],
      ]),
    ),
    ok: true,
    department: {
      id: department.id,
      code: department.code,
      name: department.name,
    },
    startedOn: input.data.startedOn,
    plan,
    raw: analyzed.raw,
    ignoredColumns: analyzed.ignoredColumns,
    fingerprint: planFingerprint(department.id, input.data.startedOn, plan),
  };
}

const committedRow = z.object({
  line: z.number().int().positive(),
  personnelNumber: z.string().max(200),
  displayName: z.string().max(400),
  email: z.string().max(320).nullable(),
  mobile: z.string().max(40).nullable(),
  role: z.string().max(40),
});

export interface ImportOutcome {
  readonly created: readonly {
    userId: string;
    personnelNumber: string;
    displayName: string;
  }[];
  readonly membershipsAdded: number;
  readonly unchanged: number;
}

/**
 * Commits a previewed import atomically: every row's account and membership,
 * or nothing. Runs under the administration lock (serializing it with other
 * imports and every management write), re-validates the rows and re-plans
 * against current data, and refuses unless the plan is exactly the one the
 * admin confirmed. New accounts have no password (they cannot sign in until a
 * temporary password is issued); existing accounts are never modified, reset
 * or reactivated, and existing schedules' rosters are never touched.
 */
export const commitPersonnelImport = defineCommand({
  name: "personnel.import",
  input: target.extend({
    expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    rows: z.array(committedRow).min(1).max(500),
  }),
  async handler(uow, input): Promise<ImportOutcome> {
    await authorizeAdministration(uow, "personnel.import");
    const department = await requireImportDepartment(
      uow.tx,
      input.departmentId,
    );
    const candidates = input.rows.map((row) =>
      candidateFromFields(row.line, row),
    );
    const plan = await buildPlan(
      uow.tx,
      candidates,
      department.id,
      input.startedOn,
    );
    // Anything other than exactly the confirmed plan (data changed meanwhile,
    // or the submitted rows differ from the preview) is refused first.
    const fingerprint = planFingerprint(department.id, input.startedOn, plan);
    if (fingerprint !== input.expectedFingerprint)
      throw new ConflictError(
        "The data changed since the preview",
        "IMPORT_PLAN_CHANGED",
      );
    if (!plan.committable)
      throw new ValidationError(
        "The import has rows with errors",
        "rows",
        "IMPORT_HAS_ERRORS",
      );

    const created: {
      userId: string;
      personnelNumber: string;
      displayName: string;
    }[] = [];
    let membershipsAdded = 0;
    for (const row of plan.rows) {
      const person = row.person!;
      if (row.action === "UNCHANGED") continue;
      let userId = row.userId;
      if (row.action === "CREATE") {
        const user = await createUser(uow.tx, {
          personnelNumber: person.personnelNumber,
          displayName: person.displayName,
          email: person.email,
          mobile: person.mobile,
          passwordHash: null,
        });
        userId = user.id;
        created.push({
          userId,
          personnelNumber: person.personnelNumber,
          displayName: person.displayName,
        });
        await uow.audit({
          action: "user.created",
          entityType: "user",
          entityId: userId,
          data: {
            personnelNumber: person.personnelNumber,
            email: person.email,
            mobile: person.mobile,
            displayName: person.displayName,
            isActive: true,
            credentials: "none",
            source: "import",
            importFingerprint: fingerprint,
          },
        });
      }
      const membership = {
        userId: userId!,
        departmentId: department.id,
        role: person.role,
        startedOn: input.startedOn,
        endedOn: null,
      };
      const membershipId = await insertMembership(uow.tx, membership);
      membershipsAdded++;
      await uow.audit({
        action: "membership.added",
        entityType: "membership",
        entityId: membershipId,
        departmentId: department.id,
        data: {
          after: membership,
          source: "import",
          importFingerprint: fingerprint,
        },
      });
    }

    const outcome = {
      created,
      membershipsAdded,
      unchanged: plan.counts.UNCHANGED,
    };
    if (plan.hasChanges)
      await uow.audit({
        action: "personnel.imported",
        entityType: "personnelImport",
        entityId: fingerprint,
        departmentId: department.id,
        data: {
          startedOn: input.startedOn,
          rows: plan.rows.length,
          created: created.length,
          membershipsAdded,
          unchanged: outcome.unchanged,
          personnelNumbers: plan.rows.map((r) => r.person!.personnelNumber),
        },
      });
    return outcome;
  },
});
