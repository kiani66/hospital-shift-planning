export const SCHEDULE_STATUSES = [
  "DRAFT",
  "PLANNING",
  "FINALIZED",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "REVISING",
] as const;

/**
 * DRAFT      created; only the Head Nurse works on it
 * PLANNING   preference collection and/or scheduling in progress
 * FINALIZED  locked by the Head Nurse (corrections still possible); visible to nurses
 * SUBMITTED  awaiting Supervisor review; frozen
 * RETURNED   rejected by the Supervisor; Head Nurse edits (nurses do NOT regain editing)
 * APPROVED   closed; changes only through a revision
 * REVISING   Head Nurse is revising an approved schedule within a declared date scope
 */
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const isScheduleStatus = (value: unknown): value is ScheduleStatus =>
  typeof value === "string" &&
  (SCHEDULE_STATUSES as readonly string[]).includes(value);

/** Statuses in which preference windows may be open (initial or reopened). */
export const PREFERENCE_WINDOW_STATUSES: readonly ScheduleStatus[] = [
  "PLANNING",
  "FINALIZED",
  "RETURNED",
  "REVISING",
];

export const acceptsPreferenceWindows = (status: ScheduleStatus): boolean =>
  PREFERENCE_WINDOW_STATUSES.includes(status);
