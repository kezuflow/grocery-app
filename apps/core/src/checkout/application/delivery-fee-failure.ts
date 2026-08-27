export function deliveryFeeFailure(error: unknown, requestId: string) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "ROUTE_DISTANCE_UNAVAILABLE";

  return {
    ok: false as const,
    error: { code, message: "Delivery fee could not be calculated", requestId },
  };
}
