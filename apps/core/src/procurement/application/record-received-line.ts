import { executeReceivingCommand, type ReceivingAuthority } from "./execute-receiving-command";
export type { ReceivingResult } from "./execute-receiving-command";
export type RecordReceivedLineCommand = {
  receivingRecordId: string;
  acceptedDeltaBase: number;
  rejectedDeltaBase: number;
  shortageDeltaBase?: number;
  receiptKind?: "DELIVERY" | "REPLACEMENT";
  reason: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
  authority?: ReceivingAuthority;
};
export function recordReceivedLine(database: D1Database, command: RecordReceivedLineCommand) {
  return executeReceivingCommand(database, {
    ...command,
    action: command.receiptKind === "REPLACEMENT" ? "REPLACE" : "RECORD",
  });
}
