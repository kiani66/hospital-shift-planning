import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MIGRATIONS_FOLDER } from "../../src/infrastructure/db/migrate";

/**
 * Migration history guard.
 *
 * drizzle applies a migration when its journal timestamp is newer than the newest
 * applied one, and never compares file contents. Editing a migration that any
 * database already applied (or moving its timestamp) therefore either re-runs it
 * ("relation already exists") or is silently ignored. Once a migration has been
 * released (merged to main or deployed to any Preview), it is frozen: this table
 * pins its journal timestamp and the SHA-256 of its SQL file. Fix mistakes in a
 * new migration instead (see 0019). Append a row when a migration is released.
 */
const RELEASED: readonly (readonly [number, string, number, string])[] = [
  [
    0,
    "0000_baseline",
    1790678067303,
    "3ecff656a4096ed1114f26d6f85fc4c0e029b15197b8ed455672087757ebd4fc",
  ],
  [
    1,
    "0001_initial_schema",
    1790689036738,
    "df0954ffe60c63166eb6879cce0f533231ce2c0a9109b3bacaac98aa26b2f263",
  ],
  [
    2,
    "0002_shift_types_reference_data",
    1790689051972,
    "639bc9a279547374c402e192078470fe94a4c699923497a52aeca1e25ed707db",
  ],
  [
    3,
    "0003_no_overlapping_periods",
    1790695719825,
    "3236485ade627f2c5e803f215bcf299cfeb06ab4a71cf1ef5bd73ef327aa7b53",
  ],
  [
    4,
    "0004_login_throttles",
    1790697451048,
    "3bcbb6d9e48273f7d963b040aeb130381c8187c5fc5b743bca4161593fd920dc",
  ],
  [
    5,
    "0005_legacy_change_requests",
    1790857475738,
    "af8e33adeb18f94ebcbf555ee1b57fef3f132e9b34cb56496eccf5a999939087",
  ],
  [
    6,
    "0006_shift_change_requests",
    1790857567978,
    "fca537119c00268ce81aace706256089ec2812f1fe6656ae7148b423f86bb3ac",
  ],
  [
    7,
    "0007_change_reasons_reference_data",
    1790857578348,
    "4d90a9399f861e74b431faad11ec9d783ecccff1a1fc02d1ebfa3208738e4fd1",
  ],
  [
    8,
    "0008_hospital_admin",
    1791012736492,
    "30c514dc94789a55831d9a2c5b612c1ea92100ad8f5757d06d5e3269f1a799a5",
  ],
  [
    9,
    "0009_personnel_identity",
    1791101136949,
    "0d80b084fd7dc97512b709f6a0a65658eeaf85d8ce935ed9108ca3aef1136330",
  ],
  [
    10,
    "0010_explicit_off",
    1791190800000,
    "9c159850e41fca68e345a51abac0c92494f42ac5fb596d1b559091a5b4a78304",
  ],
  [
    11,
    "0011_staffing_rule_sets",
    1791291354768,
    "3c66031017d37cecc57927ba429575c48410bf48cd705961b4fa0ec9d7517545",
  ],
  [
    12,
    "0012_shift_type_long_label",
    1791463286825,
    "359f189138de8ecf5cdac214bf9c03ff0c8d15f7ce935f9f17334026bcbf85bb",
  ],
  [
    13,
    "0013_reset_operations",
    1791613752967,
    "7da30ca5c06a19df98930b78712205cdf6d32ae46b3aa5340ffa04e1b54a2a40",
  ],
  [
    14,
    "0014_leave_day",
    1791890636596,
    "9d165df333ad4195e638009ceb5e8a004f62876c55f9bc394c2ae8cd776823f8",
  ],
  [
    15,
    "0015_secretary",
    1791909797253,
    "4dc38aa120be23b2a3d75e71ed81c8e88a90a33ea74407c75310b581194ce190",
  ],
  [
    16,
    "0016_excel_export_templates",
    1791995851701,
    "01e6053f97aa23dcc79d59a6fad9f0ded07a6024690a1e467d94afeb25cace21",
  ],
  [
    17,
    "0017_excel_template_statistics",
    1792218374450,
    "1eea55ac9ead056345beb7c9d0945763dc04edd605485d33ad32e95ed829c141",
  ],
  [
    18,
    "0018_excel_template_calendar",
    1792223187862,
    "2f3f2d42a983453f5142d17557c192c3f76f3908965a34d5151208ae2e4291de",
  ],
];

type JournalEntry = { idx: number; tag: string; when: number };

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
).entries as JournalEntry[];

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

describe("migration history", () => {
  it.each(RELEASED)(
    "released migration %i (%s) is unchanged",
    (idx, tag, when, hash) => {
      expect(journal[idx]).toMatchObject({ idx, tag, when });
      expect(sha256(join(MIGRATIONS_FOLDER, `${tag}.sql`))).toBe(hash);
    },
  );

  it("only appends after the released migrations", () => {
    expect(journal.length).toBeGreaterThanOrEqual(RELEASED.length);
    expect(journal.slice(0, RELEASED.length).map((e) => e.tag)).toEqual(
      RELEASED.map(([, tag]) => tag),
    );
  });

  it("has contiguous indexes and strictly increasing timestamps", () => {
    journal.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(journal[i - 1]!.when);
    });
  });

  it("has exactly one SQL file and one snapshot per journal entry", () => {
    const sqlFiles = readdirSync(MIGRATIONS_FOLDER)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    expect(sqlFiles).toEqual(journal.map((e) => `${e.tag}.sql`).sort());
    const snapshots = readdirSync(join(MIGRATIONS_FOLDER, "meta"))
      .filter((name) => name.endsWith("_snapshot.json"))
      .sort();
    expect(snapshots).toEqual(
      journal.map((e) => `${String(e.idx).padStart(4, "0")}_snapshot.json`),
    );
  });

  it("chains every snapshot to the previous one", () => {
    let previousId: string | undefined;
    for (const entry of journal) {
      const snapshot = JSON.parse(
        readFileSync(
          join(
            MIGRATIONS_FOLDER,
            "meta",
            `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
          ),
          "utf8",
        ),
      ) as { id: string; prevId: string };
      if (previousId !== undefined) expect(snapshot.prevId).toBe(previousId);
      previousId = snapshot.id;
    }
  });
});
