"use server";

import { CredentialsSignin } from "next-auth";

import { LOGIN_PATH } from "@/infrastructure/auth/config";
import { loginInputSchema } from "@/infrastructure/auth/credentials";
import { signIn, signOut } from "@/infrastructure/auth";

import { safeRedirectPath } from "./safe-redirect";

export interface LoginState {
  /** One generic message for every credential failure (no account enumeration). */
  readonly error?: "invalid" | "throttled";
  /** Echoed back so the field keeps its value; the password never is. */
  readonly email?: string;
}

export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const rawEmail = formData.get("email");
  const email = typeof rawEmail === "string" ? rawEmail.slice(0, 320) : "";
  const input = loginInputSchema.safeParse({
    email: rawEmail,
    password: formData.get("password"),
  });
  if (!input.success) return { error: "invalid", email };

  try {
    await signIn("credentials", {
      ...input.data,
      redirectTo: safeRedirectPath(formData.get("callbackUrl")),
    });
  } catch (error) {
    if (error instanceof CredentialsSignin)
      return {
        error: error.code === "throttled" ? "throttled" : "invalid",
        email,
      };
    // A successful sign-in "throws" Next's redirect; let it through.
    throw error;
  }
  return {};
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: LOGIN_PATH });
}
