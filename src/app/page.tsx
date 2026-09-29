import { redirect } from "next/navigation";

import { getShellContext } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { homePath } from "@/features/shell/navigation";

/** Sends each user to their default page, decided from database-loaded capabilities (D24). */
export default async function RootPage() {
  const ctx = await requireRequestContext();
  redirect(homePath(await getShellContext(ctx)));
}
