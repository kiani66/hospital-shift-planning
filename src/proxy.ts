import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_PATH } from "@/infrastructure/auth/config";

/**
 * Convenience only: sends requests without a valid session cookie to the
 * sign-in page (remembering where they were going). It is not the security
 * boundary; pages and actions check the database-built actor themselves, so
 * a deactivated user with a valid cookie still gets no access.
 *
 * Read-only on purpose: Auth.js's proxy wrapper re-issues the session cookie
 * on every response, so a request in flight during sign-out (e.g. a link
 * prefetch) could restore the session the user just ended. Sessions are
 * therefore absolute (12 hours from sign-in), not sliding.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === LOGIN_PATH) return NextResponse.next();

  const token = await getToken({
    // Only the session cookie counts (no Authorization header).
    req: { headers: { cookie: request.headers.get("cookie") ?? "" } },
    secret: process.env.AUTH_SECRET ?? "",
    secureCookie: request.nextUrl.protocol === "https:",
  }).catch(() => null);
  if (token?.sub) return NextResponse.next();

  const login = new URL(LOGIN_PATH, request.nextUrl.origin);
  if (pathname !== "/")
    login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except API routes, Next.js internals and static files.
  matcher: ["/((?!api/|_next/|favicon\\.ico$|.*\\.[a-zA-Z0-9]+$).*)"],
};
