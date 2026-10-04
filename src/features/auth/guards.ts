import "server-only";

import { redirect } from "next/navigation";

import {
  getPasswordChangeContext,
  getRequestContext,
  getSessionState,
} from "@/infrastructure/auth/session";
import { LOGIN_PATH, PASSWORD_CHANGE_PATH } from "@/infrastructure/auth/config";

/**
 * The trusted request context (database, actor) or a redirect. Every protected
 * page and Server Action calls this itself: layouts and `proxy.ts` are not a
 * security boundary. No session, a deleted or deactivated user and a session
 * issued before the last password change (even with a still-valid cookie) all
 * end up signed out; a user holding a temporary password is sent to change it
 * and gets no actor anywhere else, so typing another URL cannot bypass it.
 */
export async function requireRequestContext() {
  const ctx = await getRequestContext();
  if (ctx) return ctx;
  const state = await getSessionState();
  redirect(
    state.status === "passwordChangeRequired"
      ? PASSWORD_CHANGE_PATH
      : LOGIN_PATH,
  );
}

/** For the password-change page and action: signed in, temporary password or not. */
export async function requirePasswordChangeContext() {
  const ctx = await getPasswordChangeContext();
  if (!ctx) redirect(LOGIN_PATH);
  return ctx;
}
