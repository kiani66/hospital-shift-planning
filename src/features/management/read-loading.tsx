export function ReadLoading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <p role="status" className="text-sm text-muted-foreground">
        در حال بارگذاری اطلاعات افراد…
      </p>
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border bg-muted/50"
          />
        ))}
      </div>
    </div>
  );
}
