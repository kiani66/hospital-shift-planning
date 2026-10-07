"use server";

import { z } from "zod";
import { NotFoundError } from "@/application/errors";
import {
  getCoverageCandidates,
  type CoverageCandidates,
} from "@/application/schedules/coverage-candidates";
import { isIsoDate } from "@/domain/shared/dates";
import { requireRequestContext } from "@/features/auth/guards";
import { candidateAccessError, candidateQueryError } from "./presentation";

export type CandidateReadResult =
  { ok: true; data: CoverageCandidates } | { ok: false; message: string };
const target = z.object({
  scheduleId: z.uuid(),
  date: z.string().refine(isIsoDate),
  shift: z.enum(["M", "E", "N"]),
});

/** Read-only adapter. The query authorizes using the schedule's own department. */
export async function readCoverageCandidatesAction(
  input: unknown,
): Promise<CandidateReadResult> {
  const parsed = target.safeParse(input);
  const ctx = await requireRequestContext();
  if (!parsed.success)
    return { ok: false, message: "اطلاعات درخواست معتبر نیست." };
  try {
    return { ok: true, data: await getCoverageCandidates(ctx, parsed.data) };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof NotFoundError
          ? candidateAccessError
          : candidateQueryError,
    };
  }
}
