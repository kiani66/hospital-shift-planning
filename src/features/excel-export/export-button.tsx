"use client";

import { FileDown } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * «خروجی اکسل» on the department's monthly schedule (D124): downloads the
 * schedule written into the department's Excel template, in any status. The
 * server authorizes and builds the file; errors (an unmatched personnel
 * number, an invalid template) are shown here instead of a broken download.
 * Without an active template the button stays visible but disabled, with
 * the reason and the way to the settings.
 */
export function ExcelExportButton({
  scheduleId,
  fileName,
  draftFileName,
  hasTemplate,
  revisionDraftAvailable,
  settingsHref,
}: {
  scheduleId: string;
  fileName: string;
  draftFileName: string;
  hasTemplate: boolean;
  revisionDraftAvailable: boolean;
  settingsHref: Route | null;
}) {
  const [pending, setPending] = useState<"official" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  async function download(draft: boolean) {
    setPending(draft ? "draft" : "official");
    setError(null);
    try {
      const response = await fetch(
        `/api/schedules/${scheduleId}/excel${draft ? "?source=revision-draft" : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? "ساخت فایل Excel ممکن نشد.");
        return;
      }
      // An expired session ends at the sign-in page, not at a workbook.
      if (
        response.redirected ||
        !response.headers
          .get("Content-Type")
          ?.startsWith("application/vnd.openxmlformats")
      ) {
        setError(
          "نشست شما به پایان رسیده است؛ صفحه را تازه کنید و دوباره وارد شوید.",
        );
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = draft ? draftFileName : fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("ارتباط با سرور برقرار نشد؛ دوباره تلاش کنید.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:items-start">
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
        <Button
          variant="outline"
          className="h-11 shrink-0"
          disabled={!hasTemplate || pending !== null}
          aria-describedby={!hasTemplate || error ? noteId : undefined}
          onClick={() => download(false)}
        >
          <FileDown aria-hidden className="size-5 shrink-0" />
          {pending === "official" ? "در حال ساخت…" : "خروجی اکسل"}
        </Button>
        {hasTemplate && revisionDraftAvailable && (
          <Button
            variant="outline"
            className="h-11 max-w-full shrink-0 whitespace-normal"
            disabled={pending !== null}
            onClick={() => download(true)}
          >
            {pending === "draft"
              ? "در حال ساخت…"
              : "خروجی پیش‌نویس بازبینی (تأییدنشده)"}
          </Button>
        )}
      </div>
      {!hasTemplate && (
        <p id={noteId} className="text-xs text-muted-foreground">
          برای خروجی اکسل ابتدا باید قالب Excel بخش بارگذاری شود
          {settingsHref ? (
            <>
              {" — "}
              <Link className="underline" href={settingsHref}>
                تنظیمات بخش
              </Link>
            </>
          ) : null}
          .
        </p>
      )}
      {hasTemplate && revisionDraftAvailable && !error && (
        <p className="text-xs text-muted-foreground">
          «خروجی اکسل» نسخه تأییدشده را می‌نویسد؛ تغییرات بازبینی فقط در خروجی
          پیش‌نویس هستند.
        </p>
      )}
      {error && (
        <p
          id={noteId}
          role="alert"
          className="max-w-prose text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
