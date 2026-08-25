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

export type Clock = {
  now(): Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};

export function fixedClock(value: Date | string | number): Clock {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Clock value must be a valid date");
  return { now: () => new Date(instant.getTime()) };
}

export function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}
