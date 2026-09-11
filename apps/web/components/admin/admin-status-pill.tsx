import { cn } from "../../lib/utils";

export type AdminStatusTone = "success" | "warning" | "info" | "accent" | "danger" | "neutral";

/** Shared presentation for every admin status pill; tones live in globals.css. */
export const adminStatusPillClassName = cn(
  "inline-flex min-h-6 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
);

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function AdminStatusPill({
  status,
  tone = "neutral",
  label,
  className,
}: {
  status: string;
  tone?: AdminStatusTone;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn(adminStatusPillClassName, `fm-admin-status-${tone}`, className)}>
      {label ?? statusLabel(status)}
    </span>
  );
}
