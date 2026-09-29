import "server-only";

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { getDb } from "../db/client";
import { authConfig } from "./config";
import { authenticateWithPassword, loginInputSchema } from "./credentials";

/** Too many failed attempts for this e-mail address; see `LOGIN_THROTTLE`. */
export class LoginThrottledError extends CredentialsSignin {
  override code = "throttled";
}

export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const input = loginInputSchema.safeParse(raw);
        if (!input.success) return null;
        const result = await authenticateWithPassword(getDb(), input.data);
        if (result.ok) return { id: result.userId };
        if (result.reason === "THROTTLED") throw new LoginThrottledError();
        return null;
      },
    }),
  ],
});
