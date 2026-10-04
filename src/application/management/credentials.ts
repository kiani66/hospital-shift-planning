import { z } from "zod";

import { ValidationError } from "../../domain/shared/errors";
import { accountThrottleKey } from "../../infrastructure/auth/credentials";
import { hashPassword } from "../../infrastructure/auth/password";
import { generateTemporaryPassword } from "../../infrastructure/auth/temporary-password";
import { clearFailedLogins } from "../../infrastructure/repositories/login-throttles";
import { hasAccountCredentials } from "../../infrastructure/repositories/management";
import { replacePassword } from "../../infrastructure/repositories/users";
import { ConflictError } from "../errors";
import type { UnitOfWork } from "../use-case";
import { defineCommand } from "../use-case";
import { authorizeAdministration, requireUser } from "./context";

/**
 * Generates a temporary password for one account, stores only its hash,
 * forces a change at the next sign-in and ends every existing session of
 * that account (session version bump). Called under the administration lock.
 * The plaintext is returned to the caller exactly once and must never be
 * logged, audited or persisted.
 */
export async function issueTemporaryPasswordFor(
  uow: UnitOfWork,
  user: { id: string; isActive: boolean },
  source: "single" | "afterImport",
): Promise<string> {
  if (user.id === uow.actor.userId)
    throw new ValidationError(
      "Use the self-service password change for your own account",
      "userId",
      "SELF_TEMPORARY_PASSWORD",
    );
  // Never reactivates: a disabled account stays disabled and unusable.
  if (!user.isActive)
    throw new ValidationError(
      "Temporary passwords are issued only to active accounts",
      "userId",
      "ACCOUNT_INACTIVE",
    );
  const hadCredentials = await hasAccountCredentials(uow.tx, user.id);
  const temporaryPassword = generateTemporaryPassword();
  await replacePassword(uow.tx, user.id, {
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
    now: uow.now,
  });
  // A locked-out user can sign in with the new temporary password right away.
  await clearFailedLogins(uow.tx, accountThrottleKey(user.id));
  await uow.audit({
    action: "user.temporaryCredentialIssued",
    entityType: "user",
    entityId: user.id,
    // Deliberately no credential material, not even its length.
    data: { source, hadCredentials, changeRequiredAtSignIn: true },
  });
  return temporaryPassword;
}

/**
 * Hospital Admin issues (or resets to) a temporary password for one account.
 * `expectedHasCredentials` is what the admin's page showed, so two admins
 * cannot unknowingly overwrite each other's freshly issued password.
 */
export const issueTemporaryPassword = defineCommand({
  name: "user.issueTemporaryPassword",
  input: z.object({
    userId: z.uuid(),
    expectedHasCredentials: z.boolean().optional(),
  }),
  async handler(uow, input): Promise<{ temporaryPassword: string }> {
    await authorizeAdministration(uow, "user.issueTemporaryPassword");
    const user = await requireUser(uow, input.userId);
    if (
      input.expectedHasCredentials !== undefined &&
      (await hasAccountCredentials(uow.tx, user.id)) !==
        input.expectedHasCredentials
    )
      throw new ConflictError(undefined, "CREDENTIALS_CHANGED");
    return {
      temporaryPassword: await issueTemporaryPasswordFor(uow, user, "single"),
    };
  },
});
