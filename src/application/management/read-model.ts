import type { MembershipRole } from "../../domain/authz/actor";
import {
  relationStatus,
  type RelationStatus,
} from "../../domain/management/relation-status";
import type { IsoDate } from "../../domain/shared/dates";

export interface ManagementDepartment {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface AccessRelation {
  id: string;
  department: ManagementDepartment;
  startedOn: IsoDate;
  endedOn: IsoDate | null;
  status: RelationStatus;
}
export interface MembershipView extends AccessRelation {
  role: MembershipRole;
}
export interface PersonnelUser {
  id: string;
  displayName: string;
  /** Null for legacy accounts not yet backfilled (stage 1 of the personnel-number migration). */
  personnelNumber: string | null;
  email: string | null;
  mobile: string | null;
  isActive: boolean;
  isHospitalAdmin: boolean;
  memberships: MembershipView[];
  supervisors: AccessRelation[];
}
export interface PersonnelDetail extends PersonnelUser {
  createdAt: Date;
  updatedAt: Date;
  /** Safe booleans only; never credential material. */
  hasCredentials: boolean;
  mustChangePassword: boolean;
}
export interface RelationRow {
  id: string;
  department: ManagementDepartment;
  startedOn: string;
  endedOn: string | null;
}

/** Explicit projections keep extra persistence/security fields out of the read DTO. */
export function accessRelation(
  row: RelationRow,
  today: IsoDate,
): AccessRelation {
  const startedOn = row.startedOn as IsoDate;
  const endedOn = row.endedOn as IsoDate | null;
  return {
    id: row.id,
    department: {
      id: row.department.id,
      code: row.department.code,
      name: row.department.name,
      isActive: row.department.isActive,
    },
    startedOn,
    endedOn,
    status: relationStatus({ startedOn, endedOn }, today),
  };
}

export function personnelUser(
  user: {
    id: string;
    displayName: string;
    personnelNumber: string | null;
    email: string | null;
    mobile: string | null;
    isActive: boolean;
    isHospitalAdmin: boolean;
  },
  relations: {
    memberships: readonly (RelationRow & { role: MembershipRole })[];
    supervisors: readonly RelationRow[];
  },
  today: IsoDate,
): PersonnelUser {
  return {
    id: user.id,
    displayName: user.displayName,
    personnelNumber: user.personnelNumber,
    email: user.email,
    mobile: user.mobile,
    isActive: user.isActive,
    isHospitalAdmin: user.isHospitalAdmin,
    memberships: relations.memberships.map((row) => ({
      ...accessRelation(row, today),
      role: row.role,
    })),
    supervisors: relations.supervisors.map((row) => accessRelation(row, today)),
  };
}
