import { randomInt } from "node:crypto";

/**
 * Unambiguous characters only (no 0/O, 1/l/I, 5/S, 2/Z), so a password read
 * aloud or copied from paper is typed correctly. 52 symbols.
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRTUVWXY346789";

/** Four groups of four: ~91 bits of entropy, 19 characters with separators. */
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * A cryptographically random temporary password (CSPRNG, unbiased
 * `crypto.randomInt`). Returned to the issuing administrator exactly once and
 * never stored, logged or audited; only its Argon2id hash is kept.
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++)
      group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}
