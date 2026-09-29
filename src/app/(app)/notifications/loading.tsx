import { PageHeader } from "@/features/shell/page-header";

/** Shown while the list loads; announced once, not per placeholder row. */
export default function NotificationsLoading() {
  return (
    <>
      <PageHeader title="اعلان‌ها" />
      <div className="max-w-3xl" aria-busy="true">
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          در حال بارگذاری اعلان‌ها…
        </p>
        <ul aria-hidden="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-24 animate-pulse rounded-lg border bg-muted/50"
            />
          ))}
        </ul>
      </div>
    </>
  );
}
