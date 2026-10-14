import { Unzip, UnzipInflate, unzipSync, zipSync } from "fflate";

import {
  EXCEL_TEMPLATE_DAY_COLUMNS,
  cellAddress,
  columnIndex,
  columnLetters,
  resolveTemplateMapping,
  type ExcelTemplateMapping,
  type ResolvedTemplateMapping,
} from "../../domain/excel-export/template-mapping";
import { parsePersonnelNumber } from "../../domain/identity/personnel-number";
import { ValidationError } from "../../domain/shared/errors";
import { parseSpreadsheetDayCode } from "../../domain/shifts/spreadsheet-codes";

/**
 * The department's Excel export template as a package (D124).
 *
 * The workbook is never rebuilt by a spreadsheet library: a library round
 * trip rewrites styles, drops drawings and print settings it does not model,
 * and would silently change a hospital's print layout. Instead the ZIP parts
 * are kept as they are and only the `<c>` elements of the mapped day cells in
 * the mapped worksheet's XML are replaced. Fonts, borders, fills, merged
 * cells, hidden columns, formulas, print areas, margins, orientation, row
 * heights and column widths live outside those elements and are untouched.
 *
 * A template feature this approach cannot write around safely (a formula,
 * merge, table, array formula or locked cell in the mapped area; macros,
 * external links, embedded objects) is rejected with a message naming the
 * cell, never silently changed.
 */

export const EXCEL_TEMPLATE_LIMITS = {
  /** Upload size; a print template with a logo stays far below it. */
  maxBytes: 2 * 1024 * 1024,
  maxEntries: 512,
  /** Total actually inflated bytes, checked while inflating (ZIP bombs). */
  maxExpandedBytes: 48 * 1024 * 1024,
  /** Issues listed per check; the rest are counted. */
  maxIssues: 40,
};

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface TemplateIssue {
  /** Excel reference such as `M9`, when the problem has one. */
  readonly cell?: string;
  readonly message: string;
}

export interface TemplatePerson {
  readonly row: number;
  readonly cell: string;
  readonly personnelNumber: string;
}

/** Everything the mapping form shows before a template or mapping is activated. */
export interface TemplateInspection {
  readonly valid: boolean;
  readonly mapping: ResolvedTemplateMapping | null;
  /** The workbook's worksheet names, in workbook order. */
  readonly sheetNames: readonly string[];
  readonly errors: readonly TemplateIssue[];
  /** Rows ignored because their personnel cell holds no personnel number. */
  readonly warnings: readonly TemplateIssue[];
  /** Matched rows, in sheet order. */
  readonly personnel: readonly TemplatePerson[];
  /** e.g. `B7:B40`. */
  readonly personnelRange: string | null;
  /** e.g. `M7:AQ40`. */
  readonly dayRange: string | null;
  readonly personnelColumnHidden: boolean;
}

const fail = (message: string): never => {
  throw new ValidationError(message, "file", "EXCEL_TEMPLATE_FILE");
};

// ---------------------------------------------------------------- package

/** Parts that run code, reach outside the file or embed other documents. */
const FORBIDDEN_PARTS = [
  /(^|\/)vbaProject[^/]*\.bin$/i,
  /^xl\/externalLinks\//i,
  /^xl\/activeX\//i,
  /^xl\/embeddings\//i,
  /^xl\/connections\.xml$/i,
  /^xl\/queryTables\//i,
];

type Parts = Map<string, Uint8Array>;

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const text = (parts: Parts, name: string): string | null => {
  const bytes = parts.get(name);
  if (!bytes) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return fail("بخشی از فایل Excel متن معتبر UTF-8 نیست.");
  }
};

/**
 * Reads every part of the archive, bounding the work before any XML is read:
 * file size, entry count, declared and actually inflated sizes (an archive
 * can lie about the latter), duplicate names and forbidden parts.
 */
function readPackage(bytes: Uint8Array): Parts {
  if (!bytes.length) fail("فایل خالی است.");
  if (bytes.length > EXCEL_TEMPLATE_LIMITS.maxBytes)
    fail("حجم فایل قالب حداکثر ۲ مگابایت است.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    fail(
      "فقط فایل .xlsx پذیرفته می‌شود؛ فایل رمزدار یا قالب قدیمی .xls مجاز نیست.",
    );
  let entries = 0;
  let declared = 0;
  const names = new Set<string>();
  try {
    unzipSync(bytes, {
      filter(entry) {
        entries++;
        declared += entry.originalSize;
        if (
          entries > EXCEL_TEMPLATE_LIMITS.maxEntries ||
          declared > EXCEL_TEMPLATE_LIMITS.maxExpandedBytes
        )
          fail("تعداد بخش‌ها یا حجم بازشده فایل بیش از حد مجاز است.");
        if (names.has(entry.name)) fail("ساختار فایل Excel معتبر نیست.");
        if (FORBIDDEN_PARTS.some((p) => p.test(entry.name)))
          fail(
            "قالب دارای ماکرو، پیوند خارجی، اتصال داده یا شیء جاسازی‌شده است و پذیرفته نمی‌شود.",
          );
        names.add(entry.name);
        return false; // Directory only; nothing is inflated here.
      },
    });
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    fail("فایل Excel معتبر نیست.");
  }
  const parts: Parts = new Map();
  let inflated = 0;
  const unzip = new Unzip((entry) => {
    const chunks: Uint8Array[] = [];
    entry.ondata = (error, data, final) => {
      if (error) fail("فایل فشرده معتبر نیست.");
      inflated += data.length;
      if (inflated > EXCEL_TEMPLATE_LIMITS.maxExpandedBytes) {
        entry.terminate();
        fail("حجم واقعی بازشده فایل بیش از حد مجاز است.");
      }
      chunks.push(data);
      if (final) {
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          all.set(chunk, offset);
          offset += chunk.length;
        }
        parts.set(entry.name, all);
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  try {
    // Small compressed chunks bound the decoder's allocation between callbacks.
    for (let offset = 0; offset < bytes.length; offset += 16 * 1024)
      unzip.push(
        bytes.subarray(offset, offset + 16 * 1024),
        offset + 16 * 1024 >= bytes.length,
      );
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    fail("فایل فشرده معتبر نیست.");
  }
  if (parts.size !== names.size) fail("فایل فشرده معتبر نیست.");
  const contentTypes = text(parts, "[Content_Types].xml");
  if (contentTypes === null) fail("فایل Excel معتبر نیست.");
  if (/macroEnabled|vbaProject/i.test(contentTypes!))
    fail("قالب دارای ماکرو است و پذیرفته نمی‌شود.");
  for (const name of parts.keys())
    if (name.endsWith(".rels"))
      for (const rel of relationships(text(parts, name)!))
        if (rel.external && !rel.type.endsWith("/hyperlink"))
          fail(
            "قالب به فایل یا منبع خارجی پیوند دارد و پذیرفته نمی‌شود؛ پیوندهای خارجی را حذف کنید.",
          );
  return parts;
}

// -------------------------------------------------------------------- XML

const ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, code) => {
    const c = String(code);
    if (c[0] === "#") {
      const point =
        c[1] === "x" || c[1] === "X"
          ? parseInt(c.slice(2), 16)
          : parseInt(c.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match;
    }
    return ENTITIES[c] ?? match;
  });
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Attributes of an opening tag's attribute text, keyed by qualified name. */
function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const m of source.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result.set(m[1]!, decodeXml(m[2] ?? m[3] ?? ""));
  return result;
}

/** The value of the attribute whose local name is `local` (any prefix). */
function attributeByLocalName(
  attrs: Map<string, string>,
  local: string,
): string | undefined {
  for (const [name, value] of attrs)
    if (name === local || name.endsWith(`:${local}`)) return value;
  return undefined;
}

/** Elements `<prefix:name …/>` or `<prefix:name …>…</prefix:name>` (not nested in themselves). */
function elements(
  xml: string,
  name: string,
): { attrs: string; inner: string | null; index: number; raw: string }[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${name}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>)`,
    "g",
  );
  return [...xml.matchAll(pattern)].map((m) => ({
    attrs: m[1]!,
    inner: m[2] ?? null,
    index: m.index,
    raw: m[0],
  }));
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function relationships(xml: string | null): Relationship[] {
  if (xml === null) return [];
  return elements(xml, "Relationship").map((e) => {
    const a = attributes(e.attrs);
    return {
      id: a.get("Id") ?? "",
      type: a.get("Type") ?? "",
      target: a.get("Target") ?? "",
      external: a.get("TargetMode") === "External",
    };
  });
}

/** `xl/workbook.xml` + `worksheets/sheet1.xml` → `xl/worksheets/sheet1.xml`. */
function resolvePart(from: string, target: string): string {
  const segments = target.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const segment of target.replace(/^\//, "").split("/"))
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  return segments.join("/");
}

const relsPath = (part: string) => {
  const i = part.lastIndexOf("/");
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};

/** Text of a `<si>` or `<is>` element: its runs, without phonetic hints. */
function richText(inner: string): string {
  const visible = inner.replace(
    /<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh\s*>/g,
    "",
  );
  return elements(visible, "t")
    .map((t) => decodeXml(t.inner ?? ""))
    .join("");
}

// -------------------------------------------------------------- workbook

interface Range {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

function parseRef(ref: string): Range | null {
  const parse = (cell: string) => {
    const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(cell.trim());
    const column = m ? columnIndex(m[1]!) : null;
    return m && column ? { column, row: Number(m[2]) } : null;
  };
  const [a, b = a] = ref.split(":");
  const start = parse(a!);
  const end = parse(b!);
  if (!start || !end) return null;
  return {
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

const intersects = (a: Range, b: Range) =>
  a.left <= b.right &&
  b.left <= a.right &&
  a.top <= b.bottom &&
  b.top <= a.bottom;

const rangeRef = (r: Range) =>
  `${cellAddress(r.left, r.top)}:${cellAddress(r.right, r.bottom)}`;

interface Sheet {
  readonly name: string;
  readonly part: string;
}

interface Workbook {
  readonly parts: Parts;
  readonly workbookPart: string;
  readonly sheets: readonly Sheet[];
  readonly sharedStrings: readonly string[];
  readonly stylesPart: string | null;
}

function openWorkbook(bytes: Uint8Array): Workbook {
  const parts = readPackage(bytes);
  const office = relationships(text(parts, "_rels/.rels")).find((r) =>
    r.type.endsWith("/officeDocument"),
  );
  const workbookPart = office
    ? resolvePart("", office.target)
    : "xl/workbook.xml";
  const workbookXml = text(parts, workbookPart);
  if (workbookXml === null) fail("فایل Excel معتبر نیست؛ کارپوشه پیدا نشد.");
  const rels = relationships(text(parts, relsPath(workbookPart)));
  const sheets: Sheet[] = [];
  for (const e of elements(workbookXml!, "sheet")) {
    const a = attributes(e.attrs);
    const rel = rels.find((r) => r.id === attributeByLocalName(a, "id"));
    // Chart and dialog sheets have no cells to map.
    if (rel?.type.endsWith("/worksheet"))
      sheets.push({
        name: a.get("name") ?? "",
        part: resolvePart(workbookPart, rel.target),
      });
  }
  if (sheets.length === 0) fail("فایل Excel هیچ برگه‌ای ندارد.");
  const sstRel = rels.find((r) => r.type.endsWith("/sharedStrings"));
  const sstXml = sstRel
    ? text(parts, resolvePart(workbookPart, sstRel.target))
    : null;
  const sharedStrings = sstXml
    ? elements(sstXml, "si").map((si) => richText(si.inner ?? ""))
    : [];
  const stylesRel = rels.find((r) => r.type.endsWith("/styles"));
  return {
    parts,
    workbookPart,
    sheets,
    sharedStrings,
    stylesPart: stylesRel ? resolvePart(workbookPart, stylesRel.target) : null,
  };
}

/** Which cellXfs entries are locked (Excel's default for a protected sheet). */
function lockedStyles(workbook: Workbook): (index: number) => boolean {
  const styles = workbook.stylesPart
    ? text(workbook.parts, workbook.stylesPart)
    : null;
  const cellXfs = styles ? elements(styles, "cellXfs")[0]?.inner : undefined;
  const locked = (cellXfs ? elements(cellXfs, "xf") : []).map((xf) => {
    const protection = xf.inner ? elements(xf.inner, "protection")[0] : null;
    const value = protection
      ? attributes(protection.attrs).get("locked")
      : undefined;
    return !(value === "0" || value === "false");
  });
  return (index) => locked[index] ?? true;
}

// ----------------------------------------------------------------- cells

type CellValue =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly raw: string }
  | { readonly kind: "unsafe"; readonly what: string };

interface CellToken {
  readonly column: number | null;
  readonly attrs: Map<string, string>;
  readonly inner: string | null;
  readonly raw: string;
}

interface RowToken {
  readonly row: number | null;
  readonly attrs: Map<string, string>;
  readonly openTag: string;
  readonly inner: string | null;
  readonly raw: string;
  readonly index: number;
  readonly prefix: string;
}

function cellValue(
  cell: CellToken | undefined,
  shared: readonly string[],
): CellValue {
  if (!cell) return { kind: "empty" };
  const inner = cell.inner ?? "";
  if (/<(?:[\w.-]+:)?f(?=[\s/>])/.test(inner))
    return { kind: "unsafe", what: "فرمول" };
  if (cell.attrs.has("vm") || cell.attrs.has("cm"))
    return { kind: "unsafe", what: "داده پیشرفته" };
  const type = cell.attrs.get("t") ?? "n";
  const v = elements(inner, "v")[0];
  const raw = v ? decodeXml(v.inner ?? "") : "";
  switch (type) {
    case "s": {
      if (!v) return { kind: "empty" };
      const index = Number(raw);
      return Number.isInteger(index) && index >= 0 && index < shared.length
        ? ({ kind: "text", text: shared[index]! } as const)
        : { kind: "unsafe", what: "متن نامعتبر" };
    }
    case "inlineStr": {
      const is = elements(inner, "is")[0];
      return {
        kind: "text",
        text: is ? richText(is.inner ?? "") : "",
      };
    }
    case "n":
      return raw.trim() === ""
        ? ({ kind: "empty" } as const)
        : { kind: "number", raw: raw.trim() };
    case "b":
      return { kind: "unsafe", what: "مقدار منطقی" };
    case "e":
      return { kind: "unsafe", what: "خطای Excel" };
    case "d":
      return { kind: "unsafe", what: "تاریخ" };
    default:
      return { kind: "unsafe", what: "نوع داده ناشناخته" };
  }
}

function cellTokens(inner: string): CellToken[] {
  return elements(inner, "c").map((e) => {
    const attrs = attributes(e.attrs);
    const ref = attrs.get("r");
    const m = ref ? /^([A-Z]{1,3})\d+$/.exec(ref) : null;
    return {
      column: m ? columnIndex(m[1]!) : null,
      attrs,
      inner: e.inner,
      raw: e.raw,
    };
  });
}

interface SheetModel {
  readonly xml: string;
  /** Where `<sheetData>`'s content starts and ends in `xml`. */
  readonly dataStart: number;
  readonly dataEnd: number;
  readonly rows: readonly RowToken[];
  readonly columns: readonly {
    min: number;
    max: number;
    style: number | null;
    hidden: boolean;
  }[];
}

function readSheet(workbook: Workbook, sheet: Sheet): SheetModel {
  const xml = text(workbook.parts, sheet.part);
  if (xml === null) fail("برگه انتخاب‌شده در فایل پیدا نشد.");
  const data =
    /<((?:[\w.-]+:)?)sheetData\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1sheetData\s*>)/.exec(
      xml!,
    );
  if (!data) fail("برگه انتخاب‌شده ساختار جدول ندارد.");
  const content = data![2] ?? "";
  const dataStart = content
    ? data!.index + data![0].indexOf(">") + 1
    : data!.index;
  const rows = [
    ...content.matchAll(
      /<((?:[\w.-]+:)?)row(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/\1row\s*>)/g,
    ),
  ].map((m) => {
    const attrs = attributes(m[2]!);
    const r = Number(attrs.get("r"));
    return {
      row: Number.isInteger(r) && r > 0 ? r : null,
      attrs,
      openTag: `<${m[1]}row${m[2]}>`,
      inner: m[3] ?? null,
      raw: m[0],
      index: m.index,
      prefix: m[1]!,
    };
  });
  const cols = elements(xml!, "cols")[0]?.inner ?? "";
  const columns = elements(cols, "col").map((c) => {
    const a = attributes(c.attrs);
    const style = a.has("style") ? Number(a.get("style")) : null;
    return {
      min: Number(a.get("min")),
      max: Number(a.get("max")),
      style: Number.isInteger(style) ? style : null,
      hidden: a.get("hidden") === "1" || a.get("hidden") === "true",
    };
  });
  return {
    xml: xml!,
    dataStart,
    dataEnd: dataStart + content.length,
    rows,
    columns,
  };
}

// ------------------------------------------------------------ inspection

interface Analysis extends TemplateInspection {
  readonly workbook: Workbook | null;
  readonly sheet: Sheet | null;
  readonly model: SheetModel | null;
}

const MAX_SAFE_DIGITS = 15;

function analyse(
  bytes: Uint8Array,
  rawMapping: ExcelTemplateMapping,
): Analysis {
  const resolved = resolveTemplateMapping(rawMapping);
  const workbook = openWorkbook(bytes);
  const sheetNames = workbook.sheets.map((s) => s.name);
  const errors: TemplateIssue[] = [];
  const warnings: TemplateIssue[] = [];
  const empty = {
    workbook,
    sheet: null,
    model: null,
    sheetNames,
    personnel: [],
    personnelRange: null,
    dayRange: null,
    personnelColumnHidden: false,
    warnings,
  };
  if (!resolved.ok)
    return {
      ...empty,
      valid: false,
      mapping: null,
      errors: Object.values(resolved.error).map((message) => ({ message })),
    };
  const mapping = resolved.value;
  const sheet = workbook.sheets.find((s) => s.name === mapping.sheetName);
  if (!sheet)
    return {
      ...empty,
      valid: false,
      mapping,
      errors: [
        {
          message: `برگه «${mapping.sheetName}» در فایل نیست. برگه‌های موجود: ${sheetNames.join("، ")}`,
        },
      ],
    };
  const model = readSheet(workbook, sheet);
  const personnelArea: Range = {
    top: mapping.firstRow,
    bottom: mapping.lastRow,
    left: mapping.personnelColumnIndex,
    right: mapping.personnelColumnIndex,
  };
  const dayArea: Range = {
    top: mapping.firstRow,
    bottom: mapping.lastRow,
    left: mapping.firstDayColumnIndex,
    right: mapping.lastDayColumnIndex,
  };
  const add = (list: TemplateIssue[], issue: TemplateIssue) => {
    if (list.length < EXCEL_TEMPLATE_LIMITS.maxIssues) list.push(issue);
    else if (list.length === EXCEL_TEMPLATE_LIMITS.maxIssues)
      list.push({
        message: "موارد بیشتری هم وجود دارد؛ ابتدا این موارد را رفع کنید.",
      });
  };

  // Write targets must be plain cells: nothing spans, protects or computes them.
  const mapped = [
    { area: personnelArea, label: "ستون شماره پرسنلی" },
    { area: dayArea, label: "خانه‌های روزانه" },
  ];
  for (const merge of elements(model.xml, "mergeCell")) {
    const ref = attributes(merge.attrs).get("ref") ?? "";
    const range = parseRef(ref);
    for (const { area, label } of mapped)
      if (range && intersects(range, area))
        add(errors, {
          cell: ref,
          message: `خانه‌های ادغام‌شده ${ref} با ${label} هم‌پوشانی دارد؛ ادغام را از محدوده نگاشت بردارید.`,
        });
  }
  for (const f of elements(model.xml, "f")) {
    const ref = attributes(f.attrs).get("ref");
    const range = ref ? parseRef(ref) : null;
    if (range && mapped.some(({ area }) => intersects(range, area)))
      add(errors, {
        cell: ref,
        message: `فرمول آرایه‌ای یا مشترک ${ref} با محدوده نگاشت هم‌پوشانی دارد.`,
      });
  }
  const sheetRels = relationships(text(workbook.parts, relsPath(sheet.part)));
  for (const rel of sheetRels.filter((r) => r.type.endsWith("/table"))) {
    const tableXml = text(workbook.parts, resolvePart(sheet.part, rel.target));
    const table = tableXml ? elements(tableXml, "table")[0] : undefined;
    const ref = table ? attributes(table.attrs).get("ref") : undefined;
    const range = ref ? parseRef(ref) : null;
    if (range && mapped.some(({ area }) => intersects(range, area)))
      add(errors, {
        cell: ref,
        message: `جدول Excel در ${ref} با محدوده نگاشت هم‌پوشانی دارد؛ جدول را به محدوده عادی تبدیل کنید.`,
      });
  }
  if (model.rows.some((r) => r.row === null))
    add(errors, {
      message:
        "ردیف‌های برگه شماره ندارند؛ فایل را یک بار در Excel باز و ذخیره کنید.",
    });

  const protection = elements(model.xml, "sheetProtection")[0];
  const sheetValue = protection
    ? attributes(protection.attrs).get("sheet")
    : undefined;
  const isLocked =
    sheetValue === "1" || sheetValue === "true" ? lockedStyles(workbook) : null;

  const personnel: TemplatePerson[] = [];
  const seen = new Map<string, string>();
  const rowsByNumber = new Map(
    model.rows.filter((r) => r.row !== null).map((r) => [r.row!, r]),
  );
  for (let row = mapping.firstRow; row <= mapping.lastRow; row++) {
    const token = rowsByNumber.get(row);
    const cells = token?.inner ? cellTokens(token.inner) : [];
    if (cells.some((c) => c.column === null))
      add(errors, {
        message: `خانه‌های ردیف ${row} نشانی ندارند؛ فایل را یک بار در Excel باز و ذخیره کنید.`,
      });
    const byColumn = new Map(cells.map((c) => [c.column, c]));
    const personnelCell = cellAddress(mapping.personnelColumnIndex, row);
    const identity = cellValue(
      byColumn.get(mapping.personnelColumnIndex),
      workbook.sharedStrings,
    );
    let number: string | null = null;
    if (identity.kind === "unsafe")
      add(errors, {
        cell: personnelCell,
        message: `خانه شماره پرسنلی ${personnelCell} ${identity.what} دارد؛ شماره را به صورت مقدار ساده وارد کنید.`,
      });
    else if (identity.kind === "number") {
      if (!/^\d+$/.test(identity.raw))
        add(errors, {
          cell: personnelCell,
          message: `شماره پرسنلی ${personnelCell} عدد صحیح نیست (${identity.raw}).`,
        });
      else if (identity.raw.length > MAX_SAFE_DIGITS)
        add(errors, {
          cell: personnelCell,
          message: `شماره پرسنلی ${personnelCell} بیش از ۱۵ رقم دارد و Excel آن را دقیق نگه نمی‌دارد؛ آن را به صورت متن ذخیره کنید.`,
        });
      else number = identity.raw;
    } else if (identity.kind === "text" && identity.text.trim() !== "") {
      const parsed = parsePersonnelNumber(identity.text);
      if (parsed.ok) number = parsed.value;
      else
        add(warnings, {
          cell: personnelCell,
          message: `ردیف ${row} نادیده گرفته می‌شود: «${identity.text.trim().slice(0, 40)}» شماره پرسنلی نیست.`,
        });
    }
    if (number !== null) {
      const previous = seen.get(number);
      if (previous)
        add(errors, {
          cell: personnelCell,
          message: `شماره پرسنلی ${number} در ${previous} و ${personnelCell} تکرار شده است.`,
        });
      else {
        seen.set(number, personnelCell);
        personnel.push({ row, cell: personnelCell, personnelNumber: number });
      }
    }
    for (
      let column = mapping.firstDayColumnIndex;
      column <= mapping.lastDayColumnIndex;
      column++
    ) {
      const address = cellAddress(column, row);
      const value = cellValue(byColumn.get(column), workbook.sharedStrings);
      if (value.kind === "unsafe") {
        add(errors, {
          cell: address,
          message: `خانه روزانه ${address} ${value.what} دارد و بازنویسی آن مجاز نیست.`,
        });
        continue;
      }
      const shown =
        value.kind === "text"
          ? value.text.trim()
          : value.kind === "number"
            ? value.raw
            : "";
      if (shown === "") {
        if (
          number !== null &&
          isLocked?.(effectiveStyle(model, token, byColumn.get(column), column))
        )
          add(errors, {
            cell: address,
            message: `برگه محافظت‌شده است و خانه ${address} قفل است؛ قفل خانه‌های روزانه را بردارید.`,
          });
        continue;
      }
      if (number === null)
        add(errors, {
          cell: address,
          message: `ردیف ${row} شماره پرسنلی ندارد ولی خانه ${address} مقدار «${shown.slice(0, 20)}» دارد؛ محدوده ردیف‌ها یا ستون روز اول را بررسی کنید.`,
        });
      // A previous export's codes are cleared; anything else means a wrong mapping.
      else if (value.kind !== "text" || !parseSpreadsheetDayCode(shown).ok)
        add(errors, {
          cell: address,
          message: `خانه روزانه ${address} مقدار «${shown.slice(0, 20)}» دارد؛ خانه‌های روزانه باید خالی یا کد شیفت باشند. ستون روز اول را بررسی کنید.`,
        });
      else if (
        isLocked?.(effectiveStyle(model, token, byColumn.get(column), column))
      )
        add(errors, {
          cell: address,
          message: `برگه محافظت‌شده است و خانه ${address} قفل است؛ قفل خانه‌های روزانه را بردارید.`,
        });
    }
  }
  if (personnel.length === 0 && errors.length === 0)
    add(errors, {
      cell: rangeRef(personnelArea),
      message: `هیچ شماره پرسنلی در ${rangeRef(personnelArea)} پیدا نشد.`,
    });
  const personnelColumnHidden = model.columns.some(
    (c) =>
      c.hidden &&
      c.min <= mapping.personnelColumnIndex &&
      mapping.personnelColumnIndex <= c.max,
  );
  return {
    workbook,
    sheet,
    model,
    valid: errors.length === 0,
    mapping,
    sheetNames,
    errors,
    warnings,
    personnel,
    personnelRange: rangeRef(personnelArea),
    dayRange: rangeRef(dayArea),
    personnelColumnHidden,
  };
}

/** The style a new cell gets: the row's custom style, else its column's, else none. */
function effectiveStyle(
  model: SheetModel,
  row: RowToken | undefined,
  cell: CellToken | undefined,
  column: number,
): number {
  if (cell) return Number(cell.attrs.get("s") ?? 0) || 0;
  const rowStyle =
    row &&
    (row.attrs.get("customFormat") === "1" ||
      row.attrs.get("customFormat") === "true")
      ? Number(row.attrs.get("s"))
      : NaN;
  if (Number.isInteger(rowStyle)) return rowStyle;
  return (
    model.columns.find((c) => c.min <= column && column <= c.max)?.style ?? 0
  );
}

/**
 * Validates a template against a mapping (D124). Package-level problems
 * (not an xlsx, too large, macros, external links) throw a ValidationError;
 * mapping and cell problems are returned with their cell references so the
 * form can list them all.
 */
export function inspectExcelTemplate(
  bytes: Uint8Array,
  mapping: ExcelTemplateMapping,
): TemplateInspection {
  const analysis = analyse(bytes, mapping);
  return {
    valid: analysis.valid,
    mapping: analysis.mapping,
    sheetNames: analysis.sheetNames,
    errors: analysis.errors,
    warnings: analysis.warnings,
    personnel: analysis.personnel,
    personnelRange: analysis.personnelRange,
    dayRange: analysis.dayRange,
    personnelColumnHidden: analysis.personnelColumnHidden,
  };
}

// ----------------------------------------------------------------- write

/**
 * A new workbook from the template with the day cells of every matched row
 * replaced by `values` (31 entries; null leaves the cell blank). Rows whose
 * personnel number has no entry are cleared. Only those cells change; the
 * template bytes passed in are not modified.
 */
export function populateExcelTemplate(
  bytes: Uint8Array,
  mapping: ExcelTemplateMapping,
  values: ReadonlyMap<string, readonly (string | null)[]>,
): Uint8Array {
  const analysis = analyse(bytes, mapping);
  if (!analysis.valid)
    throw new ValidationError(
      `قالب Excel معتبر نیست: ${analysis.errors[0]!.message}`,
      "template",
      "EXCEL_TEMPLATE_INVALID",
    );
  const { workbook, sheet, model } = analysis;
  const m = analysis.mapping!;
  const people = new Map(
    analysis.personnel.map((p) => [p.row, p.personnelNumber]),
  );
  for (const v of values.values())
    if (v.length !== EXCEL_TEMPLATE_DAY_COLUMNS)
      throw new RangeError("Each person needs 31 day values");

  const content = model!.xml.slice(model!.dataStart, model!.dataEnd);
  let rebuilt = "";
  let cursor = 0;
  for (const row of model!.rows) {
    const number = row.row === null ? undefined : people.get(row.row);
    if (number === undefined) continue;
    rebuilt += content.slice(cursor, row.index);
    rebuilt += rewriteRow(
      model!,
      row,
      m,
      values.get(number) ?? Array(EXCEL_TEMPLATE_DAY_COLUMNS).fill(null),
    );
    cursor = row.index + row.raw.length;
  }
  rebuilt += content.slice(cursor);
  const sheetXml =
    model!.xml.slice(0, model!.dataStart) +
    rebuilt +
    model!.xml.slice(model!.dataEnd);

  const output = new Map(workbook!.parts);
  output.set(sheet!.part, encoder.encode(sheetXml));
  // Summaries the hospital keeps as formulas must reflect the new codes on open.
  const hasFormulas = workbook!.sheets.some((s) =>
    /<(?:[\w.-]+:)?f(?=[\s/>])/.test(text(workbook!.parts, s.part) ?? ""),
  );
  if (hasFormulas) {
    const workbookXml = text(workbook!.parts, workbook!.workbookPart)!;
    output.set(
      workbook!.workbookPart,
      encoder.encode(recalculateOnLoad(workbookXml)),
    );
  }
  return zipSync(
    Object.fromEntries(
      [...output].map(([name, data]) => [name, [data, { level: 6 }]]),
    ),
  );
}

function rewriteRow(
  model: SheetModel,
  row: RowToken,
  mapping: ResolvedTemplateMapping,
  values: readonly (string | null)[],
): string {
  const p = row.prefix;
  const cells = cellTokens(row.inner ?? "");
  const byColumn = new Map(cells.map((c) => [c.column, c]));
  const isDay = (column: number | null) =>
    column !== null &&
    column >= mapping.firstDayColumnIndex &&
    column <= mapping.lastDayColumnIndex;
  let inserted = false;
  const dayCells: string[] = [];
  for (let i = 0; i < EXCEL_TEMPLATE_DAY_COLUMNS; i++) {
    const column = mapping.firstDayColumnIndex + i;
    const existing = byColumn.get(column);
    const ref = `${columnLetters(column)}${row.row}`;
    const value = values[i];
    if (value === null || value === undefined) {
      // A cleared cell keeps its own style; an absent one stays absent.
      if (existing) {
        const s = existing.attrs.get("s");
        dayCells.push(`<${p}c r="${ref}"${s ? ` s="${s}"` : ""}/>`);
      }
      continue;
    }
    // A new cell takes the style Excel itself would give it (row, then column).
    const style = existing
      ? existing.attrs.get("s")
      : String(effectiveStyle(model, row, undefined, column));
    if (!existing) inserted = true;
    dayCells.push(
      `<${p}c r="${ref}"${style && style !== "0" ? ` s="${style}"` : ""} t="inlineStr"><${p}is><${p}t>${escapeXml(value)}</${p}t></${p}is></${p}c>`,
    );
  }
  // Rebuild the row's content: other cells and elements stay byte for byte.
  const inner = row.inner ?? "";
  const tokens: { column: number | null; text: string; cell: boolean }[] = [];
  let last = 0;
  for (const m of inner.matchAll(
    /<(?:[\w.-]+:)?c(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?c\s*>)/g,
  )) {
    if (m.index > last)
      tokens.push({
        column: null,
        text: inner.slice(last, m.index),
        cell: false,
      });
    const ref = attributes(m[1]!).get("r") ?? "";
    const letters = /^([A-Z]{1,3})\d+$/.exec(ref)?.[1];
    tokens.push({
      column: letters ? columnIndex(letters) : null,
      text: m[0],
      cell: true,
    });
    last = m.index + m[0].length;
  }
  if (last < inner.length)
    tokens.push({ column: null, text: inner.slice(last), cell: false });
  const kept = tokens.filter((t) => !(t.cell && isDay(t.column)));
  let at = -1;
  kept.forEach((t, i) => {
    if (t.cell && t.column! < mapping.firstDayColumnIndex) at = i;
  });
  const insertAt =
    at >= 0
      ? at + 1
      : Math.max(
          0,
          kept.findIndex((t) => t.cell),
        );
  kept.splice(insertAt, 0, {
    column: null,
    text: dayCells.join(""),
    cell: false,
  });
  // `spans` is an optional hint; drop it rather than let it go stale.
  const openTag = inserted
    ? row.openTag.replace(/\sspans\s*=\s*("[^"]*"|'[^']*')/, "")
    : row.openTag;
  return `${openTag}${kept.map((t) => t.text).join("")}</${p}row>`;
}

/** Sets `fullCalcOnLoad` so Excel recalculates formulas when it opens the file. */
function recalculateOnLoad(xml: string): string {
  const calc = /<((?:[\w.-]+:)?)calcPr\b([^>]*?)(\/?)>/.exec(xml);
  if (calc) {
    const attrs = calc[2]!.replace(
      /\sfullCalcOnLoad\s*=\s*("[^"]*"|'[^']*')/,
      "",
    );
    return (
      xml.slice(0, calc.index) +
      `<${calc[1]}calcPr${attrs} fullCalcOnLoad="1"${calc[3]}>` +
      xml.slice(calc.index + calc[0].length)
    );
  }
  // CT_Workbook order: calcPr follows definedNames (or sheets when there are none).
  for (const after of ["definedNames", "sheets"]) {
    const end = new RegExp(`</((?:[\\w.-]+:)?)${after}\\s*>`).exec(xml);
    if (end)
      return (
        xml.slice(0, end.index + end[0].length) +
        `<${end[1]}calcPr fullCalcOnLoad="1"/>` +
        xml.slice(end.index + end[0].length)
      );
  }
  return xml;
}
