import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-[var(--fm-background)] px-3 py-2 text-sm text-[var(--fm-text)] placeholder:text-[var(--fm-disabled)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
