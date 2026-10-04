import { describe, expect, it } from "vitest";

import { detectDelimiter, parseCsv } from "./csv";
import {
  analyzePersonnelCsv,
  candidateFromFields,
  decodeImportFile,
  IMPORT_LIMITS,
  normalizeHeader,
} from "./rows";

const cells = (text: string) => {
  const result = parseCsv(text);
  if (!result.ok) throw new Error(result.error);
  return result.records;
};

describe("parseCsv", () => {
  it("reads a UTF-8 BOM, CRLF lines and reports source lines", () => {
    expect(cells("﻿a,b\r\n1,2\r\n\r\n3,4\r\n")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["1", "2"] },
      { line: 4, cells: ["3", "4"] },
    ]);
  });

  it("handles quotes, embedded delimiters, doubled quotes and line breaks", () => {
    expect(cells('name,note\n"Doe, J","say ""hi""\nthere"\nx,y')).toEqual([
      { line: 1, cells: ["name", "note"] },
      { line: 2, cells: ["Doe, J", 'say "hi"\nthere'] },
      { line: 4, cells: ["x", "y"] },
    ]);
  });

  it("accepts LF and lone CR line ends and a missing final newline", () => {
    expect(cells("a\rb\nc")).toEqual([
      { line: 1, cells: ["a"] },
      { line: 2, cells: ["b"] },
      { line: 3, cells: ["c"] },
    ]);
  });

  it("drops rows of empty cells that Excel writes", () => {
    expect(cells("a,b\n,,\n ,\n1,2")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 4, cells: ["1", "2"] },
    ]);
  });

  it.each([
    [",", "a,b;c"],
    [";", "a;b;c,d"],
    ["\t", "a\tb\tc"],
    ["؛", "a؛b؛c"],
    [",", "single"],
    // A delimiter inside quotes does not count.
    [";", '"a,b";"c"'],
  ])("detects %j", (delimiter, firstLine) => {
    expect(detectDelimiter(firstLine)).toBe(delimiter);
  });

  it("splits Persian-locale files on the Arabic semicolon", () => {
    expect(cells("a؛b\n1؛2")).toEqual([
      { line: 1, cells: ["a", "b"] },
      { line: 2, cells: ["1", "2"] },
    ]);
  });

  it("reports empty files and unterminated quotes", () => {
    expect(parseCsv("﻿ \n")).toEqual({ ok: false, error: "EMPTY_FILE" });
    expect(parseCsv('a\n"open')).toEqual({
      ok: false,
      error: "UNTERMINATED_QUOTE",
    });
  });
});

describe("decodeImportFile", () => {
  it("decodes UTF-8 with a BOM kept for the parser", () => {
    const bytes = new TextEncoder().encode("﻿شماره پرسنلی");
    expect(decodeImportFile(bytes)).toEqual({
      ok: true,
      text: "﻿شماره پرسنلی",
    });
  });

  it("rejects invalid UTF-8 (e.g. Windows-1256) and oversize files", () => {
    expect(decodeImportFile(new Uint8Array([0xc7, 0xe1, 0xff]))).toEqual({
      ok: false,
      error: "NOT_UTF8",
    });
    expect(
      decodeImportFile(new Uint8Array(IMPORT_LIMITS.maxBytes + 1)),
    ).toEqual({ ok: false, error: "TOO_LARGE" });
  });
});

describe("analyzePersonnelCsv", () => {
  it("maps Persian and English headers and normalizes every field", () => {
    const result = analyzePersonnelCsv(
      "﻿ردیف,شماره پرسنلی,نام و نام خانوادگی,Email,موبایل,نقش\n" +
        "1,۰۰۱۲۵,  علي   كريمي ,Ali@Example.COM,+98 912 123 4567,سرپرستار\n" +
        "2,720,سارا,,,\n",
    );
    expect(result).toEqual({
      ok: true,
      candidates: [
        {
          line: 2,
          errors: [],
          person: {
            personnelNumber: "00125",
            displayName: "علی کریمی",
            email: "ali@example.com",
            mobile: "09121234567",
            role: "HEAD_NURSE",
          },
        },
        {
          line: 3,
          errors: [],
          person: {
            personnelNumber: "720",
            displayName: "سارا",
            email: null,
            mobile: null,
            role: "NURSE",
          },
        },
      ],
      raw: [
        {
          personnelNumber: "۰۰۱۲۵",
          displayName: "  علي   كريمي ",
          email: "Ali@Example.COM",
          mobile: "+98 912 123 4567",
          role: "سرپرستار",
        },
        {
          personnelNumber: "720",
          displayName: "سارا",
          email: "",
          mobile: "",
          role: "",
        },
      ],
      ignoredColumns: ["ردیف"],
    });
  });

  it("accepts English snake_case and spaced headers", () => {
    const result = analyzePersonnelCsv(
      "Personnel Number;DISPLAY_NAME;role\n9;Sara;HEAD_NURSE",
    );
    expect(result.ok && result.candidates[0]!.person).toMatchObject({
      personnelNumber: "9",
      role: "HEAD_NURSE",
    });
  });

  it("reports row-level errors without stopping at the first", () => {
    const result = analyzePersonnelCsv(
      "personnel_number,display_name,email,mobile,role\n" +
        "12-3,,bad,123,chief,extra\n" +
        "1,name,,,\n",
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.candidates[0]).toEqual({
      line: 2,
      person: null,
      errors: [
        "EXTRA_CELLS",
        "PERSONNEL_NUMBER_INVALID",
        "DISPLAY_NAME_REQUIRED",
        "EMAIL_INVALID",
        "MOBILE_INVALID",
        "ROLE_INVALID",
      ],
    });
    expect(result.candidates[1]!.errors).toEqual([]);
  });

  it("flags missing numbers and over-long names", () => {
    expect(candidateFromFields(9, { displayName: "x".repeat(201) })).toEqual({
      line: 9,
      person: null,
      errors: ["PERSONNEL_NUMBER_REQUIRED", "DISPLAY_NAME_TOO_LONG"],
    });
  });

  it.each([
    [
      "a credential column",
      "personnel_number,display_name,Password\n1,a,x",
      "CREDENTIAL_COLUMN",
    ],
    [
      "a Persian credential column",
      "شماره پرسنلی,نام کامل,رمز عبور\n1,a,x",
      "CREDENTIAL_COLUMN",
    ],
    [
      "a missing required column",
      "personnel_number,email\n1,a@x.invalid",
      "MISSING_REQUIRED_COLUMN",
    ],
    [
      "a duplicated column",
      "personnel_number,display_name,full_name\n1,a,b",
      "DUPLICATE_COLUMN",
    ],
    ["no data rows", "personnel_number,display_name\n", "NO_DATA_ROWS"],
    ["an empty file", "", "EMPTY_FILE"],
    [
      "a broken quote",
      'personnel_number,display_name\n1,"a',
      "UNTERMINATED_QUOTE",
    ],
  ])("rejects %s", (_name, text, error) => {
    expect(analyzePersonnelCsv(text)).toMatchObject({ ok: false, error });
  });

  it("names the missing and duplicated fields", () => {
    expect(analyzePersonnelCsv("email\na@x.invalid")).toEqual({
      ok: false,
      error: "MISSING_REQUIRED_COLUMN",
      fields: ["personnelNumber", "displayName"],
    });
  });

  it("enforces the row limit", () => {
    const rows = Array.from(
      { length: IMPORT_LIMITS.maxRows + 1 },
      (_, i) => `${i + 1},n${i}`,
    );
    expect(
      analyzePersonnelCsv(`personnel_number,display_name\n${rows.join("\n")}`),
    ).toEqual({ ok: false, error: "TOO_MANY_ROWS" });
    expect(
      analyzePersonnelCsv(
        `personnel_number,display_name\n${rows.slice(1).join("\n")}`,
      ).ok,
    ).toBe(true);
  });

  it("normalizes headers case-, spacing- and invisible-character-insensitively", () => {
    expect(normalizeHeader(" ‏Personnel-Number ")).toBe("personnel number");
  });
});
