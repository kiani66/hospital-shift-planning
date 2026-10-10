import { describe, expect, it } from "vitest";
import { RESET_TABLES } from "../../src/infrastructure/repositories/reset-inventory";
import { buildResetPlan } from "../../src/domain/reset/plan";
import { resetPersonnelInventory } from "../../src/domain/reset/survivors";
import {
  CATEGORY_IDS,
  FULL_OPERATIONAL_CATEGORIES,
  rowKey,
  type ResetRow,
  type ResetTable,
} from "../../src/domain/reset/categories";
import { planPersonnelImport } from "../../src/domain/management/personnel-import";
import { isoDate } from "../../src/domain/shared/dates";

function fixture(extra: Record<string, ResetRow[]> = {}): ResetTable[] {
  const data: Record<string, ResetRow[]> = {
    users: [
      {
        id: "admin",
        display_name: "Admin",
        personnel_number: "1",
        email: "admin@example.invalid",
        is_active: true,
        is_hospital_admin: true,
        has_credentials: true,
      },
      {
        id: "nurse",
        display_name: "Nurse",
        personnel_number: "2",
        email: "nurse@example.invalid",
        is_active: true,
      },
      {
        id: "outside",
        display_name: "Outside",
        personnel_number: "3",
        email: null,
        is_active: false,
      },
      {
        id: "legacy",
        display_name: "Legacy",
        personnel_number: null,
        email: "legacy@example.invalid",
        is_active: true,
      },
    ],
    departments: [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ],
    shift_types: [{ code: "M" }],
    change_reasons: [{ id: "reason" }],
    staffing_rule_sets: [
      { id: "hospital", department_id: null },
      { id: "local", department_id: "a" },
      { id: "other", department_id: "b" },
    ],
    staffing_rule_set_versions: [
      { id: "hv", rule_set_id: "hospital", created_by: "admin" },
      { id: "lv", rule_set_id: "local", created_by: "nurse" },
      { id: "bv", rule_set_id: "other", created_by: "outside" },
    ],
  };
  for (const d of ["a", "b"]) {
    const user = d === "a" ? "nurse" : "outside";
    const add = (name: string, row: ResetRow) => (data[name] ??= []).push(row);
    add("department_memberships", {
      id: `member-${d}`,
      department_id: d,
      user_id: user,
      role: "NURSE",
      started_on: "2026-01-01",
      ended_on: d === "a" ? null : "2026-09-01",
    });
    add("supervisor_assignments", {
      id: `super-${d}`,
      department_id: d,
      user_id: "admin",
      started_on: "2026-01-01",
      ended_on: null,
    });
    add("schedules", {
      id: `s-${d}`,
      department_id: d,
      status: "APPROVED",
      staffing_rule_set_version_id: d === "a" ? "lv" : "bv",
    });
    add("schedule_roster", { schedule_id: `s-${d}`, user_id: user });
    add("preference_windows", { id: `w-${d}`, schedule_id: `s-${d}` });
    add("preference_window_dates", { window_id: `w-${d}`, date: "2026-10-01" });
    add("preference_window_nurses", { window_id: `w-${d}`, user_id: user });
    add("nurse_preferences", {
      schedule_id: `s-${d}`,
      user_id: user,
      date: "2026-10-01",
    });
    add("shift_assignments", {
      schedule_id: `s-${d}`,
      user_id: user,
      date: "2026-10-01",
      shift_code: "M",
    });
    add("schedule_revisions", { id: `rev-${d}`, schedule_id: `s-${d}` });
    add("schedule_revision_dates", {
      revision_id: `rev-${d}`,
      date: "2026-10-01",
    });
    add("schedule_submissions", { id: `sub-${d}`, schedule_id: `s-${d}` });
    add("schedule_versions", {
      id: `v-${d}`,
      schedule_id: `s-${d}`,
      submission_id: `sub-${d}`,
    });
    add("schedule_version_assignments", {
      version_id: `v-${d}`,
      user_id: user,
      date: "2026-10-01",
      shift_code: "M",
    });
    add("schedule_changes", { id: `change-${d}`, schedule_id: `s-${d}` });
    add("schedule_change_cells", {
      change_id: `change-${d}`,
      user_id: user,
      date: "2026-10-01",
    });
    add("legacy_shift_change_requests", {
      id: `request-${d}`,
      schedule_id: `s-${d}`,
      requester_id: user,
    });
    add("legacy_shift_change_request_items", {
      request_id: `request-${d}`,
      date: "2026-10-01",
    });
    add("notifications", {
      id: `notification-${d}`,
      schedule_id: `s-${d}`,
      recipient_id: user,
    });
    add("audit_events", {
      id: `audit-${d}`,
      department_id: d,
      schedule_id: `s-${d}`,
      actor_id: user,
    });
  }
  for (const v of ["hv", "lv", "bv"]) {
    (data.staffing_rule_set_requirements ??= []).push({
      version_id: v,
      day_type: "NORMAL",
      coverage_period: "M",
    });
    (data.staffing_rule_set_date_exceptions ??= []).push({
      version_id: v,
      date: "2026-10-01",
      coverage_period: "M",
    });
  }
  return RESET_TABLES.map((t) => ({
    ...t,
    rows: extra[t.name] ?? data[t.name] ?? [],
  }));
}
const scope = { kind: "DEPARTMENTS", departmentIds: ["a"] } as const;
const app = { kind: "APPLICATION" } as const;
const get = (tables: ResetTable[], name: string) =>
  tables.find((t) => t.name === name)!;

describe("reset planner with actual schema relationships", () => {
  it("users have no outgoing FKs, making automatic personnel selection impossible", () => {
    expect(get(fixture(), "users").foreignKeys).toEqual([]);
    const p = buildResetPlan(fixture(), app, CATEGORY_IDS, "admin");
    expect(p.protectedUserIds).toEqual(["admin"]);
    expect(p.deleteKeys.users).not.toContain('["admin"]');
    expect(p.automatic.some((a) => a.category === "personnel")).toBe(false);
  });
  it("traverses every schedule dependency while preserving the other month/department", () => {
    const data = fixture();
    const p = buildResetPlan(data, scope, ["schedules"], "admin");
    expect(p.permitted).toBe(true);
    for (const name of [
      "schedules",
      "schedule_roster",
      "preference_windows",
      "preference_window_dates",
      "preference_window_nurses",
      "nurse_preferences",
      "shift_assignments",
      "schedule_revisions",
      "schedule_revision_dates",
      "schedule_submissions",
      "schedule_versions",
      "schedule_version_assignments",
      "schedule_changes",
      "schedule_change_cells",
      "legacy_shift_change_requests",
      "legacy_shift_change_request_items",
      "notifications",
      "audit_events",
    ]) {
      const table = get(data, name);
      expect(p.deleteKeys[name], name).toEqual([rowKey(table, table.rows[0]!)]);
      expect(p.tables.find((t) => t.table === name)).toMatchObject({
        remove: 1,
        preserve: 1,
      });
    }
    expect(p.automatic.map((a) => a.category)).toEqual(
      expect.arrayContaining([
        "assignments",
        "preferences",
        "requests",
        "planningChanges",
        "notifications",
        "operationalAudit",
      ]),
    );
    expect(p.warnings).toContain("APPROVED_PILOT_SCHEDULES_WILL_BE_DELETED");
  });
  it("warns only when approved schedules are actually removed", () => {
    expect(
      buildResetPlan(fixture(), scope, ["memberships"], "admin").warnings,
    ).not.toContain("APPROVED_PILOT_SCHEDULES_WILL_BE_DELETED");
  });
  it("requires explicit master selection when deleting the author of retained hospital policy", () => {
    const data = fixture({
      staffing_rule_set_versions: [
        { id: "hv", rule_set_id: "hospital", created_by: "nurse" },
      ],
    });
    const p = buildResetPlan(data, app, ["personnel"], "admin");
    expect(p.preservedUserIds).toContain("nurse");
    expect(p.deleteKeys.staffing_rule_set_versions).toEqual([]);
  });
  it("department deletion auto-selects its staffing configuration without deleting global policy", () => {
    const p = buildResetPlan(
      fixture(),
      scope,
      ["departments", "personnel"],
      "admin",
    );
    expect(p.permitted).toBe(true);
    expect(p.automatic).toContainEqual({
      category: "departmentStaffingRules",
      reasons: ["staffing_rule_set_versions → users"],
    });
    expect(p.deleteKeys.staffing_rule_sets).toEqual(['["local"]']);
    expect(p.deleteKeys.staffing_rule_set_versions).toEqual(['["lv"]']);
    expect(p.recreation).toContain("departmentStaffingRules");
    expect(p.deleteKeys.users).toContain('["nurse"]');
  });
  it("selects department policies separately and preserves their referenced personnel when retained", () => {
    const p = buildResetPlan(
      fixture(),
      scope,
      ["departmentStaffingRules"],
      "admin",
    );
    expect(p.deleteKeys.staffing_rule_sets).toEqual(['["local"]']);
    const retained = buildResetPlan(fixture(), scope, ["personnel"], "admin");
    expect(retained.preservedUserIds).toContain("nurse");
  });
  it("explicit global selection removes only global policy and warns about its scope", () => {
    const p = buildResetPlan(
      fixture(),
      scope,
      ["hospitalStaffingRules"],
      "admin",
    );
    expect(p.permitted).toBe(true);
    expect(p.deleteKeys.staffing_rule_sets).toEqual(['["hospital"]']);
    expect(p.deleteKeys.staffing_rule_set_versions).toEqual(['["hv"]']);
    expect(p.warnings).toContain("GLOBAL_MASTER_DATA_EXPLICITLY_SELECTED");
  });
  it("blocks deleting a version retained as another version's ancestor without master consent", () => {
    const data = fixture({
      staffing_rule_set_versions: [
        { id: "hv", rule_set_id: "hospital" },
        { id: "lv", rule_set_id: "local", based_on_version_id: "hv" },
        { id: "bv", rule_set_id: "other" },
      ],
    });
    const p = buildResetPlan(data, app, ["hospitalStaffingRules"], "admin");
    expect(p.blockers).toContain(
      "EXPLICIT_MASTER_SELECTION_REQUIRED:departmentStaffingRules",
    );
  });
  it("deterministically protects a usable backup among multiple admins", () => {
    const users = get(fixture(), "users").rows;
    const data = fixture({
      users: [
        ...users.map((u) => ({ ...u, has_credentials: false })),
        {
          id: "z",
          is_active: true,
          is_hospital_admin: true,
          has_credentials: true,
        },
        {
          id: "backup",
          is_active: true,
          is_hospital_admin: true,
          has_credentials: true,
        },
      ],
    });
    expect(
      buildResetPlan(data, app, ["personnel"], "admin").protectedUserIds,
    ).toEqual(["admin", "backup"]);
  });
  it("finds roster-only personnel, and keeps unrelated roster members", () => {
    const data = fixture({
      department_memberships: [],
      supervisor_assignments: [],
    });
    const p = buildResetPlan(
      data,
      scope,
      ["personnel", "departmentStaffingRules"],
      "admin",
    );
    expect(p.deleteKeys.users).toEqual(['["nurse"]']);
    expect(p.deleteKeys.users).not.toContain('["outside"]');
  });
});

describe("personnel survivors and import readiness", () => {
  it("reports all accounts, memberships, specific protections and deleted identities", () => {
    const data = fixture();
    const p = buildResetPlan(data, app, CATEGORY_IDS, "admin");
    const inventory = resetPersonnelInventory(data, p, app, "admin");
    expect(inventory.find((u) => u.id === "admin")).toMatchObject({
      disposition: "RETAIN",
      reasons: ["مدیر اجراکننده محافظت‌شده"],
      importBehavior: "MATCH_AND_REUSE_OR_CONFLICT",
    });
    expect(inventory.find((u) => u.id === "nurse")).toMatchObject({
      disposition: "DELETE",
      reasons: [],
      personnelNumber: "2",
      email: "nurse@example.invalid",
      importBehavior: "NEW_IDENTITY_AVAILABLE",
      memberships: [
        { department: "Alpha", role: "NURSE", retained: false, endedOn: null },
      ],
    });
    expect(
      inventory.find((u) => u.id === "outside")?.memberships[0]?.endedOn,
    ).toBe("2026-09-01");
    expect(inventory.find((u) => u.id === "admin")?.memberships[0]?.role).toBe(
      "SUPERVISOR",
    );
  });
  it("explains outside-scope and retained master references and inactive/legacy reservations", () => {
    const data = fixture();
    const p = buildResetPlan(data, scope, FULL_OPERATIONAL_CATEGORIES, "admin");
    const inventory = resetPersonnelInventory(data, p, scope, "admin");
    expect(inventory.find((u) => u.id === "nurse")?.reasons).toContain(
      'ارجاع حفظ‌شونده: staffing_rule_set_versions.created_by [["lv"]]',
    );
    const outside = inventory.find((u) => u.id === "outside")!;
    expect(outside).toMatchObject({
      isActive: false,
      email: null,
      importBehavior: "INACTIVE_BLOCKS_IMPORT",
    });
    expect(outside.reasons).toContain(
      "خارج از دامنه بخش‌های انتخاب‌شده؛ بدون عضویت، نظارت یا فهرست ماهانه در این دامنه",
    );
    expect(outside.reasons).toContain(
      'ارجاع حفظ‌شونده: department_memberships.user_id [["member-b"]] — Beta',
    );
    expect(inventory.find((u) => u.id === "legacy")).toMatchObject({
      personnelNumber: null,
      importBehavior: "EMAIL_RESERVED_ONLY",
    });
  });
  it("explains unselected personnel and protected backup, including roster-only candidates", () => {
    const data = fixture({
      department_memberships: [],
      supervisor_assignments: [],
    });
    const p = buildResetPlan(data, scope, ["schedules"], "admin");
    const inventory = resetPersonnelInventory(data, p, scope, "admin");
    expect(inventory.find((u) => u.id === "nurse")?.reasons).toContain(
      "دسته حساب‌های پرسنل برای حذف انتخاب نشده است",
    );
    expect(
      inventory
        .find((u) => u.id === "nurse")
        ?.reasons.some((r) => r.startsWith("خارج")),
    ).toBe(false);
    const backupData = fixture({
      users: [
        ...get(data, "users").rows.map((u) => ({
          ...u,
          has_credentials: false,
        })),
        {
          id: "backup",
          display_name: "Backup",
          is_active: true,
          is_hospital_admin: true,
          has_credentials: true,
        },
      ],
    });
    const bp = buildResetPlan(backupData, app, ["personnel"], "admin");
    expect(
      resetPersonnelInventory(backupData, bp, app, "admin").find(
        (u) => u.id === "backup",
      )?.reasons,
    ).toContain("آخرین مدیر فعال دارای رمز قابل استفاده");
  });
  it("reservation classifications agree with actual importer reuse and identity/email conflict rules", () => {
    const data = fixture();
    const p = buildResetPlan(data, scope, FULL_OPERATIONAL_CATEGORIES, "admin");
    const inventory = resetPersonnelInventory(data, p, scope, "admin");
    const nurse = inventory.find((u) => u.id === "nurse")!;
    expect(nurse.importBehavior).toBe("MATCH_AND_REUSE_OR_CONFLICT");
    const account = {
      id: nurse.id,
      personnelNumber: nurse.personnelNumber!,
      displayName: nurse.label,
      email: nurse.email,
      mobile: null,
      isActive: true,
      memberships: [],
    };
    const context = {
      startedOn: isoDate("2026-10-01"),
      accountsByPersonnelNumber: new Map([[account.personnelNumber, account]]),
      emailOwners: new Map([
        [account.email!, account.id],
        ["legacy@example.invalid", "legacy"],
      ]),
    };
    const person = {
      personnelNumber: "2",
      displayName: "Nurse",
      email: "nurse@example.invalid",
      mobile: null,
      role: "NURSE" as const,
    };
    expect(
      planPersonnelImport([{ line: 2, person, errors: [] }], context).rows[0],
    ).toMatchObject({ action: "ADD_MEMBERSHIP", userId: "nurse", errors: [] });
    expect(
      planPersonnelImport(
        [
          {
            line: 2,
            person: { ...person, displayName: "Real nurse" },
            errors: [],
          },
        ],
        context,
      ).rows[0],
    ).toMatchObject({
      action: "ERROR",
      errors: ["IDENTITY_CONFLICT"],
      conflicts: ["displayName"],
    });
    expect(
      planPersonnelImport(
        [
          {
            line: 2,
            person: {
              ...person,
              personnelNumber: "99",
              email: "legacy@example.invalid",
            },
            errors: [],
          },
        ],
        context,
      ).rows[0],
    ).toMatchObject({ action: "ERROR", errors: ["EMAIL_TAKEN"] });
  });
  it("handles an empty inventory without inventing identities", () => {
    expect(
      resetPersonnelInventory(
        [],
        buildResetPlan([], app, [], "admin"),
        app,
        "admin",
      ),
    ).toEqual([]);
  });
});

describe("survivor explanations after dependency closure", () => {
  it("reports conservative personnel retention even when explicit global deletion removes the last reference", () => {
    const data = fixture({
      staffing_rule_set_versions: [
        { id: "hv", rule_set_id: "hospital", created_by: "nurse" },
      ],
      staffing_rule_set_requirements: [],
      staffing_rule_set_date_exceptions: [],
    });
    const p = buildResetPlan(
      data,
      scope,
      [...FULL_OPERATIONAL_CATEGORIES, "hospitalStaffingRules"],
      "admin",
    );
    const nurse = resetPersonnelInventory(data, p, scope, "admin").find(
      (u) => u.id === "nurse",
    )!;
    expect(p.preservedUserIds).toContain("nurse");
    expect(p.deleteKeys.staffing_rule_set_versions).toEqual(['["hv"]']);
    expect(nurse).toMatchObject({
      disposition: "RETAIN",
      reasons: ["حساب در برنامه حذف قرار ندارد"],
    });
  });
  it("uses department identity when display-name projection is unavailable", () => {
    // ResetRow supports partial projections; the membership still references an existing department.
    const data = fixture({
      departments: [{ id: "a" }, { id: "b", name: "Beta" }],
    });
    const p = buildResetPlan(data, app, [], "admin");
    const nurse = resetPersonnelInventory(data, p, app, "admin").find(
      (u) => u.id === "nurse",
    )!;
    expect(nurse.memberships[0]?.department).toBe("a");
  });
});
