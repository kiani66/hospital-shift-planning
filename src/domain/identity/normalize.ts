/**
 * Text normalization shared by personnel identity fields. Pure: no Intl, no I/O.
 *
 * Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits become ASCII.
 * Invisible formatting characters (zero-width characters, bidi marks and
 * isolates, the BOM, soft hyphen) are never meaningful in an identifier and are
 * removed wherever they occur: Excel and phone keyboards insert them silently.
 */

const INVISIBLE =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export function stripInvisible(value: string): string {
  return value.replace(INVISIBLE, "");
}

export function toAsciiDigits(value: string): string {
  return value.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Invisible characters removed, digits ASCII, surrounding whitespace (incl. NBSP) trimmed. */
export function normalizeIdentifierText(value: string): string {
  return toAsciiDigits(stripInvisible(value)).trim();
}

/**
 * A display name as stored and compared: invisible characters removed (ZWNJ
 * is kept: it is part of Persian spelling), Arabic yeh/kaf replaced by their
 * Persian forms, whitespace collapsed and trimmed.
 */
export function normalizeDisplayName(value: string): string {
  return value
    .replace(
      /[\u00AD\u061C\u180E\u200B\u200D-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
      "",
    )
    .replace(/\u064A/g, "\u06CC")
    .replace(/\u0643/g, "\u06A9")
    .replace(/\s+/g, " ")
    .trim();
}
