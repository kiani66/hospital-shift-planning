import { z } from "zod";

import type { MembershipRole } from "../../domain/authz/actor";
import { parseOptionalMobileNumber } from "../../domain/identity/mobile";
import {
  normalizeDisplayName,
  normalizeIdentifierText,
} from "../../domain/identity/normalize";
import { parsePersonnelNumber } from "../../domain/identity/personnel-number";
import type {
  CandidateRow,
  ImportField,
  ImportRowError,
} from "../../domain/management/personnel-import";
import { parseCsv, type CsvError } from "./csv";

/** Safe defaults (Decision 5). Enforced on the server, mirrored in the UI. */
export const IMPORT_LIMITS = { maxBytes: 256 * 1024, maxRows: 500 } as const;

/**
 * Documented column headers (Persian or English, any case; spaces,
 * underscores and hyphens are equivalent). Required: personnel number and
 * name. Other columns are reported as ignored, never guessed.
 */
export const IMPORT_HEADERS: Readonly<Record<ImportField, readonly string[]>> =
  {
    personnelNumber: [
      "personnel_number",
      "personnel_no",
      "شماره پرسنلی",
      "کد پرسنلی",
    ],
    displayName: [
      "display_name",
      "full_name",
      "name",
      "نام و نام خانوادگی",
      "نام کامل",
    ],
    email: ["email", "e_mail", "ایمیل", "پست الکترونیک"],
    mobile: ["mobile", "mobile_number", "موبایل", "شماره موبایل", "تلفن همراه"],
    role: ["role", "نقش"],
  };

const REQUIRED_FIELDS: readonly ImportField[] = [
  "personnelNumber",
  "displayName",
];

/** Any header that looks like a credential rejects the whole file. */
const CREDENTIAL_HEADER =
  /pass|pwd|secret|token|رمز|گذرواژه|کلمه[\s\u200c]*عبور/i;

export const normalizeHeader = (header: string): string =>
  normalizeDisplayName(normalizeIdentifierText(header))
    .toLowerCase()
    .replace(/[\s_\-]+/g, " ")
    .trim();

const HEADER_LOOKUP = new Map<string, ImportField>(
  (
    Object.entries(IMPORT_HEADERS) as [ImportField, readonly string[]][]
  ).flatMap(([field, aliases]) =>
    aliases.map((a) => [normalizeHeader(a), field] as const),
  ),
);

const ROLE_VALUES = new Map<string, MembershipRole>([
  ["", "NURSE"],
  ["nurse", "NURSE"],
  ["پرستار", "NURSE"],
  ["head nurse", "HEAD_NURSE"],
  ["headnurse", "HEAD_NURSE"],
  ["سرپرستار", "HEAD_NURSE"],
]);

export type ImportFileError =
  | CsvError
  | "NOT_UTF8"
  | "TOO_LARGE"
  | "TOO_MANY_ROWS"
  | "NO_DATA_ROWS"
  | "MISSING_REQUIRED_COLUMN"
  | "DUPLICATE_COLUMN"
  | "CREDENTIAL_COLUMN";

export type AnalyzedFile =
  | {
      readonly ok: true;
      readonly candidates: CandidateRow[];
      /** The cells as written, per data row (same order), for the preview. */
      readonly raw: Partial<Record<ImportField, string>>[];
      /** Original headers of columns that were not used. */
      readonly ignoredColumns: string[];
    }
  | {
      readonly ok: false;
      readonly error: ImportFileError;
      /** For MISSING_REQUIRED_COLUMN / DUPLICATE_COLUMN. */
      readonly fields?: ImportField[];
    };

/** Decodes uploaded bytes as strict UTF-8 (a BOM is allowed and removed later). */
export function decodeImportFile(
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; error: ImportFileError } {
  if (bytes.byteLength > IMPORT_LIMITS.maxBytes)
    return { ok: false, error: "TOO_LARGE" };
  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
    };
  } catch {
    return { ok: false, error: "NOT_UTF8" };
  }
}

const emailSchema = z.email().max(320);

function rowFields(
  cells: string[],
  columns: (ImportField | null)[],
): Partial<Record<ImportField, string>> {
  const raw: Partial<Record<ImportField, string>> = {};
  cells.forEach((cell, index) => {
    const field = columns[index];
    if (field) raw[field] = cell;
  });
  return raw;
}

function normalizeRow(
  line: number,
  cells: string[],
  columns: (ImportField | null)[],
): CandidateRow {
  const raw: Partial<Record<ImportField, string>> = {};
  let extraCells = false;
  cells.forEach((cell, index) => {
    const field = columns[index];
    if (field) raw[field] = cell;
    else if (index >= columns.length && cell.trim() !== "") extraCells = true;
  });
  return candidateFromFields(line, raw, extraCells ? ["EXTRA_CELLS"] : []);
}

/**
 * Validates and normalizes one person's fields (from a CSV row, or from the
 * rows a preview returned, which the commit re-validates: the client is
 * never trusted).
 */
export function candidateFromFields(
  line: number,
  raw: Partial<Record<ImportField, string | null>>,
  initialErrors: ImportRowError[] = [],
): CandidateRow {
  const errors: ImportRowError[] = [...initialErrors];

  const number = parsePersonnelNumber(raw.personnelNumber ?? "");
  if (!number.ok)
    errors.push(number.error.reason as "PERSONNEL_NUMBER_REQUIRED");

  const displayName = normalizeDisplayName(raw.displayName ?? "");
  if (displayName === "") errors.push("DISPLAY_NAME_REQUIRED");
  else if (displayName.length > 200) errors.push("DISPLAY_NAME_TOO_LONG");

  const emailText = normalizeIdentifierText(raw.email ?? "").toLowerCase();
  const email = emailText === "" ? null : emailText;
  if (email !== null && !emailSchema.safeParse(email).success)
    errors.push("EMAIL_INVALID");

  const mobile = parseOptionalMobileNumber(raw.mobile ?? null);
  if (!mobile.ok) errors.push("MOBILE_INVALID");

  const role = ROLE_VALUES.get(normalizeHeader(raw.role ?? ""));
  if (!role) errors.push("ROLE_INVALID");

  return {
    line,
    person:
      number.ok && mobile.ok && role && errors.length === 0
        ? {
            personnelNumber: number.value,
            displayName,
            email,
            mobile: mobile.value,
            role,
          }
        : null,
    errors: [...new Set(errors)],
  };
}

/** Parses CSV text and normalizes every data row; no database access. */
export function analyzePersonnelCsv(text: string): AnalyzedFile {
  const parsed = parseCsv(text);
  if (!parsed.ok) return parsed;
  const [header, ...rows] = parsed.records;
  if (!header) return { ok: false, error: "EMPTY_FILE" };
  if (header.cells.some((h) => CREDENTIAL_HEADER.test(h)))
    return { ok: false, error: "CREDENTIAL_COLUMN" };

  const columns = header.cells.map(
    (h) => HEADER_LOOKUP.get(normalizeHeader(h)) ?? null,
  );
  const used = columns.filter((c): c is ImportField => c !== null);
  const duplicated = used.filter((c, i) => used.indexOf(c) !== i);
  if (duplicated.length > 0)
    return {
      ok: false,
      error: "DUPLICATE_COLUMN",
      fields: [...new Set(duplicated)],
    };
  const missing = REQUIRED_FIELDS.filter((f) => !used.includes(f));
  if (missing.length > 0)
    return { ok: false, error: "MISSING_REQUIRED_COLUMN", fields: missing };
  if (rows.length === 0) return { ok: false, error: "NO_DATA_ROWS" };
  if (rows.length > IMPORT_LIMITS.maxRows)
    return { ok: false, error: "TOO_MANY_ROWS" };

  return {
    ok: true,
    candidates: rows.map((r) => normalizeRow(r.line, r.cells, columns)),
    raw: rows.map((r) => rowFields(r.cells, columns)),
    ignoredColumns: header.cells.filter(
      (h, i) => columns[i] === null && h.trim() !== "",
    ),
  };
}
