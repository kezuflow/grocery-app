import { AdminStatusPill, type AdminStatusTone } from "./admin-status-pill";

const issueStatusTone: Readonly<Record<string, AdminStatusTone>> = {
  SUBMITTED: "neutral",
  CLAIMED: "info",
  INVESTIGATING: "info",
  ESCALATED: "info",
  RESOLVED: "success",
};

export function OrderIssueStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const label =
    status === "SUBMITTED" ? "New" : status === "RESOLVED" ? "Resolved" : "Being handled";
  return (
    <AdminStatusPill
      status={status}
      label={label}
      tone={issueStatusTone[status]}
      className={className}
    />
  );
}
