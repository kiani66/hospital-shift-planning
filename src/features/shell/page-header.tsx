import { Construction } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <h1 className="text-xl leading-relaxed font-bold sm:text-2xl">{title}</h1>
      {description && (
        <p className="leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

/**
 * Clearly marks a page whose feature is not built yet. It must never imitate
 * a working workflow.
 */
export function NotYetImplemented({ plannedFor }: { plannedFor: string }) {
  return (
    <div
      role="note"
      aria-label="هنوز پیاده‌سازی نشده"
      className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/40 p-5"
    >
      <Construction
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
      />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">هنوز پیاده‌سازی نشده است</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          این بخش {plannedFor} ساخته می‌شود. فعلاً فقط مسیر و دسترسی آن آماده
          است.
        </p>
      </div>
    </div>
  );
}
