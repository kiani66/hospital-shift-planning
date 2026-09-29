import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * Password hashing (D6): Argon2id with the OWASP-recommended minimum
 * parameters (19 MiB memory, 2 iterations, 1 lane). The parameters are stored
 * in each hash, so they can be raised later without invalidating old hashes.
 * Server-only: never import this from client code.
 */
const ARGON2ID = {
  // `Algorithm.Argon2id`; the package's const enum is not usable with isolatedModules.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID);
}

/** False for a wrong password or a malformed hash; never throws. */
export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real verification. Called when there is no hash
 * to check (unknown e-mail, inactive user, no password set) so response times
 * do not reveal whether an account exists.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy password for constant-time failures");
  await verifyPassword(await dummyHash, password);
  return false;
}
