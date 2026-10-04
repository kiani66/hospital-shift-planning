import { ValidationError } from "../shared/errors";
import { err, ok, type Result } from "../shared/result";
import { normalizeIdentifierText } from "./normalize";

/**
 * Personnel number (approved decision PN-1): digits only, 1–20 of them,
 * stored as text so leading zeros survive (`720` and `00125` are different,
 * valid numbers). Unique across all users; the database enforces both.
 */
export const PERSONNEL_NUMBER_MAX_LENGTH = 20;

export const PERSONNEL_NUMBER_PATTERN = /^[0-9]{1,20}$/;

/** A normalized personnel number (ASCII digits only). */
export type PersonnelNumber = string & { readonly __brand: "PersonnelNumber" };

/** Stable reason codes; the UI words them. */
export type PersonnelNumberError =
  "PERSONNEL_NUMBER_REQUIRED" | "PERSONNEL_NUMBER_INVALID";

/**
 * Normalizes Persian/Arabic digits, invisible formatting characters and
 * surrounding whitespace, then validates the format. Internal spaces,
 * separators, signs, decimals and exponents ("720.0", "1.2E+5") are rejected,
 * never repaired: a wrong guess would identify a different person.
 */
export function parsePersonnelNumber(
  raw: string,
): Result<PersonnelNumber, ValidationError> {
  const value = normalizeIdentifierText(raw);
  if (value === "")
    return err(
      new ValidationError(
        "Personnel number is required",
        "personnelNumber",
        "PERSONNEL_NUMBER_REQUIRED",
      ),
    );
  if (!PERSONNEL_NUMBER_PATTERN.test(value))
    return err(
      new ValidationError(
        "Personnel number must be 1 to 20 digits",
        "personnelNumber",
        "PERSONNEL_NUMBER_INVALID",
      ),
    );
  return ok(value as PersonnelNumber);
}

export function isPersonnelNumber(value: string): value is PersonnelNumber {
  return PERSONNEL_NUMBER_PATTERN.test(value);
}
