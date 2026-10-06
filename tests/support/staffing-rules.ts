import { isoDate, type IsoDate } from "../../src/domain/shared/dates";
import type {
  CoverageBounds,
  RuleSetContent,
  RuleSetStatus,
  RuleSetVersionHead,
} from "../../src/domain/staffing-rules/model";

/** Test data only. */
export const bounds = (
  min: number,
  max: number | null = null,
): CoverageBounds => ({
  min,
  max,
});

export const content = (
  overrides: Partial<RuleSetContent> = {},
): RuleSetContent => ({
  normal: { M: bounds(3, 6), E: bounds(3, 6), N: bounds(3, 6) },
  holiday: {},
  exceptions: [],
  ...overrides,
});

export const version = (
  id: string,
  options: {
    status?: RuleSetStatus;
    effectiveFrom?: string | null;
    departmentId?: string | null;
    ruleSetId?: string;
    versionNo?: number;
  } = {},
): RuleSetVersionHead => {
  const status = options.status ?? "PUBLISHED";
  const departmentId = options.departmentId ?? null;
  const effectiveFrom =
    options.effectiveFrom === undefined
      ? status === "DRAFT"
        ? null
        : "2026-01-01"
      : options.effectiveFrom;
  return {
    id,
    ruleSetId:
      options.ruleSetId ??
      (departmentId ? `rs-${departmentId}` : "rs-hospital"),
    departmentId,
    versionNo: options.versionNo ?? 1,
    status,
    effectiveFrom:
      effectiveFrom === null ? null : (isoDate(effectiveFrom) as IsoDate),
  };
};
