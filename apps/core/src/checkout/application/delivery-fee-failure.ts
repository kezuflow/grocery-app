import { appErrorCodes, type AppErrorCode } from "@freshmarkets/contracts";

export function deliveryFeeFailure(error: unknown, requestId: string) {
  const observedCode =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "ROUTE_DISTANCE_UNAVAILABLE";
  const code: AppErrorCode = appErrorCodes.includes(observedCode as AppErrorCode)
    ? (observedCode as AppErrorCode)
    : "ROUTE_DISTANCE_UNAVAILABLE";

  return {
    ok: false as const,
    error: { code, message: "Delivery fee could not be calculated", requestId },
  };
}
