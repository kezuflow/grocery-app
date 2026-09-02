import { AdminStatusPill, type AdminStatusTone } from "./admin-status-pill";

const issueStatusTone: Readonly<Record<string, AdminStatusTone>> = {
  SUBMITTED: "neutral",
  CLAIMED: "info",
  INVESTIGATING: "warning",
  ESCALATED: "danger",
  RESOLVED: "success",
};

export function OrderIssueStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return <AdminStatusPill status={status} tone={issueStatusTone[status]} className={className} />;
}
