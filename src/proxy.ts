import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig, LOGIN_PATH } from "@/infrastructure/auth/config";

const { auth } = NextAuth(authConfig);

/**
 * Convenience only: sends requests without a valid session cookie to the
 * sign-in page (remembering where they were going). It is not the security
 * boundary; pages and actions check the database-built actor themselves, so
 * a deactivated user with a valid cookie still gets no access.
 */
export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  if (request.auth || pathname === LOGIN_PATH) return;
  const login = new URL(LOGIN_PATH, request.nextUrl.origin);
  if (pathname !== "/")
    login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
});

export const config = {
  // Everything except API routes, Next.js internals and static files.
  matcher: ["/((?!api/|_next/|favicon\\.ico$|.*\\.[a-zA-Z0-9]+$).*)"],
};
