"use server";

import { CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";

import { changeOwnPassword } from "@/application/account/password";
import { signIn } from "@/infrastructure/auth";
import { LOGIN_PATH } from "@/infrastructure/auth/config";

import { requirePasswordChangeContext } from "./guards";

export interface PasswordChangeState {
  readonly error?:
    | "invalidCurrent"
    | "throttled"
    | "length"
    | "mismatch"
    | "unchanged"
    | "failed";
  readonly at?: number;
}

const REASONS: Record<string, PasswordChangeState["error"]> = {
  PASSWORD_LENGTH: "length",
  PASSWORD_CONFIRMATION_MISMATCH: "mismatch",
  PASSWORD_UNCHANGED: "unchanged",
};

const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Thin adapter: trusted context (also for a user holding a temporary
 * password), then the command. On success every older session of the user is
 * already invalid (session version bump), so the user is signed in again with
 * the new password, which issues a cookie for the new version, and lands on
 * their default page. Passwords are never echoed back.
 */
export async function changePasswordAction(
  _previous: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const ctx = await requirePasswordChangeContext();
  const newPassword = field(formData, "newPassword");
  const result = await changeOwnPassword(
    { db: ctx.db, actor: ctx.actor },
    {
      currentPassword: field(formData, "currentPassword"),
      newPassword,
      confirmation: field(formData, "confirmation"),
    },
  );
  const at = Date.now();
  if (!result.ok)
    return {
      error:
        (result.error.reason ? REASONS[result.error.reason] : undefined) ??
        (result.error.code === "VALIDATION" ? "length" : "failed"),
      at,
    };
  if (result.data.status === "INVALID_CURRENT_PASSWORD")
    return { error: "invalidCurrent", at };
  if (result.data.status === "THROTTLED") return { error: "throttled", at };

  try {
    // Throws Next's redirect on success, with the new session cookie set.
    await signIn("credentials", {
      identifier: result.data.loginIdentifier,
      password: newPassword,
      redirectTo: "/",
    });
  } catch (error) {
    // The password is changed either way; only the automatic sign-in failed.
    if (error instanceof CredentialsSignin) redirect(LOGIN_PATH);
    throw error;
  }
  return {};
}
