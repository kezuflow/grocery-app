import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "secondary" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-2 py-0.5 text-xs font-medium",
        variant === "default" ? "bg-white" : "bg-[var(--fm-surface-muted)]",
        className,
      )}
      {...props}
    />
  );
}
