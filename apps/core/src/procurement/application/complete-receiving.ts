import { executeReceivingCommand, type ReceivingAuthority } from "./execute-receiving-command";
export function completeReceiving(
  database: D1Database,
  command: {
    receivingRecordId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestId: string;
    reason?: string;
    authority?: ReceivingAuthority;
  },
) {
  return executeReceivingCommand(database, { ...command, action: "COMPLETE" });
}
