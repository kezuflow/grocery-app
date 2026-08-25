export type Currency = "PHP" | (string & {});

export type Money = {
  amountMinor: number;
  currency: Currency;
};

export type BaseQuantity = {
  amount: number;
  unitCode: string;
};

export const OPERATIONAL_TIMEZONE = "Asia/Manila" as const;

export function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}
