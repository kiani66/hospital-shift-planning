import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * One hierarchy: `default` is the brand-blue primary action (one per area),
 * `secondary` a tinted supporting action, `outline` a neutral one, `ghost`
 * a quiet one, `destructive` an irreversible confirmation. Pressed states
 * darken slightly; disabled keeps its shape but loses color.
 */
const variants = {
  default:
    "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 active:bg-primary/95 disabled:bg-primary/55",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/70 active:bg-secondary disabled:opacity-60",
  outline:
    "border border-input bg-background shadow-xs hover:border-primary/35 hover:bg-accent hover:text-accent-foreground active:bg-secondary disabled:opacity-60",
  ghost:
    "hover:bg-accent hover:text-accent-foreground active:bg-secondary disabled:opacity-60",
  destructive:
    "bg-destructive text-white shadow-xs hover:bg-destructive/90 active:bg-destructive/95 disabled:bg-destructive/60",
} as const;

export type ButtonVariant = keyof typeof variants;

/** Buttons are at least 44px tall (touch target). */
export const buttonClasses = (
  variant: ButtonVariant = "default",
  className?: string,
) =>
  cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium whitespace-nowrap transition-colors",
    "focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed",
    variants[variant],
    className,
  );

export function Button({
  variant,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, className)}
      {...props}
    />
  );
}
