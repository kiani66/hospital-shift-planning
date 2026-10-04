import { ValidationError } from "../shared/errors";

/** Same bounds as account creation (D83); the upper cap bounds Argon2 work per request. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/**
 * Rules for a password a user chooses (self-service change, forced change after
 * a temporary password). Throws a ValidationError with a stable reason.
 * Passwords are compared as given: never trimmed, like the sign-in form.
 */
export function assertAcceptableNewPassword(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmation: string;
}): void {
  const { newPassword } = input;
  if (
    newPassword.length < PASSWORD_MIN_LENGTH ||
    newPassword.length > PASSWORD_MAX_LENGTH
  )
    throw new ValidationError(
      "New password length is out of range",
      "newPassword",
      "PASSWORD_LENGTH",
    );
  if (newPassword !== input.confirmation)
    throw new ValidationError(
      "Confirmation does not match",
      "confirmation",
      "PASSWORD_CONFIRMATION_MISMATCH",
    );
  if (newPassword === input.currentPassword)
    throw new ValidationError(
      "New password must differ from the current one",
      "newPassword",
      "PASSWORD_UNCHANGED",
    );
}
