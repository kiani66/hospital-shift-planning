import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { normalizeIdentifierText } from "./normalize";

/** Iranian mobile numbers are stored as `09xxxxxxxxx`. Not unique, never a login identifier. */
export const MOBILE_PATTERN = /^09[0-9]{9}$/;

export type MobileNumber = string & { readonly __brand: "MobileNumber" };

/**
 * Accepts the common written forms of an Iranian mobile number and returns the
 * canonical `09xxxxxxxxx`: `09121234567`, `9121234567`, `+989121234567`,
 * `00989121234567`, `989121234567`, with Persian/Arabic digits and spaces,
 * hyphens, dots or parentheses as separators.
 */
export function parseMobileNumber(
  raw: string,
): Result<MobileNumber, ValidationError> {
  const compact = normalizeIdentifierText(raw).replace(/[\s\-().]/g, "");
  let national: string | null = null;
  if (/^\+989[0-9]{9}$/.test(compact)) national = compact.slice(3);
  else if (/^00989[0-9]{9}$/.test(compact)) national = compact.slice(4);
  else if (/^989[0-9]{9}$/.test(compact)) national = compact.slice(2);
  else if (/^09[0-9]{9}$/.test(compact)) national = compact.slice(1);
  else if (/^9[0-9]{9}$/.test(compact)) national = compact;
  return national === null
    ? err(
        new ValidationError(
          "Not a valid Iranian mobile number",
          "mobile",
          "MOBILE_INVALID",
        ),
      )
    : ok(`0${national}` as MobileNumber);
}

/** Empty (after normalization) means "no mobile number". */
export function parseOptionalMobileNumber(
  raw: string | null | undefined,
): Result<MobileNumber | null, ValidationError> {
  if (raw == null || normalizeIdentifierText(raw) === "") return ok(null);
  return parseMobileNumber(raw);
}
