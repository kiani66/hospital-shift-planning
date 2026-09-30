import type { ReactNode } from "react";

import { AppShell } from "@/features/shell/app-shell";
import { buildNavigation } from "@/features/shell/navigation";
import { loadShellContext } from "@/features/shell/shell-context";
import { APP_TIMEZONE, todayIn } from "@/infrastructure/auth/actor";

/**
 * The authenticated shell. Navigation comes from the database-built actor.
 * Not a security boundary on its own: every page authorizes again.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await loadShellContext();
  return (
    <AppShell
      context={context}
      navigation={buildNavigation(context)}
      today={todayIn(APP_TIMEZONE)}
    >
      {children}
    </AppShell>
  );
}
