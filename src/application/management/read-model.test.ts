import { describe, expect, it } from "vitest";

import { isoDate } from "../../domain/shared/dates";
import { accessRelation, personnelUser } from "./read-model";

const today = isoDate("2026-10-03");
const department = {
  id: "dept",
  code: "icu",
  name: "ICU",
  isActive: false,
  internalSecret: "secret",
};
const relation = {
  id: "relation",
  department,
  startedOn: "2026-01-01",
  endedOn: "2026-10-03",
  userId: "hidden",
  auditMetadata: "private",
};

describe("management DTOs", () => {
  it("projects only safe relation and department fields with inclusive status", () => {
    expect(accessRelation(relation, today)).toEqual({
      id: "relation",
      department: { id: "dept", code: "icu", name: "ICU", isActive: false },
      startedOn: "2026-01-01",
      endedOn: "2026-10-03",
      status: "CURRENT",
    });
  });
  it("drops extra account and relation security fields while retaining inactive-account history", () => {
    const user = {
      id: "user",
      displayName: "Name",
      email: "user@demo.invalid",
      isActive: false,
      isHospitalAdmin: true,
      passwordHash: "hash",
      token: "token",
      sessionId: "session",
    };
    const dto = personnelUser(
      user,
      {
        memberships: [{ ...relation, role: "HEAD_NURSE" }],
        supervisors: [
          { ...relation, id: "future", startedOn: "2027-01-01", endedOn: null },
        ],
      },
      today,
    );
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "displayName",
        "email",
        "isActive",
        "isHospitalAdmin",
        "memberships",
        "supervisors",
      ].sort(),
    );
    expect(dto).toMatchObject({
      isActive: false,
      isHospitalAdmin: true,
      memberships: [{ role: "HEAD_NURSE", status: "CURRENT" }],
      supervisors: [{ status: "FUTURE" }],
    });
    expect(JSON.stringify(dto)).not.toMatch(
      /password|hash|token|session|secret|auditMetadata|userId/,
    );
  });
  it("returns empty relation arrays for an account without current access", () => {
    const dto = personnelUser(
      {
        id: "u",
        displayName: "N",
        email: "n@demo.invalid",
        isActive: true,
        isHospitalAdmin: false,
      },
      { memberships: [], supervisors: [] },
      today,
    );
    expect(dto.memberships).toEqual([]);
    expect(dto.supervisors).toEqual([]);
  });
});
