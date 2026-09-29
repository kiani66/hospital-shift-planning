import "server-only";

import { redirect } from "next/navigation";

import { getRequestContext } from "@/infrastructure/auth/session";
import { LOGIN_PATH } from "@/infrastructure/auth/config";

/**
 * The trusted request context (database, actor) or a redirect to sign-in.
 * Every protected page and Server Action calls this itself: layouts and
 * `proxy.ts` are not a security boundary. No session, a deleted user and a
 * deactivated user (even with a still-valid cookie) all end up signed out.
 */
export async function requireRequestContext() {
  const ctx = await getRequestContext();
  if (!ctx) redirect(LOGIN_PATH);
  return ctx;
}
