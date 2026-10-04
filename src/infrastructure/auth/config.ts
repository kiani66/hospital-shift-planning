import { CredentialsSignin, type NextAuthConfig } from "next-auth";

/** A session lasts at most one long shift; access itself is re-checked on every request. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const LOGIN_PATH = "/login";

/** Where a signed-in user chooses a new password (forced after a temporary one). */
export const PASSWORD_CHANGE_PATH = "/account/password";

/**
 * Auth.js settings shared by the server (`./index`) and `proxy.ts`. Free of
 * database and Node-only imports so the proxy can verify the session cookie
 * without loading them.
 *
 * Session strategy: an encrypted JWT cookie holding only the user id (`sub`)
 * and the session version it was issued with (`sv`). The version is not an
 * authorization claim: `getActor()` compares it with the database and rejects
 * sessions issued before the last password change or reset. Roles,
 * memberships and active status are never put in it; they are loaded from the
 * database on every request.
 */
export const authConfig = {
  pages: { signIn: LOGIN_PATH },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // At sign-in, drop the default name/email/picture claims: id and version only.
      if (!user?.id) return token;
      const sv = (user as { sessionVersion?: unknown }).sessionVersion;
      return { sub: user.id, sv: typeof sv === "number" ? sv : 0 };
    },
    session({ session, token }) {
      return {
        expires: session.expires,
        user: { id: token.sub, sv: token.sv },
      } as unknown as typeof session;
    },
  },
  logger: {
    // Failed sign-ins are expected; log nothing about them (no identifier or
    // password ever reaches the logs). Other errors: name only.
    error(error) {
      if (error instanceof CredentialsSignin) return;
      console.error(`[auth] ${error.name}`);
    },
    warn(code) {
      console.warn(`[auth] warning: ${code}`);
    },
    debug() {},
  },
} satisfies NextAuthConfig;
