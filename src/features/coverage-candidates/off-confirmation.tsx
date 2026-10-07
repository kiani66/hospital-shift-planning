"use client";
import type { AvailableCandidateView } from "@/application/schedules/coverage-candidates";
import type { IsoDate } from "@/domain/shared/dates";
import type { CandidateShift } from "@/domain/candidates/evaluate-candidates";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { candidateAssignLabel, offReplacementMessage } from "./presentation";

export function OffConfirmation({
  candidate,
  date,
  shift,
  pending,
  onCancel,
  onConfirm,
}: {
  candidate: AvailableCandidateView;
  date: IsoDate;
  shift: CandidateShift;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      title="جایگزینی تصمیم OFF"
      description={offReplacementMessage(candidate, date, shift)}
      onClose={onCancel}
      preventClose={pending}
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          autoFocus
          disabled={pending}
          onClick={onCancel}
        >
          انصراف
        </Button>
        <Button disabled={pending} onClick={onConfirm}>
          {pending ? "در حال تخصیص…" : candidateAssignLabel(shift)}
        </Button>
      </div>
    </Dialog>
  );
}
