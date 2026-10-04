import { z } from "zod";

import {
  assertAcceptableNewPassword,
  PASSWORD_MAX_LENGTH,
} from "../../domain/identity/password-policy";
import { accountThrottleKey } from "../../infrastructure/auth/credentials";
import {
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from "../../infrastructure/auth/password";
import {
  clearFailedLogins,
  findActiveLockout,
  recordFailedLogin,
} from "../../infrastructure/repositories/login-throttles";
import {
  findUserById,
  lockPasswordState,
  replacePassword,
} from "../../infrastructure/repositories/users";
import { NotFoundError } from "../errors";
import { defineCommand } from "../use-case";

export type ChangeOwnPasswordOutcome =
  | {
      readonly status: "CHANGED";
      /**
       * How the caller signs the user in again (a new session with the new
       * session version): the personnel number, else the e-mail. Never sent
       * to the browser.
       */
      readonly loginIdentifier: string;
      readonly wasForced: boolean;
    }
  /** The current password was wrong; counted like a failed sign-in. */
  | { readonly status: "INVALID_CURRENT_PASSWORD" }
  /** Too many failed attempts on this account (sign-in or here). */
  | { readonly status: "THROTTLED" };

/**
 * Self-service password change, also the forced change after a temporary
 * password. The current password is always required, so a hijacked session
 * cannot silently take over the account; wrong attempts count against the
 * same account-level throttle as sign-in (they are committed, not rolled back).
 * Success replaces the hash, clears the forced-change flag and bumps the
 * session version: every other session of the user ends on its next request.
 */
export const changeOwnPassword = defineCommand({
  name: "account.changeOwnPassword",
  input: z.object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().max(PASSWORD_MAX_LENGTH),
    confirmation: z.string().max(PASSWORD_MAX_LENGTH),
  }),
  async handler(uow, input): Promise<ChangeOwnPasswordOutcome> {
    const userId = uow.actor.userId;
    uow.authorize("account.changeOwnPassword", { userId });
    assertAcceptableNewPassword(input);

    // Serializes concurrent changes of one account (two tabs).
    const stored = await lockPasswordState(uow.tx, userId);
    const user = await findUserById(uow.tx, userId);
    if (!stored || !user) throw new NotFoundError("User");

    const key = accountThrottleKey(userId);
    if (await findActiveLockout(uow.tx, key, uow.now))
      return { status: "THROTTLED" };
    const valid = stored.passwordHash
      ? await verifyPassword(stored.passwordHash, input.currentPassword)
      : await verifyAgainstDummy(input.currentPassword);
    if (!valid) {
      await recordFailedLogin(uow.tx, key, uow.now);
      return { status: "INVALID_CURRENT_PASSWORD" };
    }

    const wasForced = stored.mustChangePassword;
    await replacePassword(uow.tx, userId, {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      now: uow.now,
    });
    await clearFailedLogins(uow.tx, key);
    await uow.audit({
      action: "user.credentialsChanged",
      entityType: "user",
      entityId: userId,
      data: { source: "selfService", afterTemporary: wasForced },
    });
    return {
      status: "CHANGED",
      loginIdentifier: (user.personnelNumber ?? user.email)!,
      wasForced,
    };
  },
});
