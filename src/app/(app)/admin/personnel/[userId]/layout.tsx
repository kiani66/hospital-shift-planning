import type { ReactNode } from "react";

import { readPersonPage } from "@/features/management/page-queries";

/** Unknown and denied detail resources are checked before streaming a loading fallback. */
export default async function PersonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ userId: string }>;
}) {
  await readPersonPage((await params).userId);
  return children;
}
