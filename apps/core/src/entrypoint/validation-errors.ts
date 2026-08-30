import type { AppErrorCode } from "@freshmarkets/contracts";
import { validationMessage } from "../validation";

export function rpcFailure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

export function validationFailure(
  requestId: string,
  issues: Parameters<typeof validationMessage>[0],
) {
  return rpcFailure("VALIDATION_FAILED", validationMessage(issues), requestId);
}
