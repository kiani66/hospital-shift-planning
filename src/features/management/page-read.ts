import "server-only";

import { notFound } from "next/navigation";

import { NotFoundError } from "@/application/errors";
import { ForbiddenError } from "@/domain/shared/errors";

/** Denied and unknown management URLs have the same concealment response. */
export async function managementPageRead<T>(read: Promise<T>): Promise<T> {
  return read.catch((error) => {
    if (error instanceof NotFoundError || error instanceof ForbiddenError)
      notFound();
    throw error;
  });
}
