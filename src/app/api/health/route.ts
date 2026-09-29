import { checkDatabaseHealth } from "@/infrastructure/db/health";

export async function GET() {
  const database = await checkDatabaseHealth();
  const healthy = database === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "error",
      checks: { database },
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
