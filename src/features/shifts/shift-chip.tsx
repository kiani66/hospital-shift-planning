import { cn } from "@/lib/utils";

import { SHIFT_DISPLAY, type ShiftDisplayCode } from "./catalog";

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
 * A shift code as a chip. The code text is always rendered (left-to-right,
 * so "ME" never flips); the color comes from the catalog's `shift-*` tokens
 * and only reinforces it. `solid` fills the chip (a selected or assigned
 * shift); `soft` keeps a neutral surface with the shift's text color, for
 * dense views where many chips would otherwise turn into a rainbow.
 * `label` adds the Persian name after the code; `icon` adds the catalog's
 * decorative glyph before it (hidden from assistive technology).
 */
export function ShiftChip({
  code,
  size = "sm",
  variant = "solid",
  label = false,
  icon = false,
  className,
}: {
  code: ShiftDisplayCode;
  size?: keyof typeof SIZES;
  variant?: "solid" | "soft";
  label?: boolean | "full";
  icon?: boolean;
  className?: string;
}) {
  const shift = SHIFT_DISPLAY[code];
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
      <span dir="ltr">{code}</span>
      {label && (
        <span className="font-medium">
          {label === "full" ? shift.fullName : shift.name}
        </span>
      )}
    </span>
  );
}
