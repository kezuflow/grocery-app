export type ServiceFeeType = "FLAT" | "PERCENTAGE" | "MIXED";

export type ServiceFeeCalculation = {
  configurationId: string;
  configurationVersion: number;
  feeType: ServiceFeeType;
  currency: string;
  flatMinor: number;
  percentageBasisPoints: number;
  baseMinor: number;
  feeMinor: number;
};

type ServiceFeeInput = {
  configurationId?: string;
  configurationVersion?: number;
  feeType: ServiceFeeType;
  currency?: string;
  flatMinor: number;
  basisPoints: number;
  baseMinor: number;
};

function requireSafeInteger(name: string, value: number, minimum: number, maximum?: number) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new RangeError(`${name} must be a safe integer in the supported range`);
  }
}

function validateConfiguration(input: ServiceFeeInput): void {
  requireSafeInteger("flatMinor", input.flatMinor, 0);
  requireSafeInteger("basisPoints", input.basisPoints, 0, 10_000);

  const valid =
    (input.feeType === "FLAT" && input.flatMinor > 0 && input.basisPoints === 0) ||
    (input.feeType === "PERCENTAGE" && input.flatMinor === 0 && input.basisPoints > 0) ||
    (input.feeType === "MIXED" && input.flatMinor > 0 && input.basisPoints > 0);
  if (!valid) throw new RangeError("Service Fee configuration does not match its fee type");
}

function percentageFeeMinor(baseMinor: number, basisPoints: number): number {
  const whole = Math.floor(baseMinor / 10_000) * basisPoints;
  const remainderProduct = (baseMinor % 10_000) * basisPoints;
  const fractional = Math.floor((remainderProduct + 9_999) / 10_000);
  const result = whole + fractional;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Calculated Service Fee must be a safe integer");
  }
  return result;
}

export function calculateServiceFee(input: ServiceFeeInput): ServiceFeeCalculation {
  requireSafeInteger("baseMinor", input.baseMinor, 0);
  validateConfiguration(input);

  const percentageMinor =
    input.feeType === "FLAT" ? 0 : percentageFeeMinor(input.baseMinor, input.basisPoints);
  const feeMinor = input.flatMinor + percentageMinor;
  if (!Number.isSafeInteger(feeMinor)) {
    throw new RangeError("Calculated Service Fee must be a safe integer");
  }

  return {
    configurationId: input.configurationId ?? "test-configuration",
    configurationVersion: input.configurationVersion ?? 1,
    feeType: input.feeType,
    currency: input.currency ?? "PHP",
    flatMinor: input.flatMinor,
    percentageBasisPoints: input.basisPoints,
    baseMinor: input.baseMinor,
    feeMinor,
  };
}
