import "server-only";

import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import {
  getDepartmentForPage,
  type DepartmentPageAction,
} from "@/application/workspace/queries";
import { requireRequestContext } from "@/features/auth/guards";

/**
 * The department in the URL if the trusted actor may open it for `action`;
 * otherwise a 404 that looks the same as for a department that does not exist.
 */
export async function requireDepartmentPage(
  params: Promise<{ code: string }>,
  action: DepartmentPageAction,
) {
  const ctx = await requireRequestContext();
  const { code } = await params;
  return getDepartmentForPage(ctx, code, action).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
}
