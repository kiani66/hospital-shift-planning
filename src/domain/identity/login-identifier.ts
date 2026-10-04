import { normalizeIdentifierText } from "./normalize";
import { PERSONNEL_NUMBER_PATTERN } from "./personnel-number";

/**
 * What a user typed in the sign-in identifier field. Containing `@` means an
 * e-mail address (lower-cased, like account creation); otherwise digits after
 * normalization mean a personnel number. Anything else can match no account
 * and is still processed (dummy hash, fallback throttle) like an unknown one.
 */
export type LoginIdentifier =
  | { readonly kind: "email"; readonly value: string }
  | { readonly kind: "personnelNumber"; readonly value: string }
  | { readonly kind: "unrecognized"; readonly value: string };

export function parseLoginIdentifier(raw: string): LoginIdentifier {
  const value = normalizeIdentifierText(raw);
  if (value.includes("@")) return { kind: "email", value: value.toLowerCase() };
  if (PERSONNEL_NUMBER_PATTERN.test(value))
    return { kind: "personnelNumber", value };
  return { kind: "unrecognized", value: value.toLowerCase() };
}
