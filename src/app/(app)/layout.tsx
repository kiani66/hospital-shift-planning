import type { ReactNode } from "react";

import { getShellContext } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";
import { AppShell } from "@/features/shell/app-shell";
import { buildNavigation } from "@/features/shell/navigation";

/**
 * The authenticated shell. Navigation comes from the database-built actor.
 * Not a security boundary on its own: every page authorizes again.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await getShellContext(await requireRequestContext());
  return (
    <AppShell context={context} navigation={buildNavigation(context)}>
      {children}
    </AppShell>
  );
}
