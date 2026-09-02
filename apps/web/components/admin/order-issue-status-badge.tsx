import { cn } from "../../lib/utils";

const issueStatusTone: Readonly<Record<string, string>> = {
  SUBMITTED: "fm-order-status-neutral",
  CLAIMED: "fm-order-status-info",
  INVESTIGATING: "fm-order-status-warning",
  ESCALATED: "fm-order-status-danger",
  RESOLVED: "fm-order-status-success",
};

function issueStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function OrderIssueStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        issueStatusTone[status] ?? "fm-order-status-neutral",
        className,
      )}
    >
      {issueStatusLabel(status)}
    </span>
  );
}
