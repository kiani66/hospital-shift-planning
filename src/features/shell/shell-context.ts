import "server-only";

import { cache } from "react";

import { getShellContext } from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";

/**
 * The shell read model for this request, loaded once even when the layout
 * and a page both need it. Each caller still goes through
 * `requireRequestContext()` (signed-in, active user) on its first call.
 */
export const loadShellContext = cache(async () =>
  getShellContext(await requireRequestContext()),
);
