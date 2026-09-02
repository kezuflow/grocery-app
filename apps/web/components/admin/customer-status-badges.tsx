import { AdminStatusPill, type AdminStatusTone } from "./admin-status-pill";

const membershipTones: Readonly<Record<string, AdminStatusTone>> = {
  PENDING: "warning",
  TRIALING: "info",
  ACTIVE: "success",
  PAST_DUE: "danger",
  UNPAID: "danger",
  PAUSED: "warning",
  CANCELED: "danger",
  EXPIRED: "neutral",
};

const privacyTones: Readonly<Record<string, AdminStatusTone>> = {
  SUBMITTED: "neutral",
  VERIFYING: "info",
  APPROVED: "accent",
  REJECTED: "danger",
  PROCESSING: "warning",
  COMPLETED: "success",
  ESCALATED: "danger",
};

export function CustomerAccessStatusBadge({ status }: { status: "active" | "disabled" }) {
  return <AdminStatusPill status={status} tone={status === "active" ? "success" : "danger"} />;
}

export function MembershipStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <AdminStatusPill status="NONE" label="No membership" />;
  }
  return <AdminStatusPill status={status} tone={membershipTones[status] ?? "neutral"} />;
}

export function PrivacyRequestStatusBadge({ status }: { status: string }) {
  return <AdminStatusPill status={status} tone={privacyTones[status] ?? "neutral"} />;
}
