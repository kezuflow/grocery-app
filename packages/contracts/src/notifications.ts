export const invitationEmailStatuses = [
  "NOT_REQUESTED",
  "QUEUED",
  "SENDING",
  "ACCEPTED",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "CANCELED",
] as const;
export type InvitationEmailStatus = (typeof invitationEmailStatuses)[number];
