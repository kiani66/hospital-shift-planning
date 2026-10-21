import { asc, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { sortByPersonnelOrder } from "../../domain/identity/personnel-order";

/** Lists are ordered by the shared domain policy once loaded (never by database default order). */
export function sortPeople<
  T extends {
    readonly personnelNumber: string | null;
    readonly displayName: string;
  },
>(rows: readonly T[], idOf: (row: T) => string): T[] {
  return sortByPersonnelOrder(rows, (r) => ({
    personnelNumber: r.personnelNumber,
    displayName: r.displayName,
    id: idOf(r),
  }));
}

/** Drops the number from a row that only needed it for ordering (the projection's shape is unchanged). */
export function withoutNumber<T extends { personnelNumber: string | null }>(
  row: T,
): Omit<T, "personnelNumber"> {
  const { personnelNumber: _omitted, ...rest } = row;
  return rest;
}

/**
 * SQL form of the same policy, for queries that page or limit in the database.
 * `users.personnel_number` is digits-only (check constraint), so numeric order is
 * (length without leading zeros, digits) and the original length breaks
 * leading-zero ties; missing last; then name and id, byte-wise like the domain
 * comparator. `tests/integration/personnel-order.test.ts` pins both to each other.
 */
export function personnelOrderBy(columns: {
  personnelNumber: AnyColumn;
  displayName: AnyColumn;
  id: AnyColumn;
}): SQL[] {
  const stripped = sql`ltrim(${columns.personnelNumber}, '0')`;
  return [
    asc(sql`${columns.personnelNumber} is null`),
    asc(sql`length(${stripped})`),
    asc(sql`${stripped} collate "C"`),
    asc(sql`length(${columns.personnelNumber})`),
    asc(sql`${columns.displayName} collate "C"`),
    asc(columns.id),
  ];
}
