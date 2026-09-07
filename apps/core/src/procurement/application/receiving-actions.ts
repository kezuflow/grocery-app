/** Owning read policy; commands recheck these mutable conditions inside their batch. */
export function receivingActions(input: {
  status: string;
  requirementStatus: string;
  expected: number;
  accepted: number;
  rejected: number;
}): Array<"START" | "RECORD" | "COMPLETE"> {
  if (
    input.status === "DISCREPANCY" &&
    ["RECEIVED", "EXCEPTION"].includes(input.requirementStatus) &&
    input.accepted + input.rejected === input.expected
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
  if (
    ["IN_PROGRESS", "DISCREPANCY"].includes(input.status) &&
    input.accepted + input.rejected < input.expected
  )
    return ["RECORD"];
  return [];
}
