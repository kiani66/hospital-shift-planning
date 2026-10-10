import {
  references,
  rowKey,
  type ResetScope,
  type ResetTable,
} from "./categories";
import type { ResetPlan } from "./plan";

/** All identities remaining after the plan, including outside-scope and legacy orphan accounts. */
export function resetPersonnelInventory(
  tables: readonly ResetTable[],
  plan: ResetPlan,
  scope: ResetScope,
  actorId: string,
) {
  const rows = (name: string) =>
    tables.find((t) => t.name === name)?.rows ?? [];
  const deleted = (
    name: string,
    row: (typeof tables)[number]["rows"][number],
  ) =>
    // The plan and inventory are from the same snapshot; every table has delete keys.
    plan.deleteKeys[name]!.includes(
      rowKey(
        tables.find((t) => t.name === name)!,
        row,
      ),
    );
  const selectedDepartments =
    scope.kind === "DEPARTMENTS" ? new Set(scope.departmentIds) : null;
  const candidates = new Set<unknown>();
  for (const name of ["department_memberships", "supervisor_assignments"])
    for (const r of rows(name))
      if (
        !selectedDepartments ||
        selectedDepartments.has(String(r.department_id))
      )
        candidates.add(r.user_id);
  const schedules = new Set(
    rows("schedules")
      .filter(
        (r) =>
          !selectedDepartments ||
          selectedDepartments.has(String(r.department_id)),
      )
      .map((r) => r.id),
  );
  for (const r of rows("schedule_roster"))
    if (schedules.has(r.schedule_id)) candidates.add(r.user_id);
  return rows("users").map((user) => {
    const removing = deleted("users", user);
    const referencesLeft = tables.flatMap((t) =>
      t.foreignKeys
        .filter((f) => f.target === "users")
        .flatMap((f) =>
          t.rows
            .filter((r) => !deleted(t.name, r) && references(r, f, user))
            .map((r) => ({
              table: t.name,
              columns: f.columns.join(", "),
              key: rowKey(t, r),
              department:
                rows("departments").find((d) => d.id === r.department_id)
                  ?.name ?? null,
            })),
        ),
    );
    const reasons: string[] = [];
    if (!removing) {
      if (plan.protectedUserIds.includes(String(user.id)))
        reasons.push(
          user.id === actorId
            ? "مدیر اجراکننده محافظت‌شده"
            : "آخرین مدیر فعال دارای رمز قابل استفاده",
        );
      if (
        !plan.selected.includes("personnel") &&
        !plan.automatic.some((a) => a.category === "personnel")
      )
        reasons.push("دسته حساب‌های پرسنل برای حذف انتخاب نشده است");
      if (selectedDepartments && !candidates.has(user.id))
        reasons.push(
          "خارج از دامنه بخش‌های انتخاب‌شده؛ بدون عضویت، نظارت یا فهرست ماهانه در این دامنه",
        );
      for (const ref of referencesLeft)
        reasons.push(
          `ارجاع حفظ‌شونده: ${ref.table}.${ref.columns} [${ref.key}]${ref.department ? ` — ${ref.department}` : ""}`,
        );
      // The matching plan retains an account only for protection, category/scope
      // exclusion or a surviving reference. Do not replace those causes with a
      // generic explanation for a dependency that is itself being deleted.
    }
    return {
      id: String(user.id),
      label: String(user.display_name),
      personnelNumber:
        user.personnel_number == null ? null : String(user.personnel_number),
      email: user.email == null ? null : String(user.email),
      isActive: user.is_active === true,
      disposition: removing ? ("DELETE" as const) : ("RETAIN" as const),
      reasons,
      memberships: ["department_memberships", "supervisor_assignments"].flatMap(
        (name) =>
          rows(name)
            .filter((r) => r.user_id === user.id)
            .map((r) => ({
              departmentId: String(r.department_id),
              department: String(
                rows("departments").find((d) => d.id === r.department_id)
                  ?.name ?? r.department_id,
              ),
              role: String(r.role ?? "SUPERVISOR"),
              startedOn: String(r.started_on),
              endedOn: r.ended_on == null ? null : String(r.ended_on),
              retained: !deleted(name, r),
            })),
      ),
      importBehavior: removing
        ? ("NEW_IDENTITY_AVAILABLE" as const)
        : user.personnel_number == null
          ? ("EMAIL_RESERVED_ONLY" as const)
          : user.is_active === true
            ? ("MATCH_AND_REUSE_OR_CONFLICT" as const)
            : ("INACTIVE_BLOCKS_IMPORT" as const),
    };
  });
}
