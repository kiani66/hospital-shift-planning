import type { ReactNode } from "react";

import { requirePersonnelReadAccess } from "@/application/management/personnel-queries";
import { requireRequestContext } from "@/features/auth/guards";
import { managementPageRead } from "@/features/management/page-read";

/** Check before this segment's loading boundary so denial is an HTTP 404. Pages authorize too. */
export default async function DirectoryLayout({
  children,
}: {
  children: ReactNode;
}) {
  await managementPageRead(
    requirePersonnelReadAccess(await requireRequestContext()),
  );
  return children;
}
