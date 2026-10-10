import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Phase 2 change-request tables were renamed to legacy_* by migration
 * 0005 and kept as history storage only. No runtime code may depend on them:
 * only their schema definition (so drizzle-kit keeps tracking them), the
 * schema index and the development/test seed reset may refer to them.
 */
// Phase 14 explicitly permits dependency analysis and controlled pilot-reset cleanup.
const ALLOWED = new Set([
  "src/domain/reset/categories.ts",
  "src/domain/reset/plan.ts",
  "src/infrastructure/repositories/reset-inventory.ts",
  "src/infrastructure/repositories/monthly-reset.ts",
  "src/infrastructure/db/schema/legacy-change-requests.ts",
  "src/infrastructure/db/schema/enums.ts",
  "src/infrastructure/db/schema/index.ts",
  "src/infrastructure/db/seed/seed.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "migrations" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("legacy change-request schema", () => {
  it("is not referenced by any runtime code", () => {
    const offenders = sourceFiles("src")
      .map((path) => relative(process.cwd(), path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) =>
        /legacy_shift_change|legacyShiftChange|legacyChangeRequestStatus|legacy-change-requests/.test(
          readFileSync(path, "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
