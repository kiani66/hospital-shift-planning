import { Unzip, UnzipInflate, unzipSync, zipSync } from "fflate";

import {
  EXCEL_MAX_ROW,
  EXCEL_TEMPLATE_DAY_COLUMNS,
  EXCEL_TEMPLATE_MAX_PERSONNEL_ROWS,
  EXCEL_UNDECIDED_VALUE,
  cellAddress,
  columnIndex,
  columnLetters,
  resolveTemplateMapping,
  type ExcelTemplateMapping,
  type ExportCellValue,
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
  /** The sheet's print area, e.g. `A1:AP30`; null when none is set. */
  readonly printArea: string | null;
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
  /** Position among all the workbook's sheets (`localSheetId` of defined names). */
  readonly index: number;
}

interface Workbook {
  readonly parts: Parts;
  readonly workbookPart: string;
  readonly workbookXml: string;
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
  for (const [index, e] of elements(workbookXml!, "sheet").entries()) {
    const a = attributes(e.attrs);
    const rel = rels.find((r) => r.id === attributeByLocalName(a, "id"));
    // Chart and dialog sheets have no cells to map.
    if (rel?.type.endsWith("/worksheet"))
      sheets.push({
        name: a.get("name") ?? "",
        part: resolvePart(workbookPart, rel.target),
        index,
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
    workbookXml: workbookXml!,
    sheets,
    sharedStrings,
    stylesPart: stylesRel ? resolvePart(workbookPart, stylesRel.target) : null,
  };
}

/** One `<xf>` of `<cellXfs>`: a cell format, referenced by its index from `s`. */
interface CellFormat {
  readonly attrs: Map<string, string>;
  readonly inner: string | null;
}

/** The cell formats of `styles.xml`, in index order. */
function cellFormats(workbook: Workbook): CellFormat[] {
  const styles = workbook.stylesPart
    ? text(workbook.parts, workbook.stylesPart)
    : null;
  const cellXfs = styles ? elements(styles, "cellXfs")[0]?.inner : undefined;
  return (cellXfs ? elements(cellXfs, "xf") : []).map((xf) => ({
    attrs: attributes(xf.attrs),
    inner: xf.inner,
  }));
}

/** Which cellXfs entries are locked (Excel's default for a protected sheet). */
function lockedStyles(
  formats: readonly CellFormat[],
): (index: number) => boolean {
  const locked = formats.map((xf) => {
    const protection = xf.inner ? elements(xf.inner, "protection")[0] : null;
    const value = protection
      ? attributes(protection.attrs).get("locked")
      : undefined;
    return !(value === "0" || value === "false");
  });
  return (index) => locked[index] ?? true;
}

/** The fill (`fillId`) a cell format paints; 0 is no fill. */
const fillOf = (formats: readonly CellFormat[], index: number): number =>
  Number(formats[index]?.attrs.get("fillId") ?? 0) || 0;

/** Attributes and children of a format, comparable regardless of attribute order. */
const formatKey = (attrs: Map<string, string>, inner: string | null) =>
  JSON.stringify([
    [...attrs].sort(([a], [b]) => a.localeCompare(b)),
    inner ?? "",
  ]);

/**
 * Cell formats that differ from existing ones only in their fill (D124
 * holiday highlighting). A cell keeps its own number format, font, border,
 * alignment and protection; only `fillId` changes. An identical format
 * already in the workbook is reused (the template's own holiday formats
 * usually exist), and a missing one is appended to `<cellXfs>`, so
 * `styles.xml` changes only when a new combination is needed.
 */
class FillFormats {
  private readonly keys = new Map<string, number>();
  private readonly added: string[] = [];
  private readonly cache = new Map<string, number>();

  constructor(private readonly formats: readonly CellFormat[]) {
    formats.forEach((f, i) => {
      const key = formatKey(f.attrs, f.inner);
      if (!this.keys.has(key)) this.keys.set(key, i);
    });
  }

  /** The index of `style` painted with `fill`. */
  withFill(style: number, fill: number): number {
    const base = this.formats[style];
    if (!base || fillOf(this.formats, style) === fill) return style;
    const cached = this.cache.get(`${style}:${fill}`);
    if (cached !== undefined) return cached;
    const attrs = new Map(base.attrs);
    attrs.set("fillId", String(fill));
    if (fill !== 0) attrs.set("applyFill", "1");
    const key = formatKey(attrs, base.inner);
    let index = this.keys.get(key);
    if (index === undefined) {
      index = this.formats.length + this.added.length;
      const attrText = [...attrs]
        .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
        .join("");
      this.added.push(
        base.inner === null
          ? `<xf${attrText}/>`
          : `<xf${attrText}>${base.inner}</xf>`,
      );
      this.keys.set(key, index);
    }
    this.cache.set(`${style}:${fill}`, index);
    return index;
  }

  /** `styles.xml` with the new formats appended, or null when none was needed. */
  patch(stylesXml: string): string | null {
    if (this.added.length === 0) return null;
    const cellXfs =
      /<((?:[\w.-]+:)?)cellXfs\b([^>]*?)>([\s\S]*?)<\/\1cellXfs\s*>/.exec(
        stylesXml,
      );
    if (!cellXfs) return null;
    const p = cellXfs[1]!;
    const count = this.formats.length + this.added.length;
    const attrs = /\scount\s*=/.test(cellXfs[2]!)
      ? cellXfs[2]!.replace(
          /\scount\s*=\s*("[^"]*"|'[^']*')/,
          ` count="${count}"`,
        )
      : `${cellXfs[2]} count="${count}"`;
    const added = this.added.map((xf) =>
      xf.replace(/^<xf/, `<${p}xf`).replace(/<\/xf>$/, `</${p}xf>`),
    );
    return (
      stylesXml.slice(0, cellXfs.index) +
      `<${p}cellXfs${attrs}>${cellXfs[3]}${added.join("")}</${p}cellXfs>` +
      stylesXml.slice(cellXfs.index + cellXfs[0].length)
    );
  }
}

/**
 * The sheet's print area (`_xlnm.Print_Area`), one range per area; null when
 * none is set (everything prints) or it cannot be read.
 */
function printAreaOf(workbook: Workbook, sheet: Sheet): Range[] | null {
  const name = elements(workbook.workbookXml, "definedName").find((e) => {
    const a = attributes(e.attrs);
    return (
      a.get("name") === "_xlnm.Print_Area" &&
      Number(a.get("localSheetId")) === sheet.index
    );
  });
  if (!name?.inner) return null;
  const ranges: Range[] = [];
  for (const area of decodeXml(name.inner).split(",")) {
    const ref = area.slice(area.lastIndexOf("!") + 1).replace(/\$/g, "");
    // Whole columns (A:AP) and whole rows (1:30) are areas too.
    const columns = /^([A-Z]{1,3}):([A-Z]{1,3})$/i.exec(ref);
    const rows = /^(\d+):(\d+)$/.exec(ref);
    const range = columns
      ? parseRef(`${columns[1]}1:${columns[2]}${EXCEL_MAX_ROW}`)
      : rows
        ? parseRef(`A${rows[1]}:XFD${rows[2]}`)
        : parseRef(ref);
    if (!range) return null;
    ranges.push(range);
  }
  return ranges;
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
  /** Namespace prefix of `<sheetData>` (usually empty), for new rows. */
  readonly prefix: string;
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
  // `<sheetData/>` is expanded so rows can be added to an empty sheet.
  if (data![2] === undefined)
    return readSheetXml(
      xml!.slice(0, data!.index) +
        `<${data![1]}sheetData></${data![1]}sheetData>` +
        xml!.slice(data!.index + data![0].length),
    );
  return readSheetXml(xml!);
}

function readSheetXml(xml: string): SheetModel {
  const data =
    /<((?:[\w.-]+:)?)sheetData\b[^>]*?>([\s\S]*?)<\/\1sheetData\s*>/.exec(xml)!;
  const content = data[2]!;
  const dataStart = data.index + data[0].indexOf(">") + 1;
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
  const cols = elements(xml, "cols")[0]?.inner ?? "";
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
    xml,
    prefix: data[1]!,
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
  readonly formats: readonly CellFormat[];
  /** Holiday highlighting: the holiday fill and each written row's normal fill. */
  readonly fills: {
    readonly holiday: number;
    readonly normalByRow: ReadonlyMap<number, number>;
  } | null;
}

/** What a cell shows, for the content checks. */
const shownText = (value: CellValue): string =>
  value.kind === "text"
    ? value.text.trim()
    : value.kind === "number"
      ? value.raw
      : "";

const PERSIAN_DIGITS = /[۰-۹]/g;
const latinDigits = (value: string) =>
  value.replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0));

/** A day number from a previous month (1–31), as a number or digits. */
const isDayNumber = (shown: string) => {
  const n = Number(latinDigits(shown));
  return /^\d{1,2}$/.test(latinDigits(shown)) && n >= 1 && n <= 31;
};
/** A figure, `?` or nothing: what a statistic or summary cell may hold. */
const isFigure = (shown: string) =>
  shown === EXCEL_UNDECIDED_VALUE || /^[\d.,:٫/\s-]*$/.test(latinDigits(shown));
/** A weekday name of a previous export: a short word without digits. */
const isWeekdayText = (shown: string) =>
  /^[^\d]{1,12}$/.test(latinDigits(shown));
/** A month heading of a previous month: short text with a four-digit year. */
const isMonthHeading = (shown: string) =>
  shown.length <= 60 && /\d{4}/.test(latinDigits(shown));

const FIGURE = { test: isFigure, what: "عدد یا «?»" };

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
  const formats = cellFormats(workbook);
  const empty = {
    workbook,
    sheet: null,
    model: null,
    formats,
    fills: null,
    sheetNames,
    personnel: [],
    personnelRange: null,
    dayRange: null,
    personnelColumnHidden: false,
    printArea: null,
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
  const merges = elements(model.xml, "mergeCell").map((merge) => {
    const ref = attributes(merge.attrs).get("ref") ?? "";
    return { ref, range: parseRef(ref) };
  });
  const sharedFormulas = elements(model.xml, "f").flatMap((f) => {
    const ref = attributes(f.attrs).get("ref");
    const range = ref ? parseRef(ref) : null;
    return ref && range ? [{ ref, range }] : [];
  });
  const sheetRels = relationships(text(workbook.parts, relsPath(sheet.part)));
  const tables = sheetRels
    .filter((r) => r.type.endsWith("/table"))
    .flatMap((rel) => {
      const tableXml = text(
        workbook.parts,
        resolvePart(sheet.part, rel.target),
      );
      const table = tableXml ? elements(tableXml, "table")[0] : undefined;
      const ref = table ? attributes(table.attrs).get("ref") : undefined;
      const range = ref ? parseRef(ref) : null;
      return ref && range ? [{ ref, range }] : [];
    });
  /**
   * Write targets must be plain cells: nothing spans, protects or computes
   * them. `anchorOnly`: a single cell that may be the top-left cell of a
   * merge (where Excel keeps a merged cell's value), e.g. a month title.
   */
  const checkSpans = (area: Range, label: string, anchorOnly = false) => {
    for (const { ref, range } of merges)
      if (
        range &&
        intersects(range, area) &&
        !(anchorOnly && range.top === area.top && range.left === area.left)
      )
        add(errors, {
          cell: ref,
          message: `خانه‌های ادغام‌شده ${ref} با ${label} هم‌پوشانی دارد؛ ادغام را از محدوده نگاشت بردارید.`,
        });
    for (const { ref, range } of sharedFormulas)
      if (intersects(range, area))
        add(errors, {
          cell: ref,
          message: `فرمول آرایه‌ای یا مشترک ${ref} با ${label} هم‌پوشانی دارد.`,
        });
    for (const { ref, range } of tables)
      if (intersects(range, area))
        add(errors, {
          cell: ref,
          message: `جدول Excel در ${ref} با ${label} هم‌پوشانی دارد؛ جدول را به محدوده عادی تبدیل کنید.`,
        });
  };
  checkSpans(personnelArea, "ستون شماره پرسنلی");
  checkSpans(dayArea, "خانه‌های روزانه");
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
    sheetValue === "1" || sheetValue === "true" ? lockedStyles(formats) : null;

  const rowsByNumber = new Map(
    model.rows.filter((r) => r.row !== null).map((r) => [r.row!, r]),
  );
  const parsedRows = new Map<
    number,
    { token: RowToken | undefined; byColumn: Map<number | null, CellToken> }
  >();
  /** A row's cells by column, parsed (and reported) once. */
  const rowCells = (row: number) => {
    const known = parsedRows.get(row);
    if (known) return known;
    const token = rowsByNumber.get(row);
    const cells = token?.inner ? cellTokens(token.inner) : [];
    if (cells.some((c) => c.column === null))
      add(errors, {
        message: `خانه‌های ردیف ${row} نشانی ندارند؛ فایل را یک بار در Excel باز و ذخیره کنید.`,
      });
    const parsed = {
      token,
      byColumn: new Map(cells.map((c) => [c.column, c])),
    };
    parsedRows.set(row, parsed);
    return parsed;
  };
  /**
   * A statistic, summary, heading or title cell. It is overwritten, so it may
   * hold only what that cell itself writes (`expected`, e.g. a figure or a
   * day number from another month): hospital text, a signature or a wrong
   * mapping is never silently replaced.
   */
  const checkWritable = (
    row: number,
    column: number,
    label: string,
    expected: { test: (shown: string) => boolean; what: string },
  ) => {
    const { token, byColumn } = rowCells(row);
    const address = cellAddress(column, row);
    const value = cellValue(byColumn.get(column), workbook.sharedStrings);
    const shown = shownText(value);
    if (value.kind === "unsafe")
      add(errors, {
        cell: address,
        message: `${label} ${address} ${value.what} دارد و بازنویسی آن مجاز نیست؛ مقدار ساده یا خانه خالی بگذارید.`,
      });
    else if (shown !== "" && !expected.test(shown))
      add(errors, {
        cell: address,
        message: `${label} ${address} مقدار «${shown.slice(0, 30)}» دارد که ${expected.what} نیست و بازنویسی نمی‌شود؛ نگاشت را بررسی یا خانه را خالی کنید.`,
      });
    else if (
      isLocked?.(effectiveStyle(model, token, byColumn.get(column), column))
    )
      add(errors, {
        cell: address,
        message: `برگه محافظت‌شده است و خانه ${address} قفل است؛ قفل ${label} را بردارید.`,
      });
  };

  const summaryRows = new Set(mapping.summaryRows.map((r) => r.row));
  const personnel: TemplatePerson[] = [];
  const seen = new Map<string, string>();
  for (let row = mapping.firstRow; row <= mapping.lastRow; row++) {
    const { token, byColumn } = rowCells(row);
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
    // A daily summary row inside the personnel block is written, not matched.
    if (summaryRows.has(row)) {
      if (number !== null)
        add(errors, {
          cell: personnelCell,
          message: `ردیف ${row} ردیف خلاصه روزانه تعیین شده ولی شماره پرسنلی ${number} دارد.`,
        });
      continue;
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
      else if (
        value.kind !== "text" ||
        !(shown === EXCEL_UNDECIDED_VALUE || parseSpreadsheetDayCode(shown).ok)
      )
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

  // Statistics are written in personnel rows; summaries and headings in the day columns.
  for (const { column, columnIndex: index } of mapping.statisticColumns)
    for (const person of personnel) {
      const label = `ستون آمار ${column}`;
      checkSpans(
        { top: person.row, bottom: person.row, left: index, right: index },
        label,
      );
      checkWritable(person.row, index, label, FIGURE);
    }
  const dayRows = [
    ...(mapping.weekdayRow === null
      ? []
      : [
          {
            row: mapping.weekdayRow,
            label: "ردیف روزهای هفته",
            expected: { test: isWeekdayText, what: "نام روز هفته" },
          },
        ]),
    ...(mapping.dayHeaderRow === null
      ? []
      : [
          {
            row: mapping.dayHeaderRow,
            label: "ردیف عنوان روزها",
            expected: { test: isDayNumber, what: "شماره روز (۱ تا ۳۱)" },
          },
        ]),
    ...mapping.summaryRows.map((r) => ({
      row: r.row,
      label: `ردیف خلاصه ${r.row}`,
      expected: FIGURE,
    })),
  ];
  for (const { row, label, expected } of dayRows) {
    checkSpans(
      {
        top: row,
        bottom: row,
        left: mapping.firstDayColumnIndex,
        right: mapping.lastDayColumnIndex,
      },
      label,
    );
    for (
      let column = mapping.firstDayColumnIndex;
      column <= mapping.lastDayColumnIndex;
      column++
    )
      checkWritable(row, column, label, expected);
  }
  if (mapping.monthHeading) {
    const { cell, column, row } = mapping.monthHeading;
    const label = "خانه عنوان ماه";
    checkSpans(
      { top: row, bottom: row, left: column, right: column },
      label,
      true,
    );
    checkWritable(row, column, label, {
      test: isMonthHeading,
      what: "عنوان ماه با سال (مثلاً «مهرماه 1405»)",
    });
    if (
      mapping.statisticColumns.some((c) => c.columnIndex === column) &&
      personnel.some((p) => p.row === row)
    )
      add(errors, {
        cell,
        message: `خانه عنوان ماه ${cell} روی ستون آمار است.`,
      });
  }

  // Holiday highlighting: the fills come from the template itself.
  const styleAt = (column: number, row: number) => {
    const { token, byColumn } = rowCells(row);
    return effectiveStyle(model, token, byColumn.get(column), column);
  };
  const painted = new Set([
    ...dayRows.map((r) => r.row),
    ...personnel.map((p) => p.row),
  ]);
  // A filled row of the table that nobody holds is repainted too (its day
  // cells are empty), so no saved Friday survives in it; unformatted rows
  // stay as they are.
  if (mapping.holidayFill)
    for (let row = mapping.firstRow; row <= mapping.lastRow; row++)
      for (
        let column = mapping.firstDayColumnIndex;
        column <= mapping.lastDayColumnIndex && !painted.has(row);
        column++
      )
        if (fillOf(formats, styleAt(column, row)) !== 0) painted.add(row);
  const writtenRows = [...painted].sort((a, b) => a - b);
  let fills: Analysis["fills"] = null;
  if (mapping.holidayFill) {
    const { holidayCell, normalColumn, normalColumnIndex } =
      mapping.holidayFill;
    const holiday = fillOf(
      formats,
      styleAt(holidayCell.column, holidayCell.row),
    );
    const normalByRow = new Map(
      writtenRows.map((row) => [
        row,
        fillOf(formats, styleAt(normalColumnIndex, row)),
      ]),
    );
    if (holiday === 0)
      add(errors, {
        cell: holidayCell.cell,
        message: `خانه رنگ تعطیل ${holidayCell.cell} رنگ زمینه ندارد؛ خانه‌ای را انتخاب کنید که رنگ جمعه قالب را دارد (مثلاً خانه روزانه یک جمعه).`,
      });
    else {
      const same = [...normalByRow]
        .filter(([, fill]) => fill === holiday)
        .map(([row]) => row);
      // The shift cells must tell a holiday apart: a holiday cell that is not
      // highlighted in this file (e.g. last month's export, uploaded again)
      // would silently drop every Friday.
      if (
        personnel.length > 0 &&
        personnel.every((p) => normalByRow.get(p.row) === holiday)
      )
        add(errors, {
          cell: holidayCell.cell,
          message: `رنگ خانه ${holidayCell.cell} با رنگ ستون روز عادی ${normalColumn} در ردیف‌های پرسنل یکی است؛ خانه رنگ تعطیل باید در همین فایل رنگ جمعه را داشته باشد و ستون روز عادی جمعه نباشد.`,
        });
      else if (same.length > 0)
        add(warnings, {
          message: `در ردیف‌های ${same.join("، ")} رنگ روز عادی (ستون ${normalColumn}) همان رنگ تعطیل است؛ جمعه‌ها در این ردیف‌ها رنگ متفاوتی نمی‌گیرند.`,
        });
      fills = { holiday, normalByRow };
    }
  } else if (personnel[0]) {
    // Without a holiday fill, the saved month's highlighted columns stay put.
    const row = personnel[0].row;
    const byColumn = new Map<number, number>();
    for (
      let c = mapping.firstDayColumnIndex;
      c <= mapping.lastDayColumnIndex;
      c++
    )
      byColumn.set(c, fillOf(formats, styleAt(c, row)));
    const counts = new Map<number, number>();
    for (const fill of byColumn.values())
      counts.set(fill, (counts.get(fill) ?? 0) + 1);
    const common = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
    const marked = [...byColumn]
      .filter(([, f]) => f !== common)
      .map(([c]) => columnLetters(c));
    if (marked.length > 0)
      add(warnings, {
        cell: cellAddress(columnIndex(marked[0]!)!, row),
        message: `ستون‌های روز ${marked.join("، ")} رنگ زمینه دیگری دارند (احتمالاً جمعه‌های ماهی که قالب در آن ذخیره شده)؛ تا «خانه رنگ تعطیل» و «ستون رنگ روز عادی» تعیین نشود، این رنگ‌ها در همه ماه‌ها همان‌جا می‌مانند.`,
      });
  }

  if (personnel.length === 0 && errors.length === 0)
    add(errors, {
      cell: rangeRef(personnelArea),
      message: `هیچ شماره پرسنلی در ${rangeRef(personnelArea)} پیدا نشد.`,
    });

  // What prints: written cells outside the print area are kept but not printed.
  const printAreas = printAreaOf(workbook, sheet);
  if (printAreas) {
    const printed = (column: number, row: number) =>
      printAreas.some(
        (r) =>
          r.left <= column &&
          column <= r.right &&
          r.top <= row &&
          row <= r.bottom,
      );
    const headerRow = mapping.dayHeaderRow ?? personnel[0]?.row;
    const unprintedDays = Array.from(
      { length: EXCEL_TEMPLATE_DAY_COLUMNS },
      (_, i) => i + 1,
    ).filter(
      (day) =>
        headerRow !== undefined &&
        !printed(mapping.firstDayColumnIndex + day - 1, headerRow),
    );
    if (unprintedDays.length > 0)
      add(warnings, {
        cell: cellAddress(
          mapping.firstDayColumnIndex + unprintedDays[0]! - 1,
          headerRow!,
        ),
        message: `ستون روزهای ${unprintedDays.join("، ")} خارج از ناحیه چاپ (${printAreas.map(rangeRef).join("، ")}) است و چاپ نمی‌شود؛ در ماه‌هایی که این روزها را دارند ناحیه چاپ را در Excel گسترش دهید.`,
      });
    const unprintedRows = [
      ...(mapping.weekdayRow === null ? [] : [mapping.weekdayRow]),
      ...personnel.map((p) => p.row),
      ...mapping.summaryRows.map((r) => r.row),
    ].filter((row) => !printed(mapping.firstDayColumnIndex, row));
    if (unprintedRows.length > 0)
      add(warnings, {
        message: `ردیف‌های ${unprintedRows.join("، ")} خارج از ناحیه چاپ است و چاپ نمی‌شود.`,
      });
    const unprintedStatistics = mapping.statisticColumns.filter(
      (c) =>
        personnel[0] !== undefined && !printed(c.columnIndex, personnel[0].row),
    );
    if (unprintedStatistics.length > 0)
      add(warnings, {
        message: `ستون آمار ${unprintedStatistics.map((c) => c.column).join("، ")} خارج از ناحیه چاپ است و چاپ نمی‌شود.`,
      });
    const heading = mapping.monthHeading;
    if (heading && !printed(heading.column, heading.row))
      add(warnings, {
        cell: heading.cell,
        message: `خانه عنوان ماه ${heading.cell} خارج از ناحیه چاپ است و چاپ نمی‌شود.`,
      });
  }

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
    formats,
    fills,
    valid: errors.length === 0,
    mapping,
    sheetNames,
    errors,
    warnings,
    personnel,
    personnelRange: rangeRef(personnelArea),
    dayRange: rangeRef(dayArea),
    personnelColumnHidden,
    printArea: printAreas ? printAreas.map(rangeRef).join("، ") : null,
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
    printArea: analysis.printArea,
  };
}

// ----------------------------------------------------------------- write

/** Values written besides the day cells of personnel rows (D124). */
export interface TemplateExtras {
  /** Personnel number → statistic column letters → value. */
  readonly statistics?: ReadonlyMap<
    string,
    ReadonlyMap<string, ExportCellValue>
  >;
  /** Daily summary row → 31 values. */
  readonly summaries?: ReadonlyMap<number, readonly ExportCellValue[]>;
  /** The 31 day-heading values, written when the mapping has a heading row. */
  readonly dayHeader?: readonly ExportCellValue[];
  /** The 31 weekday values, written when the mapping has a weekday row. */
  readonly weekdays?: readonly ExportCellValue[];
  /** The month and year, written when the mapping has a month heading cell. */
  readonly monthHeading?: string | null;
  /**
   * Which of the 31 day columns are holidays, applied when the mapping has
   * holiday highlighting; every other day column gets its normal fill.
   */
  readonly holidays?: readonly boolean[];
}

/** One cell's new value (null empties it) and, when restyled, its new format. */
interface CellEdit {
  readonly value: ExportCellValue;
  readonly style?: number;
}

/** Cell edits by row, then column. */
type SheetEdits = Map<number, Map<number, CellEdit>>;

const dayValues = (values: readonly ExportCellValue[] | undefined) => {
  const all =
    values ?? Array<ExportCellValue>(EXCEL_TEMPLATE_DAY_COLUMNS).fill(null);
  if (all.length !== EXCEL_TEMPLATE_DAY_COLUMNS)
    throw new RangeError("Each row needs 31 day values");
  return all;
};

/**
 * A new workbook from the template with the mapped cells written: the day
 * cells of every matched row from `values` (31 entries; null is a blank
 * cell), its statistic cells, the daily summary rows and the day headings
 * from `extras`. A matched row without values, and any statistic or summary
 * cell without a value, is emptied: a static figure is never left behind as
 * current. Only those cells change; the template bytes passed in are not
 * modified.
 */
export function populateExcelTemplate(
  bytes: Uint8Array,
  mapping: ExcelTemplateMapping,
  values: ReadonlyMap<string, readonly ExportCellValue[]>,
  extras: TemplateExtras = {},
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
  for (const v of values.values()) dayValues(v);
  const edits: SheetEdits = new Map();
  const rowEdits = (row: number) => {
    const edit = edits.get(row) ?? new Map<number, CellEdit>();
    edits.set(row, edit);
    return edit;
  };
  const dayRow = (row: number, cells: readonly ExportCellValue[]) => {
    const edit = rowEdits(row);
    dayValues(cells).forEach((value, i) =>
      edit.set(m.firstDayColumnIndex + i, { value }),
    );
    return edit;
  };
  for (const person of analysis.personnel) {
    const edit = dayRow(
      person.row,
      dayValues(values.get(person.personnelNumber)),
    );
    const statistics = extras.statistics?.get(person.personnelNumber);
    for (const { column, columnIndex: index } of m.statisticColumns)
      edit.set(index, { value: statistics?.get(column) ?? null });
  }
  for (const { row } of m.summaryRows)
    dayRow(row, dayValues(extras.summaries?.get(row)));
  if (m.dayHeaderRow !== null && extras.dayHeader)
    dayRow(m.dayHeaderRow, extras.dayHeader);
  // Calendar headings are rewritten every time: a shorter month never keeps
  // the 30th or 31st of the month the template was saved in.
  if (m.weekdayRow !== null) dayRow(m.weekdayRow, dayValues(extras.weekdays));
  if (m.monthHeading)
    rowEdits(m.monthHeading.row).set(m.monthHeading.column, {
      value: extras.monthHeading ?? null,
    });

  const output = new Map(workbook!.parts);
  if (analysis.fills) {
    // Every written day cell is repainted from the stored template's own
    // fills, so highlighting never accumulates across months: a holiday gets
    // the holiday fill, any other day its row's normal fill. Only `fillId`
    // changes; the cell's border, font, alignment and number format stay.
    const holidays = extras.holidays ?? [];
    if (holidays.length !== 0 && holidays.length !== EXCEL_TEMPLATE_DAY_COLUMNS)
      throw new RangeError("Holidays need 31 day flags");
    const formats = new FillFormats(analysis.formats);
    const rows = new Map(model!.rows.map((r) => [r.row, r]));
    for (const [row, normal] of analysis.fills.normalByRow) {
      // A table row nobody holds has empty day cells (validated): repainted only.
      const edit =
        edits.get(row) ??
        (row >= m.firstRow && row <= m.lastRow ? rowEdits(row) : null);
      if (!edit) continue;
      const token = rows.get(row);
      const cells = new Map(
        cellTokens(token?.inner ?? "").map((c) => [c.column, c]),
      );
      for (let i = 0; i < EXCEL_TEMPLATE_DAY_COLUMNS; i++) {
        const column = m.firstDayColumnIndex + i;
        const base = effectiveStyle(model!, token, cells.get(column), column);
        const fill = holidays[i] ? analysis.fills.holiday : normal;
        edit.set(column, {
          value: edit.get(column)?.value ?? null,
          style: formats.withFill(base, fill),
        });
      }
    }
    const stylesXml = workbook!.stylesPart
      ? text(workbook!.parts, workbook!.stylesPart)
      : null;
    const styles = stylesXml === null ? null : formats.patch(stylesXml);
    if (styles !== null)
      output.set(workbook!.stylesPart!, encoder.encode(styles));
  }

  const sheetXml = patchSheet(model!, edits);
  output.set(sheet!.part, encoder.encode(sheetXml));
  // Summaries the hospital keeps as formulas must never show the template's
  // stale results: a viewer that does not recalculate (Protected View,
  // previews, other spreadsheet apps) would print last month's totals. Cached
  // results are dropped (formulas themselves are untouched) and Excel is told
  // to recalculate everything on open.
  let hasFormulas = false;
  for (const s of workbook!.sheets) {
    const xml =
      s.part === sheet!.part ? sheetXml : text(workbook!.parts, s.part);
    if (!xml || !FORMULA.test(xml)) continue;
    hasFormulas = true;
    output.set(s.part, encoder.encode(withoutCachedResults(xml)));
  }
  if (hasFormulas)
    output.set(
      workbook!.workbookPart,
      encoder.encode(recalculateOnLoad(workbook!.workbookXml)),
    );
  return zipParts(output);
}

const zipParts = (parts: Parts) =>
  zipSync(
    Object.fromEntries(
      [...parts].map(([name, data]) => [name, [data, { level: 6 }]]),
    ),
  );

/** The worksheet XML with `edits` applied to `<sheetData>` and the dimension kept covering them. */
function patchSheet(model: SheetModel, edits: SheetEdits): string {
  const content = model.xml.slice(model.dataStart, model.dataEnd);
  const pending = [...edits.keys()].sort((a, b) => a - b);
  const newRow = (row: number) =>
    rewriteRow(
      model,
      {
        row,
        attrs: new Map(),
        openTag: `<${model.prefix}row r="${row}">`,
        inner: "",
        raw: "",
        index: 0,
        prefix: model.prefix,
      },
      edits.get(row)!,
    );
  let rebuilt = "";
  let cursor = 0;
  for (const token of model.rows) {
    // Rows that do not exist yet go before the first row after them.
    while (
      token.row !== null &&
      pending.length > 0 &&
      pending[0]! < token.row
    ) {
      rebuilt += content.slice(cursor, token.index) + newRow(pending.shift()!);
      cursor = token.index;
    }
    if (token.row === null || pending[0] !== token.row) continue;
    pending.shift();
    rebuilt += content.slice(cursor, token.index);
    rebuilt += rewriteRow(model, token, edits.get(token.row)!);
    cursor = token.index + token.raw.length;
  }
  rebuilt += content.slice(cursor) + pending.map(newRow).join("");
  const xml =
    model.xml.slice(0, model.dataStart) +
    rebuilt +
    model.xml.slice(model.dataEnd);
  return withDimension(xml, edits);
}

/** Widens `<dimension ref>` (a reader's hint of the used range) to every written cell. */
function withDimension(xml: string, edits: SheetEdits): string {
  const dimension = /<((?:[\w.-]+:)?)dimension\b([^>]*?)\/>/.exec(xml);
  const ref = dimension ? attributes(dimension[2]!).get("ref") : undefined;
  const range = ref ? parseRef(ref) : null;
  if (!dimension || !range) return xml;
  const written = [...edits].flatMap(([row, cells]) =>
    [...cells]
      .filter(([, edit]) => edit.value !== null)
      .map(([column]) => ({ row, column })),
  );
  const wider: Range = {
    top: Math.min(range.top, ...written.map((c) => c.row)),
    bottom: Math.max(range.bottom, ...written.map((c) => c.row)),
    left: Math.min(range.left, ...written.map((c) => c.column)),
    right: Math.max(range.right, ...written.map((c) => c.column)),
  };
  if (
    wider.top === range.top &&
    wider.bottom === range.bottom &&
    wider.left === range.left &&
    wider.right === range.right
  )
    return xml;
  return (
    xml.slice(0, dimension.index) +
    `<${dimension[1]}dimension ref="${rangeRef(wider)}"/>` +
    xml.slice(dimension.index + dimension[0].length)
  );
}

function cellXml(
  prefix: string,
  ref: string,
  style: string | undefined,
  value: string | number,
): string {
  const s = style && style !== "0" ? ` s="${style}"` : "";
  return typeof value === "number"
    ? `<${prefix}c r="${ref}"${s}><${prefix}v>${value}</${prefix}v></${prefix}c>`
    : `<${prefix}c r="${ref}"${s} t="inlineStr"><${prefix}is><${prefix}t>${escapeXml(value)}</${prefix}t></${prefix}is></${prefix}c>`;
}

function rewriteRow(
  model: SheetModel,
  row: RowToken,
  edits: ReadonlyMap<number, CellEdit>,
): string {
  const p = row.prefix;
  const inner = row.inner ?? "";
  // The row's content as cells and whatever lies between them, byte for byte.
  const tokens: { column: number | null; text: string; cell: boolean }[] = [];
  const existing = new Map<number, CellToken>();
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
    const attrs = attributes(m[1]!);
    const letters = /^([A-Z]{1,3})\d+$/.exec(attrs.get("r") ?? "")?.[1];
    const column = letters ? columnIndex(letters) : null;
    if (column !== null)
      existing.set(column, { column, attrs, inner: m[2] ?? null, raw: m[0] });
    tokens.push({ column, text: m[0], cell: true });
    last = m.index + m[0].length;
  }
  if (last < inner.length)
    tokens.push({ column: null, text: inner.slice(last), cell: false });

  const kept = tokens.filter((t) => !(t.cell && edits.has(t.column!)));
  let inserted = false;
  for (const [column, { value, style: restyled }] of [...edits].sort(
    ([a], [b]) => a - b,
  )) {
    const cell = existing.get(column);
    const ref = `${columnLetters(column)}${row.row}`;
    // A new cell takes the style Excel itself would give it (row, then column).
    const inherited = cell
      ? cell.attrs.get("s")
      : String(effectiveStyle(model, row, undefined, column));
    const style = restyled === undefined ? inherited : String(restyled);
    let xml: string | null;
    if (value === null)
      // A cleared cell keeps its style; an absent one stays absent unless restyled.
      xml =
        cell || (style ?? "0") !== (inherited ?? "0")
          ? `<${p}c r="${ref}"${style && style !== "0" ? ` s="${style}"` : ""}/>`
          : null;
    else xml = cellXml(p, ref, style, value);
    if (xml !== null && !cell) inserted = true;
    if (xml === null) continue;
    // Cells stay in column order: before the first kept cell to the right.
    const after = kept.findIndex((t) => t.cell && t.column! > column);
    const lastCell = kept.findLastIndex((t) => t.cell);
    const at = after >= 0 ? after : lastCell >= 0 ? lastCell + 1 : 0;
    kept.splice(at, 0, { column, text: xml, cell: true });
  }
  // `spans` is an optional hint; drop it rather than let it go stale.
  const openTag = inserted
    ? row.openTag.replace(/\sspans\s*=\s*("[^"]*"|'[^']*')/, "")
    : row.openTag;
  return `${openTag}${kept.map((t) => t.text).join("")}</${p}row>`;
}

// ------------------------------------------------- personnel column (D124)

/**
 * The text of each row's cells before the first day column, for a person to
 * recognise the row when choosing who it belongs to. Display only: rows are
 * never matched by name.
 */
export function templateRowLabels(
  bytes: Uint8Array,
  input: {
    sheetName: string;
    firstRow: number;
    lastRow: number;
    firstDayColumn: string;
  },
): { row: number; label: string }[] {
  const workbook = openWorkbook(bytes);
  const sheet = workbook.sheets.find((s) => s.name === input.sheetName.trim());
  if (!sheet)
    fail(
      `برگه «${input.sheetName}» در فایل نیست. برگه‌های موجود: ${workbook.sheets.map((s) => s.name).join("، ")}`,
    );
  const firstDay = columnIndex(input.firstDayColumn);
  if (
    firstDay === null ||
    !Number.isInteger(input.firstRow) ||
    !Number.isInteger(input.lastRow) ||
    input.firstRow < 1 ||
    input.lastRow < input.firstRow ||
    input.lastRow - input.firstRow >= EXCEL_TEMPLATE_MAX_PERSONNEL_ROWS
  )
    fail("محدوده ردیف‌ها یا ستون روز اول معتبر نیست.");
  const model = readSheet(workbook, sheet!);
  const labels: { row: number; label: string }[] = [];
  for (const token of model.rows) {
    if (token.row === null || token.row < input.firstRow) continue;
    if (token.row > input.lastRow) break;
    const label = cellTokens(token.inner ?? "")
      .filter((c) => c.column !== null && c.column < firstDay!)
      .map((c) => cellValue(c, workbook.sharedStrings))
      .map((v) =>
        v.kind === "text" ? v.text.trim() : v.kind === "number" ? v.raw : "",
      )
      .filter(Boolean)
      .join(" · ")
      .slice(0, 160);
    if (label) labels.push({ row: token.row, label });
  }
  return labels;
}

/**
 * Writes personnel numbers into an empty column and hides it, without
 * inserting or moving anything: the printed columns, merges, styles and print
 * settings stay where they are. The numbers are written as text (leading
 * zeros kept). The column must hold no value in any row and cross no merged
 * cell, so hiding it changes nothing that prints. Every other part of the
 * package is copied byte for byte.
 */
export function writePersonnelColumn(
  bytes: Uint8Array,
  input: {
    sheetName: string;
    column: string;
    /** Row → personnel number. */
    numbers: ReadonlyMap<number, string>;
  },
): Uint8Array {
  const workbook = openWorkbook(bytes);
  const sheet = workbook.sheets.find((s) => s.name === input.sheetName.trim());
  if (!sheet)
    fail(
      `برگه «${input.sheetName}» در فایل نیست. برگه‌های موجود: ${workbook.sheets.map((s) => s.name).join("، ")}`,
    );
  const column = columnIndex(input.column);
  if (column === null) fail("ستون شماره پرسنلی باید حرف ستون Excel باشد.");
  if (input.numbers.size === 0)
    fail("هیچ ردیفی برای شماره پرسنلی انتخاب نشده است.");
  const model = readSheet(workbook, sheet!);
  if (model.rows.some((r) => r.row === null))
    fail(
      "ردیف‌های برگه شماره ندارند؛ فایل را یک بار در Excel باز و ذخیره کنید.",
    );
  const letters = columnLetters(column!);
  for (const token of model.rows)
    for (const cell of cellTokens(token.inner ?? ""))
      if (cell.column === column) {
        const value = cellValue(cell, workbook.sharedStrings);
        if (
          value.kind !== "empty" &&
          !(value.kind === "text" && value.text.trim() === "")
        )
          fail(
            `ستون ${letters} خالی نیست (خانه ${cellAddress(column!, token.row ?? 0)})؛ ستونی را انتخاب کنید که در هیچ ردیفی مقدار ندارد.`,
          );
      }
  for (const merge of elements(model.xml, "mergeCell")) {
    const ref = attributes(merge.attrs).get("ref") ?? "";
    const range = parseRef(ref);
    if (range && range.left <= column! && column! <= range.right)
      fail(
        `ستون ${letters} از خانه‌های ادغام‌شده ${ref} می‌گذرد و پنهان کردن آن چاپ را تغییر می‌دهد؛ ستون دیگری انتخاب کنید.`,
      );
  }
  const edits: SheetEdits = new Map();
  for (const [row, number] of input.numbers) {
    if (!Number.isInteger(row) || row < 1 || row > EXCEL_MAX_ROW)
      fail("ردیف انتخاب‌شده معتبر نیست.");
    edits.set(row, new Map([[column!, { value: number }]]));
  }
  const output = new Map(workbook.parts);
  output.set(
    sheet!.part,
    encoder.encode(withHiddenColumn(patchSheet(model, edits), column!)),
  );
  return zipParts(output);
}

/** Marks one column hidden in `<cols>`, splitting a `<col>` range that spans it. */
function withHiddenColumn(xml: string, column: number): string {
  const cols =
    /<((?:[\w.-]+:)?)cols\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1cols\s*>)/.exec(xml);
  const p = cols?.[1] ?? /<((?:[\w.-]+:)?)sheetData\b/.exec(xml)![1]!;
  const hidden = (attrs: string) =>
    `<${p}col min="${column}" max="${column}"${attrs} hidden="1"/>`;
  const entries = elements(cols?.[2] ?? "", "col").map((c) => ({
    ...c,
    a: attributes(c.attrs),
  }));
  const spanning = entries.find(
    (c) => Number(c.a.get("min")) <= column && column <= Number(c.a.get("max")),
  );
  let body: string;
  if (spanning) {
    const rest = spanning.attrs
      .replace(/\s(?:min|max|hidden)\s*=\s*("[^"]*"|'[^']*')/g, "")
      .replace(/\/\s*$/, "");
    const piece = (min: number, max: number) =>
      `<${p}col min="${min}" max="${max}"${rest}/>`;
    const min = Number(spanning.a.get("min"));
    const max = Number(spanning.a.get("max"));
    const split =
      (min < column ? piece(min, column - 1) : "") +
      hidden(rest) +
      (column < max ? piece(column + 1, max) : "");
    body = cols![2]!.replace(spanning.raw, split);
  } else {
    // `<col>` entries are sorted by `min`; a hidden column has a width.
    const next = entries.find((c) => Number(c.a.get("min")) > column);
    const entry = hidden(' width="9.140625" customWidth="1"');
    body = next
      ? cols![2]!.replace(next.raw, entry + next.raw)
      : (cols?.[2] ?? "") + entry;
  }
  const replacement = `<${p}cols>${body}</${p}cols>`;
  if (cols)
    return (
      xml.slice(0, cols.index) +
      replacement +
      xml.slice(cols.index + cols[0].length)
    );
  // CT_Worksheet order: `<cols>` comes right before `<sheetData>`.
  const data = /<(?:[\w.-]+:)?sheetData\b/.exec(xml)!;
  return xml.slice(0, data.index) + replacement + xml.slice(data.index);
}

const FORMULA = /<(?:[\w.-]+:)?f(?=[\s/>])/;

/** Removes the cached `<v>` result of every formula cell; the `<f>` is kept as is. */
function withoutCachedResults(xml: string): string {
  return xml.replace(
    /<((?:[\w.-]+:)?)c(?=[\s/>])([^>]*?)>([\s\S]*?)<\/\1c\s*>/g,
    (cell, prefix: string, attrs: string, inner: string) =>
      FORMULA.test(inner)
        ? `<${prefix}c${attrs}>${inner.replace(/<((?:[\w.-]+:)?)v(?=[\s/>])[^>]*?(?:\/>|>[\s\S]*?<\/\1v\s*>)/g, "")}</${prefix}c>`
        : cell,
  );
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
