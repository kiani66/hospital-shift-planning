/**
 * Where to go after signing in. Only same-site absolute paths are accepted;
 * anything else (other origins, `//host`, `/\host`, non-strings) falls back
 * to `/`, which routes the user to their home. Prevents open redirects.
 */
export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (/[\\\u0000-\u001f]/.test(value)) return "/";
  return value;
}
