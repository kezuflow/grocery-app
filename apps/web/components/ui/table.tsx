import * as React from "react";
import { cn } from "../../lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  const label = props["aria-label"] ?? "Data table";
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="relative w-full overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
    >
      <table
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-[var(--fm-border)]", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-[var(--fm-border)]", className)} {...props} />;
}

export function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn("border-t border-[var(--fm-border)] bg-[var(--fm-surface-soft)]", className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr className={cn("transition-colors hover:bg-[var(--fm-hover)]", className)} {...props} />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.08em] text-[var(--fm-text-muted)]",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}

export function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption className={cn("mt-3 text-xs text-[var(--fm-text-muted)]", className)} {...props} />
  );
}
