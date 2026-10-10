import {
  CATEGORY_IDS,
  RESET_CATEGORIES,
  references,
  rowKey,
  type ResetCategory,
  type ResetRow,
  type ResetScope,
  type ResetTable,
} from "./categories";
export interface ResetPlan {
  selected: ResetCategory[];
  automatic: { category: ResetCategory; reasons: string[] }[];
  deleteKeys: Record<string, string[]>;
  tables: {
    table: string;
    category: ResetCategory;
    total: number;
    remove: number;
    preserve: number;
  }[];
  protectedUserIds: string[];
  preservedUserIds: string[];
  blockers: string[];
  warnings: string[];
  recreation: ResetCategory[];
  permitted: boolean;
}
/** Pure, record-level dependency closure. Cross-scope dependencies fail closed. */
export function buildResetPlan(
  tables: readonly ResetTable[],
  scope: ResetScope,
  selected: readonly ResetCategory[],
  actorId: string,
): ResetPlan {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const rows = (name: string) => byName.get(name)?.rows ?? [];
  const selectedSet = new Set(selected);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const automatic = new Map<ResetCategory, Set<string>>();
  const deleting = new Map(tables.map((t) => [t.name, new Set<string>()]));
  const app = scope.kind === "APPLICATION";
  const departmentIds = new Set(
    scope.kind === "DEPARTMENTS"
      ? scope.departmentIds
      : rows("departments").map((r) => String(r.id)),
  );
  if (!app && departmentIds.size === 0) blockers.push("EMPTY_DEPARTMENT_SCOPE");
  if (
    [...departmentIds].some(
      (id) => !rows("departments").some((r) => r.id === id),
    )
  )
    blockers.push("UNKNOWN_DEPARTMENT");
  const scheduleIds = new Set(
    rows("schedules")
      .filter((r) => departmentIds.has(String(r.department_id)))
      .map((r) => r.id),
  );
  const idsOf = (table: string, column: string, ids: Set<unknown>) =>
    new Set(
      rows(table)
        .filter((r) => ids.has(r[column]))
        .map((r) => r.id),
    );
  const windowIds = idsOf("preference_windows", "schedule_id", scheduleIds);
  const revisionIds = idsOf("schedule_revisions", "schedule_id", scheduleIds);
  const versionIds = idsOf("schedule_versions", "schedule_id", scheduleIds);
  const changeIds = idsOf("schedule_changes", "schedule_id", scheduleIds);
  const legacyIds = idsOf(
    "legacy_shift_change_requests",
    "schedule_id",
    scheduleIds,
  );
  const candidateUsers = new Set(
    rows("department_memberships")
      .concat(rows("supervisor_assignments"))
      .filter((r) => departmentIds.has(String(r.department_id)))
      .map((r) => r.user_id),
  );
  for (const r of rows("schedule_roster"))
    if (scheduleIds.has(r.schedule_id)) candidateUsers.add(r.user_id);
  const usable = rows("users")
    .filter(
      (r) =>
        r.is_active === true &&
        r.is_hospital_admin === true &&
        r.has_credentials === true,
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const protectedIds = new Set([actorId]);
  if (!usable.some((r) => r.id === actorId) && usable[0])
    protectedIds.add(String(usable[0].id));
  if (!usable.length) blockers.push("NO_USABLE_ADMIN");
  const categoryOf = (t: ResetTable, r: ResetRow): ResetCategory => {
    if (t.name.startsWith("staffing_rule_set")) {
      const v =
        t.name === "staffing_rule_set_versions"
          ? r
          : rows("staffing_rule_set_versions").find(
              (v) => v.id === r.version_id,
            );
      const lineage =
        t.name === "staffing_rule_sets"
          ? r
          : rows("staffing_rule_sets").find((s) => s.id === v?.rule_set_id);
      return lineage?.department_id == null
        ? "hospitalStaffingRules"
        : "departmentStaffingRules";
    }
    return CATEGORY_IDS.find((id) =>
      (RESET_CATEGORIES[id].tables as readonly string[]).includes(t.name),
    )!;
  };
  const inScope = (t: ResetTable, r: ResetRow): boolean => {
    if (app) return true;
    if (t.name === "users") return candidateUsers.has(r.id);
    if (t.name === "departments") return departmentIds.has(String(r.id));
    if (r.department_id != null)
      return (
        departmentIds.has(String(r.department_id)) &&
        (r.schedule_id == null || scheduleIds.has(r.schedule_id))
      );
    if (r.schedule_id != null) return scheduleIds.has(r.schedule_id);
    if (t.name === "notifications") return false; // Unscoped notifications cannot be attributed to one department.
    if (r.window_id != null) return windowIds.has(r.window_id);
    if (t.name === "schedule_revision_dates")
      return revisionIds.has(r.revision_id);
    if (t.name === "schedule_version_assignments")
      return versionIds.has(r.version_id);
    if (t.name === "schedule_change_cells") return changeIds.has(r.change_id);
    if (t.name === "legacy_shift_change_request_items")
      return legacyIds.has(r.request_id);
    if (t.name.startsWith("staffing_rule_set")) {
      const v =
        t.name === "staffing_rule_set_versions"
          ? r
          : rows("staffing_rule_set_versions").find(
              (v) => v.id === r.version_id,
            );
      const s =
        t.name === "staffing_rule_sets"
          ? r
          : rows("staffing_rule_sets").find((s) => s.id === v?.rule_set_id);
      return (
        s?.department_id != null && departmentIds.has(String(s.department_id))
      );
    }
    return false;
  };
  const mark = (t: ResetTable, r: ResetRow) =>
    deleting.get(t.name)!.add(rowKey(t, r));
  for (const t of tables)
    for (const r of t.rows) {
      const cat = categoryOf(t, r);
      if (
        selectedSet.has(cat) &&
        (inScope(t, r) || RESET_CATEGORIES[cat].global)
      ) {
        if (t.name === "users" && protectedIds.has(String(r.id))) continue;
        mark(t, r);
      }
    }
  // Personnel cannot drag retained master data or another department into a reset.
  const preservedUserIds: string[] = [];
  const users = byName.get("users");
  if (users)
    for (const user of users.rows) {
      if (!deleting.get("users")!.has(rowKey(users, user))) continue;
      const retained = tables.some((t) =>
        t.foreignKeys.some(
          (fk) =>
            fk.target === "users" &&
            t.rows.some(
              (r) =>
                references(r, fk, user) &&
                (!inScope(t, r) ||
                  (RESET_CATEGORIES[categoryOf(t, r)].master &&
                    !deleting.get(t.name)!.has(rowKey(t, r)) &&
                    !(
                      categoryOf(t, r) === "departmentStaffingRules" &&
                      selectedSet.has("departments") &&
                      inScope(t, r)
                    ))),
            ),
        ),
      );
      if (retained) {
        deleting.get("users")!.delete(rowKey(users, user));
        preservedUserIds.push(String(user.id));
      }
    }
  if (preservedUserIds.length)
    warnings.push("SHARED_OR_REFERENCED_PERSONNEL_PRESERVED");
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of tables)
      for (const fk of child.foreignKeys) {
        const parent = byName.get(fk.target);
        if (!parent) continue;
        for (const r of child.rows) {
          if (deleting.get(child.name)!.has(rowKey(child, r))) continue;
          if (
            !parent.rows.some(
              (p) =>
                deleting.get(parent.name)!.has(rowKey(parent, p)) &&
                references(r, fk, p),
            )
          )
            continue;
          const cat = categoryOf(child, r);
          // Explicitly selected global rows were already marked in initial selection.
          if (!inScope(child, r)) {
            blockers.push(`CROSS_SCOPE_DEPENDENCY:${child.name}`);
            continue;
          }
          // Only department removal may require its own master configuration automatically.
          if (
            RESET_CATEGORIES[cat].master &&
            !selectedSet.has(cat) &&
            !(
              cat === "departmentStaffingRules" &&
              selectedSet.has("departments")
            )
          ) {
            blockers.push(`EXPLICIT_MASTER_SELECTION_REQUIRED:${cat}`);
            continue;
          }
          // Users have no outgoing FKs in the verified schema, so personnel cannot
          // be selected through dependency closure. Initial selection above protects admins.
          // An automatically selected category has the same scoped semantics as a manual selection.
          for (const dependentTable of tables)
            for (const dependentRow of dependentTable.rows) {
              if (
                categoryOf(dependentTable, dependentRow) !== cat ||
                !inScope(dependentTable, dependentRow)
              )
                continue;
              const keys = deleting.get(dependentTable.name)!;
              keys.add(rowKey(dependentTable, dependentRow));
              changed = true;
            }
          // A retained in-scope child cannot belong to a manually selected category:
          // initial selection marked that entire category. Expand it exactly once.
          const reasons = automatic.get(cat) ?? new Set<string>();
          reasons.add(`${child.name} → ${parent.name}`);
          automatic.set(cat, reasons);
        }
      }
  }
  const counts = tables.flatMap((t) =>
    CATEGORY_IDS.filter((id) =>
      (RESET_CATEGORIES[id].tables as readonly string[]).includes(t.name),
    ).map((cat) => {
      const matching = t.rows.filter((r) => categoryOf(t, r) === cat);
      const remove = matching.filter((r) =>
        deleting.get(t.name)!.has(rowKey(t, r)),
      ).length;
      return {
        table: t.name,
        category: cat,
        total: matching.length,
        remove,
        preserve: matching.length - remove,
      };
    }),
  );
  if ([...selectedSet].some((c) => RESET_CATEGORIES[c].global))
    warnings.push("GLOBAL_MASTER_DATA_EXPLICITLY_SELECTED");
  if (
    rows("schedules").some(
      (r) =>
        r.status === "APPROVED" &&
        deleting.get("schedules")!.has(rowKey(byName.get("schedules")!, r)),
    )
  )
    warnings.push("APPROVED_PILOT_SCHEDULES_WILL_BE_DELETED");
  const recreation = [...new Set([...selectedSet, ...automatic.keys()])].filter(
    (c) =>
      RESET_CATEGORIES[c].master &&
      counts.some((t) => t.category === c && t.remove > 0),
  );
  return {
    selected: [...selectedSet].sort(),
    automatic: [...automatic].map(([category, reasons]) => ({
      category,
      reasons: [...reasons].sort(),
    })),
    deleteKeys: Object.fromEntries(
      [...deleting].map(([name, keys]) => [name, [...keys].sort()]),
    ),
    tables: counts,
    protectedUserIds: [...protectedIds].sort(),
    preservedUserIds: preservedUserIds.sort(),
    blockers: [...new Set(blockers)].sort(),
    warnings,
    recreation,
    permitted: blockers.length === 0,
  };
}
