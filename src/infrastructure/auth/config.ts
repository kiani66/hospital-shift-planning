import { CredentialsSignin, type NextAuthConfig } from "next-auth";

/** A session lasts at most one long shift; access itself is re-checked on every request. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const LOGIN_PATH = "/login";

/**
 * Auth.js settings shared by the server (`./index`) and `proxy.ts`. Free of
 * database and Node-only imports so the proxy can verify the session cookie
 * without loading them.
 *
 * Session strategy: an encrypted JWT cookie holding only the user id (`sub`).
 * Roles, memberships and active status are never put in it; `getActor()`
 * loads them from the database on every request.
 */
export const authConfig = {
  pages: { signIn: LOGIN_PATH },
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      // At sign-in, drop the default name/email/picture claims: id only.
      return user?.id ? { sub: user.id } : token;
    },
    session({ session, token }) {
      return {
        expires: session.expires,
        user: { id: token.sub },
      } as typeof session;
    },
  },
  logger: {
    // Failed sign-ins are expected; log nothing about them (no e-mail or
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
