import { executeReceivingCommand, type ReceivingAuthority } from "./execute-receiving-command";
export type StartReceivingCommand = {
  requirementId: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
  reason?: string;
  authority?: ReceivingAuthority;
};
export function startReceiving(database: D1Database, command: StartReceivingCommand) {
  return executeReceivingCommand(database, { ...command, action: "START" });
}
