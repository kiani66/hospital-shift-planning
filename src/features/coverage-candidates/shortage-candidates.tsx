"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { AvailableCandidateView } from "@/application/schedules/coverage-candidates";
import type { DayReview, ReviewFinding } from "@/application/schedules/review";
import type { IsoDate } from "@/domain/shared/dates";
import type { CandidateShift } from "@/domain/candidates/evaluate-candidates";
import type { DatePeriod } from "@/domain/shared/period";
import { COVERAGE_PERIODS } from "@/domain/shifts/shift-type";
import { Button } from "@/components/ui/button";
import { FindingItem } from "@/features/schedule-review/finding-item";
import type { ShiftLabels } from "@/features/shifts/catalog";
import {
  readCoverageCandidatesAction,
  assignCoverageCandidateAction,
  type CandidateReadResult,
} from "./actions";
import { CandidateList } from "./candidate-list";
import { OffConfirmation } from "./off-confirmation";
import {
  candidateQueryError,
  candidateNetworkFailure,
  candidateAssignLabel,
  candidateSavedMessage,
  candidateWriteFindings,
  needsOffConfirmation,
} from "./presentation";

type Feedback = {
  message: string;
  error: boolean;
  findings?: readonly ReviewFinding[];
};

/** Own open targets independently of coverage/revision: a resolved target stays until manually closed. */
export function ShortageCandidates({
  scheduleId,
  date,
  coverage,
  period,
  revision,
  shiftLabels,
}: {
  scheduleId: string;
  date: IsoDate;
  coverage: DayReview["coverage"];
  period: DatePeriod;
  revision: number;
  /** Descriptive shift names (`shift_types.label`). */
  shiftLabels: ShiftLabels;
}) {
  const id = useId();
  const [opened, setOpened] = useState<readonly CandidateShift[]>([]);
  const [results, setResults] = useState<
    Partial<Record<CandidateShift, CandidateReadResult>>
  >({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmation, setConfirmation] = useState<{
    candidate: AvailableCandidateView;
    shift: CandidateShift;
    expectedRevision: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  // Covers the click-to-render interval as well as the request: one write/read batch per day surface.
  const busy = useRef(false);

  async function read(shift: CandidateShift) {
    let next: CandidateReadResult;
    try {
      next = await readCoverageCandidatesAction({ scheduleId, date, shift });
    } catch {
      next = { ok: false, message: candidateQueryError };
    }
    setResults((previous) => ({ ...previous, [shift]: next }));
    // A refreshed read invalidates an older OFF decision; it never retries a write.
    setConfirmation((previous) =>
      previous?.shift === shift &&
      (!next.ok ||
        next.data.revision !== previous.expectedRevision ||
        next.data.status !== "SHORTAGE" ||
        !next.data.canAssign ||
        !next.data.available.some(
          (person) => person.userId === previous.candidate.userId,
        ))
        ? null
        : previous,
    );
    return next;
  }
  function run(work: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try {
        await work();
      } finally {
        busy.current = false;
      }
    });
  }
  // Ordinary page refreshes also invalidate an open read; assignment refresh does the same explicitly.
  useEffect(() => {
    if (pending || busy.current) return;
    const stale = opened.filter((shift) => {
      const result = results[shift];
      return result?.ok && result.data.revision < revision;
    });
    if (stale.length)
      run(async () => {
        await Promise.all(stale.map(read));
      });
  });

  function assign(
    candidate: AvailableCandidateView,
    shift: CandidateShift,
    expectedRevision: number,
  ) {
    const result = results[shift];
    if (
      busy.current ||
      !result?.ok ||
      result.data.status !== "SHORTAGE" ||
      !result.data.canAssign ||
      result.data.revision !== expectedRevision ||
      !result.data.available.some(
        (person) => person.userId === candidate.userId,
      )
    )
      return;
    run(async () => {
      let outcome;
      try {
        outcome = await assignCoverageCandidateAction({
          scheduleId,
          date,
          shift,
          nurseId: candidate.userId,
          expectedRevision,
        });
      } catch {
        outcome = { ok: false as const, ...candidateNetworkFailure };
      }
      setConfirmation(null);
      if (outcome.ok || outcome.refresh) {
        // Re-read every open period: subsequent assignments use the returned current revision.
        const reads = await Promise.all(opened.map(read));
        const refreshed = reads.every((next) => next.ok);
        setFeedback(
          outcome.ok
            ? {
                error: false,
                message: candidateSavedMessage(
                  shift,
                  candidate.displayName,
                  shiftLabels,
                ),
              }
            : {
                error: true,
                message:
                  outcome.message +
                  (refreshed ? " اطلاعات به‌روزرسانی شد." : ""),
                findings: candidateWriteFindings(
                  outcome.violations ?? [],
                  period,
                  candidate,
                ),
              },
        );
      } else setFeedback({ error: true, message: outcome.message });
    });
  }
  const visible = COVERAGE_PERIODS.filter(
    (shift) =>
      opened.includes(shift) ||
      coverage.some((c) => c.period === shift && c.status === "BELOW_MINIMUM"),
  );
  if (!visible.length) return null;
  return (
    <section
      aria-label="افراد برای جبران کمبود"
      aria-busy={pending}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <h3 className="text-sm font-semibold">افراد برای جبران کمبود</h3>
      {feedback && !pending && (
        <div className="flex flex-col gap-2">
          <p
            role={feedback.error ? "alert" : "status"}
            className="text-sm leading-relaxed"
          >
            {feedback.message}
          </p>
          {!!feedback.findings?.length && (
            <ul className="flex flex-col gap-2">
              {feedback.findings.map((finding, index) => (
                <FindingItem
                  key={index}
                  finding={finding}
                  linked={false}
                  shiftLabels={shiftLabels}
                />
              ))}
            </ul>
          )}
        </div>
      )}
      {pending && <p role="status">در حال دریافت یا ثبت اطلاعات…</p>}
      {visible.map((shift) => {
        const open = opened.includes(shift);
        const result = results[shift];
        return (
          <div key={shift} className="flex min-w-0 flex-col gap-2">
            <Button
              variant="outline"
              aria-expanded={open}
              aria-controls={`${id}-${shift}`}
              disabled={pending}
              onClick={() => {
                if (busy.current) return;
                setOpened((previous) =>
                  open
                    ? previous.filter((p) => p !== shift)
                    : [...previous, shift],
                );
                if (!open)
                  run(async () => {
                    await read(shift);
                  });
              }}
            >
              افراد برای کمبود {shiftLabels[shift]} ({shift})
            </Button>
            <div
              id={`${id}-${shift}`}
              hidden={!open}
              className="flex min-w-0 flex-col gap-2"
            >
              {result &&
                (result.ok ? (
                  <>
                    {result.data.status === "SHORTAGE" &&
                      !result.data.canAssign && (
                        <p className="text-xs text-muted-foreground">
                          فقط مشاهده؛ تخصیص شیفت برای این روز در دسترس نیست.
                        </p>
                      )}
                    <CandidateList
                      data={result.data}
                      shiftLabels={shiftLabels}
                      assignControl={(candidate) => (
                        <Button
                          disabled={pending}
                          aria-label={`${candidateAssignLabel(shift, shiftLabels)} برای ${candidate.displayName}`}
                          onClick={() => {
                            if (busy.current) return;
                            if (needsOffConfirmation(candidate))
                              setConfirmation({
                                candidate,
                                shift,
                                expectedRevision: result.data.revision,
                              });
                            else assign(candidate, shift, result.data.revision);
                          }}
                        >
                          {pending
                            ? "در حال انجام…"
                            : candidateAssignLabel(shift, shiftLabels)}
                        </Button>
                      )}
                    />
                  </>
                ) : (
                  <>
                    <p role="alert">{result.message}</p>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          await read(shift);
                        })
                      }
                    >
                      تلاش دوباره
                    </Button>
                  </>
                ))}
            </div>
          </div>
        );
      })}
      {confirmation && (
        <OffConfirmation
          {...confirmation}
          date={date}
          shiftLabels={shiftLabels}
          pending={pending}
          onCancel={() => {
            if (!busy.current) setConfirmation(null);
          }}
          onConfirm={() =>
            assign(
              confirmation.candidate,
              confirmation.shift,
              confirmation.expectedRevision,
            )
          }
        />
      )}
    </section>
  );
}
