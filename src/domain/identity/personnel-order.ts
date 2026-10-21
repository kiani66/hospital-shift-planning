import { normalizeDisplayName, normalizeIdentifierText } from "./normalize";

/**
 * The one personnel ordering policy (approved: Personnel Number ascending is the
 * default for every personnel list). Pure and locale-independent, so the server,
 * the browser and tests always agree.
 *
 * 1. Personnel number, ascending. Persian/Arabic digits and invisible
 *    characters are normalized first. Digit runs compare by numeric value
 *    (`2 < 9 < 10 < 100`) without Number precision limits; other text compares
 *    case-insensitively by code unit ("natural" order for alphanumerics, e.g.
 *    `A2 < A10`). Numeric values equal only up to leading zeros order the
 *    shorter text first (`7 < 07 < 007`), so the order is total and stable.
 * 2. Missing or blank numbers last.
 * 3. Tie-breakers: display name (the only name field the model has, compared
 *    after display-name normalization), then the immutable user id.
 *
 * Sorting never changes the stored or displayed number, so leading zeros survive.
 */
export interface PersonnelOrderKey {
  readonly personnelNumber?: string | null;
  readonly displayName?: string | null;
  /** Immutable user id; the final tie-breaker. */
  readonly id: string;
}

const CHUNK = /[0-9]+|[^0-9]+/g;
const DIGIT = /^[0-9]/;

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Normalized number, or null when missing/blank. */
export function normalizePersonnelNumberForOrder(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeIdentifierText(value ?? "");
  return normalized === "" ? null : normalized;
}

function compareDigitRuns(a: string, b: string): number {
  const x = a.replace(/^0+/, "");
  const y = b.replace(/^0+/, "");
  // Equal length compares digit by digit, which is numeric order.
  return x.length - y.length || compareText(x, y) || a.length - b.length;
}

/** Natural comparison of two normalized, non-empty personnel numbers. */
function compareNumbers(a: string, b: string): number {
  const x = a.match(CHUNK)!;
  const y = b.match(CHUNK)!;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const p = x[i]!;
    const q = y[i]!;
    // A chunk is all digits or none, so its first character tells which.
    const c =
      DIGIT.test(p) && DIGIT.test(q)
        ? compareDigitRuns(p, q)
        : compareText(p.toLowerCase(), q.toLowerCase());
    if (c !== 0) return c;
  }
  return x.length - y.length || compareText(a, b);
}

/** Personnel-number-ascending comparator with the documented tie-breakers. */
export function comparePersonnelOrder(
  a: PersonnelOrderKey,
  b: PersonnelOrderKey,
): number {
  const x = normalizePersonnelNumberForOrder(a.personnelNumber);
  const y = normalizePersonnelNumberForOrder(b.personnelNumber);
  if (x !== y) {
    if (x === null) return 1;
    if (y === null) return -1;
    return compareNumbers(x, y);
  }
  return (
    compareText(
      normalizeDisplayName(a.displayName ?? ""),
      normalizeDisplayName(b.displayName ?? ""),
    ) || compareText(a.id, b.id)
  );
}

/** A new array in personnel order; the input is untouched. */
export function sortByPersonnelOrder<T>(
  items: readonly T[],
  key: (item: T) => PersonnelOrderKey,
): T[] {
  return items.toSorted((a, b) => comparePersonnelOrder(key(a), key(b)));
}
