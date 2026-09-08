import type { InvitationEmailStatus } from "@freshmarkets/contracts";
const labels: Record<InvitationEmailStatus, string> = {
  NOT_REQUESTED: "Email was not queued for this older invitation.",
  QUEUED: "Invitation email queued.",
  SENDING: "Invitation email is being submitted.",
  ACCEPTED: "Email accepted for delivery.",
  FAILED: "Email could not be sent. Check notification delivery setup.",
  OUTCOME_UNKNOWN: "Email submission is unconfirmed; automatic resend is stopped.",
  CANCELED: "Pending invitation email canceled.",
};
export function InvitationEmailStatusText({ status }: { status: InvitationEmailStatus }) {
  return <p className="text-sm text-[var(--fm-text-muted)]">{labels[status]}</p>;
}
