import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { authorize } from "../../domain/authz/policies";
import { unwrap } from "../../domain/shared/result";
import {
  CATEGORY_IDS,
  rowKey,
  type ResetScope,
  type ResetTable,
} from "../../domain/reset/categories";
import { resetPersonnelInventory } from "../../domain/reset/survivors";
import { buildResetPlan } from "../../domain/reset/plan";
import {
  readResetInventory,
  resetSchemaBlockers,
} from "../../infrastructure/repositories/reset-inventory";
import { listDepartments } from "../../infrastructure/repositories/departments";
import { loadActor } from "../../infrastructure/repositories/memberships";
import { todayIn, APP_TIMEZONE } from "../../infrastructure/auth/actor";
import { ConflictError } from "../errors";
import type { AppContext } from "../use-case";
export const resetSelectionInput = z
  .object({
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("APPLICATION") }),
      z.object({
        kind: z.literal("DEPARTMENTS"),
        departmentIds: z.array(z.uuid()).min(1).max(500),
      }),
    ]),
    categories: z
      .array(
        z.enum(
          CATEGORY_IDS as [
            (typeof CATEGORY_IDS)[number],
            ...(typeof CATEGORY_IDS)[number][],
          ],
        ),
      )
      .min(1),
  })
  .transform((i) => ({
    ...i,
    categories: [...new Set(i.categories)].sort(),
    scope:
      i.scope.kind === "APPLICATION"
        ? i.scope
        : {
            ...i.scope,
            departmentIds: [...new Set(i.scope.departmentIds)].sort(),
          },
  }));
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function resetFingerprint(
  tables: readonly ResetTable[],
  selection: z.output<typeof resetSelectionInput>,
  actorId: string,
) {
  return createHash("sha256")
    .update(canonical({ actorId, selection, tables }))
    .digest("hex");
}
export async function requireResetAdmin(ctx: AppContext) {
  unwrap(authorize(ctx.actor, "dataReset.manage", {}));
  const current = await loadActor(
    ctx.db,
    ctx.actor.userId,
    todayIn(APP_TIMEZONE, ctx.clock?.()),
  );
  unwrap(
    authorize(
      current ?? { ...ctx.actor, isActive: false },
      "dataReset.manage",
      {},
    ),
  );
}
const PREVIEW_TTL_MS = 15 * 60 * 1000;
export interface ResetProof {
  previewId: string;
  issuedAt: number;
  fingerprint: string;
  proof: string;
}
function sign(
  actorId: string,
  selection: unknown,
  proof: Omit<ResetProof, "proof">,
) {
  const key = process.env.AUTH_SECRET;
  if (!key) throw new Error("AUTH_SECRET is required to sign reset previews");
  return createHmac("sha256", key)
    .update(canonical({ actorId, selection, ...proof }))
    .digest("hex");
}
export function verifyResetProof(
  actorId: string,
  selection: unknown,
  proof: ResetProof,
  now: number,
) {
  const age = now - proof.issuedAt;
  const expected = sign(actorId, selection, {
    previewId: proof.previewId,
    issuedAt: proof.issuedAt,
    fingerprint: proof.fingerprint,
  });
  if (
    age < 0 ||
    age > PREVIEW_TTL_MS ||
    !/^[a-f0-9]{64}$/.test(proof.proof) ||
    !timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(proof.proof, "hex"),
    )
  )
    throw new ConflictError(
      "Reset preview expired or changed",
      "RESET_PREVIEW_STALE",
    );
}
/** Purpose must be included in selection for commands other than Full Reset. */
export function createResetProof(
  actorId: string,
  selection: unknown,
  fingerprint: string,
  now: number,
): ResetProof {
  const base = { previewId: randomUUID(), issuedAt: now, fingerprint };
  return { ...base, proof: sign(actorId, selection, base) };
}
/** Complete plan and entity summaries, not a personal-data dump. No inserts, updates, audit or stored preview. */
export async function previewFullReset(ctx: AppContext, raw: unknown) {
  await requireResetAdmin(ctx);
  const selection = resetSelectionInput.parse(raw);
  return ctx.db.transaction(
    async (tx) => {
      await requireResetAdmin({
        ...ctx,
        db: tx as unknown as AppContext["db"],
      });
      const tables = await readResetInventory(tx);
      const plan = buildResetPlan(
        tables,
        selection.scope as ResetScope,
        selection.categories,
        ctx.actor.userId,
      );
      plan.blockers.push(...(await resetSchemaBlockers(tx)));
      plan.permitted = plan.blockers.length === 0;
      const fingerprint = resetFingerprint(tables, selection, ctx.actor.userId);
      const proofBase = {
        previewId: randomUUID(),
        issuedAt: (ctx.clock?.() ?? new Date()).getTime(),
        fingerprint,
      };
      const affected = (name: string) => {
        const table = tables.find((t) => t.name === name)!;
        const keys = new Set(plan.deleteKeys[name]);
        return table.rows.filter((r) => keys.has(rowKey(table, r)));
      };
      const personnel = resetPersonnelInventory(
        tables,
        plan,
        selection.scope,
        ctx.actor.userId,
      );
      return {
        selection,
        plan,
        ...proofBase,
        proof: sign(ctx.actor.userId, selection, proofBase),
        departments: affected("departments").map((r) => ({
          id: String(r.id),
          label: String(r.name),
        })),
        affectedDepartmentIds:
          selection.scope.kind === "DEPARTMENTS"
            ? selection.scope.departmentIds
            : tables
                .find((t) => t.name === "departments")!
                .rows.map((r) => String(r.id)),
        users: personnel.filter((u) => u.disposition === "DELETE"),
        preservedUsers: personnel.filter((u) => u.disposition === "RETAIN"),
        schedules: affected("schedules").map((r) => ({
          id: String(r.id),
          label: String(r.label),
          departmentId: String(r.department_id),
          status: String(r.status),
        })),
        masterData: plan.tables.filter((t) =>
          [
            "departments",
            "shift_types",
            "change_reasons",
            "staffing_rule_sets",
            "staffing_rule_set_versions",
            "staffing_rule_set_requirements",
            "staffing_rule_set_date_exceptions",
          ].includes(t.table),
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export type FullResetPreview = Awaited<ReturnType<typeof previewFullReset>>;

export async function getResetDepartmentOptions(ctx: AppContext) {
  await requireResetAdmin(ctx);
  return (await listDepartments(ctx.db)).map((d) => ({
    id: d.id,
    name: d.name,
  }));
}
