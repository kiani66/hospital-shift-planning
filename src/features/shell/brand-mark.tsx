import { Hospital } from "lucide-react";

import { cn } from "@/lib/utils";

/** The product name, as the shell and the login page show it. */
export const PRODUCT_NAME = "شیفت پرستاران";

/**
 * The product mark: the hospital icon in a brand-blue tile. Decorative; the
 * product name is always written next to it. Shared by the shell and the
 * login page so both carry the same identity.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm ring-1 ring-white/15",
        className,
      )}
    >
      <Hospital className="size-[60%]" />
    </span>
  );
}
