import { cn } from "../../lib/utils";

export type AdminStatusTone = "success" | "warning" | "info" | "accent" | "danger" | "neutral";

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
    <span
      className={cn(
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        `fm-admin-status-${tone}`,
        className,
      )}
    >
      {label ?? statusLabel(status)}
    </span>
  );
}
