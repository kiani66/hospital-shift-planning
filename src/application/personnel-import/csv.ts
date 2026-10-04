/**
 * Minimal RFC 4180 CSV reader for files exported from Excel ("CSV UTF-8").
 * Pure and dependency-free. Handles a UTF-8 BOM, CRLF / LF / CR line ends,
 * quoted fields with embedded delimiters, line breaks and doubled quotes, and
 * detects the delimiter from the header line: comma, semicolon, tab or the
 * Arabic semicolon that Persian-locale Excel uses as its list separator.
 */

export const CSV_DELIMITERS = [",", ";", "\t", "؛"] as const;

export type CsvError = "EMPTY_FILE" | "UNTERMINATED_QUOTE";

export interface CsvRecord {
  /** 1-based line of the file where the record starts (what Excel users see). */
  readonly line: number;
  readonly cells: string[];
}

export type CsvResult =
  | { readonly ok: true; readonly records: CsvRecord[] }
  | { readonly ok: false; readonly error: CsvError };

/** The delimiter that splits the first line into the most fields (comma on ties). */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  let best: string = ",";
  let bestCount = 0;
  for (const delimiter of CSV_DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) count++;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string): CsvResult {
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  if (text.trim() === "") return { ok: false, error: "EMPTY_FILE" };
  const delimiter = detectDelimiter(text);

  const records: CsvRecord[] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, cells: record });
    record = [];
  };

  while (i < text.length) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += char;
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
      }
      i++;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) endField();
    else if (char === "\r" || char === "\n") {
      endRecord();
      if (char === "\r" && text[i + 1] === "\n") i++;
      line++;
      recordLine = line;
    } else field += char;
    i++;
  }
  if (quoted) return { ok: false, error: "UNTERMINATED_QUOTE" };
  if (field !== "" || record.length > 0) endRecord();
  // Excel writes blank lines (and lines of empty cells) at the end; drop them.
  return {
    ok: true,
    records: records.filter((r) => r.cells.some((cell) => cell.trim() !== "")),
  };
}
