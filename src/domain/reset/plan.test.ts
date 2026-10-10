import { describe, expect, it } from "vitest";
import { buildResetPlan } from "./plan";
import { FULL_OPERATIONAL_CATEGORIES, type ResetTable } from "./categories";
const tables: ResetTable[] = [
  {
    name: "users",
    primaryKey: ["id"],
    foreignKeys: [],
    rows: [
      {
        id: "admin",
        is_active: true,
        is_hospital_admin: true,
        has_credentials: true,
      },
      { id: "nurse" },
    ],
  },
  {
    name: "departments",
    primaryKey: ["id"],
    foreignKeys: [],
    rows: [{ id: "a" }, { id: "b" }],
  },
  {
    name: "department_memberships",
    primaryKey: ["id"],
    foreignKeys: [
      { columns: ["user_id"], target: "users", targetColumns: ["id"] },
      {
        columns: ["department_id"],
        target: "departments",
        targetColumns: ["id"],
      },
    ],
    rows: [
      { id: "ma", department_id: "a", user_id: "nurse" },
      { id: "mb", department_id: "b", user_id: "nurse" },
    ],
  },
  {
    name: "schedules",
    primaryKey: ["id"],
    foreignKeys: [
      {
        columns: ["department_id"],
        target: "departments",
        targetColumns: ["id"],
      },
    ],
    rows: [{ id: "s", department_id: "a" }],
  },
  {
    name: "shift_assignments",
    primaryKey: ["schedule_id", "user_id", "date"],
    foreignKeys: [
      { columns: ["schedule_id"], target: "schedules", targetColumns: ["id"] },
    ],
    rows: [{ schedule_id: "s", user_id: "nurse", date: "2026-10-01" }],
  },
];
describe("pilot reset dependency planning", () => {
  it("defaults only operational categories", () =>
    expect(FULL_OPERATIONAL_CATEGORIES).not.toContain("departments"));
  it("expands schedule dependencies with explanations", () => {
    const p = buildResetPlan(
      tables,
      { kind: "DEPARTMENTS", departmentIds: ["a"] },
      ["schedules"],
      "admin",
    );
    expect(p.permitted).toBe(true);
    expect(p.automatic).toContainEqual({
      category: "assignments",
      reasons: ["shift_assignments → schedules"],
    });
  });
  it("preserves shared users and unrelated memberships", () => {
    const p = buildResetPlan(
      tables,
      { kind: "DEPARTMENTS", departmentIds: ["a"] },
      FULL_OPERATIONAL_CATEGORIES,
      "admin",
    );
    expect(p.preservedUserIds).toEqual(["nurse"]);
    expect(p.deleteKeys.users).toEqual([]);
    expect(p.deleteKeys.department_memberships).toEqual(['["ma"]']);
  });
  it("preserves executing and usable admin on full reset", () => {
    const p = buildResetPlan(
      tables,
      { kind: "APPLICATION" },
      FULL_OPERATIONAL_CATEGORIES,
      "admin",
    );
    expect(p.deleteKeys.users).toEqual(['["nurse"]']);
    expect(p.protectedUserIds).toEqual(["admin"]);
  });
  it("blocks unknown or empty scope and missing usable admin", () => {
    expect(
      buildResetPlan(
        tables,
        { kind: "DEPARTMENTS", departmentIds: [] },
        [],
        "admin",
      ).blockers,
    ).toContain("EMPTY_DEPARTMENT_SCOPE");
    expect(
      buildResetPlan(
        tables.filter((t) => t.name !== "users"),
        { kind: "DEPARTMENTS", departmentIds: ["missing"] },
        [],
        "admin",
      ).permitted,
    ).toBe(false);
  });
});

describe("scope and master-data safety", () => {
  it("does not delete unscoped notifications in a department reset", () => {
    const data = [
      ...tables,
      {
        name: "notifications",
        primaryKey: ["id"],
        foreignKeys: [
          { columns: ["recipient_id"], target: "users", targetColumns: ["id"] },
        ],
        rows: [{ id: "n", recipient_id: "nurse", schedule_id: null }],
      },
    ];
    const p = buildResetPlan(
      data,
      { kind: "DEPARTMENTS", departmentIds: ["a"] },
      ["notifications", "personnel"],
      "admin",
    );
    expect(p.deleteKeys.notifications).toEqual([]);
    expect(p.preservedUserIds).toContain("nurse");
  });
  it("preserves an additional credentialed admin when the caller has none", () => {
    const data = tables.map((t) =>
      t.name === "users"
        ? {
            ...t,
            rows: [
              {
                id: "admin",
                is_active: true,
                is_hospital_admin: true,
                has_credentials: false,
              },
              {
                id: "backup",
                is_active: true,
                is_hospital_admin: true,
                has_credentials: true,
              },
            ],
          }
        : t,
    );
    expect(
      buildResetPlan(data, { kind: "APPLICATION" }, ["personnel"], "admin")
        .protectedUserIds,
    ).toEqual(["admin", "backup"]);
  });
  it("blocks a global reference deletion that reaches another department", () => {
    const data = [
      ...tables,
      {
        name: "shift_types",
        primaryKey: ["code"],
        foreignKeys: [],
        rows: [{ code: "M" }],
      },
    ].map((t) =>
      t.name === "shift_assignments"
        ? {
            ...t,
            foreignKeys: [
              ...t.foreignKeys,
              {
                columns: ["shift_code"],
                target: "shift_types",
                targetColumns: ["code"],
              },
            ],
            rows: [
              {
                schedule_id: "outside",
                user_id: "nurse",
                date: "2026-10-01",
                shift_code: "M",
              },
            ],
          }
        : t,
    );
    const p = buildResetPlan(
      data,
      { kind: "DEPARTMENTS", departmentIds: ["a"] },
      ["shiftTypes"],
      "admin",
    );
    expect(p.blockers).toContain("CROSS_SCOPE_DEPENDENCY:shift_assignments");
  });
  it("does not classify inconsistent audit scope as local", () => {
    const data = [
      ...tables,
      {
        name: "audit_events",
        primaryKey: ["id"],
        foreignKeys: [],
        rows: [{ id: 1, department_id: "a", schedule_id: "outside" }],
      },
    ];
    expect(
      buildResetPlan(
        data,
        { kind: "DEPARTMENTS", departmentIds: ["a"] },
        ["operationalAudit"],
        "admin",
      ).deleteKeys.audit_events,
    ).toEqual([]);
  });
});
