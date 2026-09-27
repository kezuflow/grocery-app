import { cn } from "../../lib/utils";
import { Badge } from "./shadcn/badge";

export type AdminStatusTone = "success" | "warning" | "info" | "accent" | "danger" | "neutral";

export const adminStatusVariant = {
  success: "secondary",
  warning: "outline",
  info: "outline",
  accent: "secondary",
  danger: "destructive",
  neutral: "outline",
} as const;

/** Shared status labels rendered with the configured stock shadcn Badge. */
export const adminStatusPillClassName = "whitespace-nowrap";

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
    <Badge variant={adminStatusVariant[tone]} className={cn(adminStatusPillClassName, className)}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}
