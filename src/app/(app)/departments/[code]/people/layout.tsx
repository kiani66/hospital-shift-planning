import type { ReactNode } from "react";

import { readDepartmentPeoplePage } from "@/features/management/page-queries";

/** Guard before loading; the page still calls its trusted authorized query independently. */
export default async function PeopleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ code: string }>;
}) {
  await readDepartmentPeoplePage((await params).code);
  return children;
}
