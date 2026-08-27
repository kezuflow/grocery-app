export function calculateDeliveryFee(input: {
  distanceMeters: number;
  perKilometerRateMinor: number;
  minimumDeliveryFeeMinor: number;
}): number {
  const values = [input.distanceMeters, input.perKilometerRateMinor, input.minimumDeliveryFeeMinor];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("DELIVERY_FEE_INPUT_INVALID");
  const product = input.distanceMeters * input.perKilometerRateMinor;
  if (!Number.isSafeInteger(product)) throw new Error("DELIVERY_FEE_INPUT_INVALID");
  return Math.max(input.minimumDeliveryFeeMinor, Math.ceil(product / 1_000));
}
