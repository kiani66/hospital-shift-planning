import type { AssignmentCode } from "@/domain/shifts/shift-type";
import { cn } from "@/lib/utils";

import { ASSIGNMENT_PRESENTATION } from "./catalog";

const SIZES = {
  xs: "min-w-6 px-1 text-[0.6875rem] leading-4",
  sm: "min-w-7 px-1.5 text-xs leading-5",
  md: "min-w-9 px-1.5 py-0.5 text-sm",
} as const;

const ICON_SIZES = {
  xs: "size-3",
  sm: "size-3.5",
  md: "size-4",
} as const;

/**
 * A scheduling decision as a chip. A working shift shows its code
 * (left-to-right, so "ME" never flips); the color comes from the catalog's
 * `shift-*` tokens and only reinforces it. OFF is not a working shift: it
 * reads «استراحت» on a neutral surface. `solid` fills the chip (a selected or
 * assigned decision); `soft` keeps a neutral surface with the text color, for
 * dense views where many chips would otherwise turn into a rainbow.
 * `label` adds the Persian name after a working shift's code (OFF already
 * shows it); `icon` adds the catalog's decorative glyph before it (hidden
 * from assistive technology).
 */
export function ShiftChip({
  code,
  size = "sm",
  variant = "solid",
  label = false,
  icon = false,
  className,
}: {
  code: AssignmentCode;
  size?: keyof typeof SIZES;
  variant?: "solid" | "soft";
  label?: boolean | "full";
  icon?: boolean;
  className?: string;
}) {
  const shift = ASSIGNMENT_PRESENTATION[code];
  const Icon = shift.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded font-bold",
        SIZES[size],
        variant === "solid"
          ? shift.tokenClass
          : cn("border bg-background", shift.accentClass),
        className,
      )}
    >
      {icon && (
        <Icon aria-hidden="true" className={cn("shrink-0", ICON_SIZES[size])} />
      )}
      <span dir={code === "OFF" ? undefined : "ltr"}>
        {code === "OFF" ? shift.name : code}
      </span>
      {label && code !== "OFF" && (
        <span className="font-medium">
          {label === "full" ? shift.fullName : shift.name}
        </span>
      )}
    </span>
  );
}
