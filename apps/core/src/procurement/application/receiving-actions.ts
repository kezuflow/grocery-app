/** Owning read policy; commands recheck these mutable conditions inside their batch. */
export function receivingActions(input: {
  status: string;
  requirementStatus: string;
  expected: number;
  accepted: number;
  rejected: number;
  shortage?: number;
  replacement?: number;
  replacementAllowed?: boolean;
}): Array<"START" | "RECORD" | "REPLACE" | "COMPLETE"> {
  const accounted =
    input.accepted + input.rejected + (input.shortage ?? 0) - (input.replacement ?? 0);
  if (
    ["DISCREPANCY", "COMPLETED"].includes(input.status) &&
    ["RECEIVED", "EXCEPTION", "PARTIALLY_RECEIVED"].includes(input.requirementStatus) &&
    accounted === input.expected &&
    input.accepted < input.expected
  )
    return input.replacementAllowed === false
      ? input.status === "DISCREPANCY"
        ? ["COMPLETE"]
        : []
      : input.status === "DISCREPANCY"
        ? ["REPLACE", "COMPLETE"]
        : ["REPLACE"];
  if (
    input.status === "DISCREPANCY" &&
    ["RECEIVED", "EXCEPTION"].includes(input.requirementStatus) &&
    accounted === input.expected
  )
    return ["COMPLETE"];
  if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(input.requirementStatus)) return [];
  if (
    input.status === "NOT_STARTED" &&
    input.accepted === 0 &&
    input.rejected === 0 &&
    input.expected > 0
  )
    return ["START"];
  if (["IN_PROGRESS", "DISCREPANCY"].includes(input.status) && accounted < input.expected)
    return ["RECORD"];
  return [];
}
