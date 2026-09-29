import type { MembershipRole } from "../../../domain/authz/actor";

/**
 * Deterministic demo data: fixed ids so the seed is repeatable and tests and
 * docs can refer to known users. All people are fictional ("نمونه" = sample)
 * and use the reserved `.invalid` e-mail domain.
 */

const dept = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (n: number) =>
  `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const schedule = (n: number) =>
  `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const DEMO_DEPARTMENTS = [
  { id: dept(1), code: "icu", name: "بخش مراقبت‌های ویژه (ICU)" },
  { id: dept(2), code: "er", name: "بخش اورژانس" },
] as const;

export const [DEMO_ICU, DEMO_ER] = DEMO_DEPARTMENTS;

export interface DemoUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

export const DEMO_USERS = {
  supervisor: {
    id: user(1),
    email: "supervisor@demo.invalid",
    displayName: "سوپروایزر نمونه",
  },
  icuHead: {
    id: user(10),
    email: "head.icu@demo.invalid",
    displayName: "مریم نمونه",
  },
  icuNurse1: {
    id: user(11),
    email: "nurse1.icu@demo.invalid",
    displayName: "سارا نمونه",
  },
  icuNurse2: {
    id: user(12),
    email: "nurse2.icu@demo.invalid",
    displayName: "زهرا نمونه",
  },
  icuNurse3: {
    id: user(13),
    email: "nurse3.icu@demo.invalid",
    displayName: "نگار نمونه",
  },
  icuNurse4: {
    id: user(14),
    email: "nurse4.icu@demo.invalid",
    displayName: "علی نمونه",
  },
  erHead: {
    id: user(20),
    email: "head.er@demo.invalid",
    displayName: "رضا نمونه",
  },
  erNurse1: {
    id: user(21),
    email: "nurse1.er@demo.invalid",
    displayName: "الهام نمونه",
  },
  erNurse2: {
    id: user(22),
    email: "nurse2.er@demo.invalid",
    displayName: "مهدی نمونه",
  },
  erNurse3: {
    id: user(23),
    email: "nurse3.er@demo.invalid",
    displayName: "نرگس نمونه",
  },
  /** Moved from ER to ICU: shows an ended membership (D16). */
  transferNurse: {
    id: user(30),
    email: "transfer@demo.invalid",
    displayName: "لیلا نمونه",
  },
} as const satisfies Record<string, DemoUser>;

export interface DemoMembership {
  readonly userId: string;
  readonly departmentId: string;
  readonly role: MembershipRole;
  readonly startedOn: string;
  readonly endedOn?: string;
}

const u = DEMO_USERS;
export const DEMO_MEMBERSHIPS: readonly DemoMembership[] = [
  {
    userId: u.icuHead.id,
    departmentId: DEMO_ICU.id,
    role: "HEAD_NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.icuNurse1.id,
    departmentId: DEMO_ICU.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.icuNurse2.id,
    departmentId: DEMO_ICU.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.icuNurse3.id,
    departmentId: DEMO_ICU.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.icuNurse4.id,
    departmentId: DEMO_ICU.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.erHead.id,
    departmentId: DEMO_ER.id,
    role: "HEAD_NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.erNurse1.id,
    departmentId: DEMO_ER.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.erNurse2.id,
    departmentId: DEMO_ER.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.erNurse3.id,
    departmentId: DEMO_ER.id,
    role: "NURSE",
    startedOn: "2026-01-01",
  },
  {
    userId: u.transferNurse.id,
    departmentId: DEMO_ER.id,
    role: "NURSE",
    startedOn: "2026-01-01",
    endedOn: "2026-09-22",
  },
  {
    userId: u.transferNurse.id,
    departmentId: DEMO_ICU.id,
    role: "NURSE",
    startedOn: "2026-09-23",
  },
];

export const DEMO_SUPERVISED_DEPARTMENTS = [DEMO_ICU.id, DEMO_ER.id] as const;

/** A DRAFT schedule for Aban 1405 in the ICU, with the roster snapshotted from memberships. */
export const DEMO_SCHEDULE = {
  id: schedule(1),
  departmentId: DEMO_ICU.id,
  periodStart: "2026-10-23",
  periodEnd: "2026-11-21",
  label: "آبان ۱۴۰۵",
  createdBy: u.icuHead.id,
} as const;
