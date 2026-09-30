import { initials } from "./presentation";

/**
 * A small round avatar. There are no profile images yet (no column exists),
 * so the initials monogram is what shows; `imageUrl` is ready for when one
 * does. Decorative: the name is always written next to it.
 */
export function NurseAvatar({
  displayName,
  imageUrl,
}: {
  displayName: string;
  imageUrl?: string | null;
}) {
  if (imageUrl)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-supplied URL, no loader configured
      <img
        src={imageUrl}
        alt=""
        className="size-8 shrink-0 rounded-full object-cover"
      />
    );
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initials(displayName)}
    </span>
  );
}
