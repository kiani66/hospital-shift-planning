import { authEnvStatus } from "@/infrastructure/config/env-schema";
import { checkDatabaseHealth } from "@/infrastructure/db/health";

export async function GET() {
  const database = await checkDatabaseHealth();
  // Sign-in cannot work without AUTH_SECRET; report it (never its value).
  const auth = authEnvStatus(process.env);
  const healthy = database === "ok" && auth === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "error",
      checks: { database, auth },
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
