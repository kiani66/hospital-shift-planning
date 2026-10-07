"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { NotFoundError } from "@/application/errors";
import {
  getCoverageCandidates,
  assignCoverageCandidate,
  assignCoverageCandidateInput,
  type CoverageCandidates,
} from "@/application/schedules/coverage-candidates";
import { isIsoDate } from "@/domain/shared/dates";
import { requireRequestContext } from "@/features/auth/guards";
import {
  candidateAccessError,
  candidateQueryError,
  candidateWriteFailure,
  candidateNetworkFailure,
  type CandidateWriteFailure,
} from "./presentation";

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

export type CandidateAssignResult =
  { readonly ok: true } | ({ readonly ok: false } & CandidateWriteFailure);

/** The existing command owns all write invariants. No new revision is fetched here. */
export async function assignCoverageCandidateAction(
  input: unknown,
): Promise<CandidateAssignResult> {
  const parsed = assignCoverageCandidateInput.safeParse(input);
  const ctx = await requireRequestContext();
  if (!parsed.success)
    return {
      ok: false,
      ...candidateWriteFailure({ code: "VALIDATION", message: "" }),
    };
  try {
    const result = await assignCoverageCandidate(ctx, parsed.data);
    if (result.ok) {
      refresh();
      return { ok: true };
    }
    const failure = candidateWriteFailure(result.error);
    if (failure.refresh) refresh();
    return { ok: false, ...failure };
  } catch {
    return { ok: false, ...candidateNetworkFailure };
  }
}
