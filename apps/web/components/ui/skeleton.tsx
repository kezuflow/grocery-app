import * as React from "react";
import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--fm-radius-control)] bg-[var(--fm-surface-muted)]",
        className,
      )}
      {...props}
    />
  );
}
