import type { OrderMessageView } from "@freshmarkets/contracts";

type Side = "CUSTOMER" | "ADMIN";

export function isIncomingOrderMessage(side: Side, sender: OrderMessageView["senderKind"]) {
  return side === "ADMIN" ? sender === "CUSTOMER" : sender !== "CUSTOMER";
}

export function orderMessageSoundIdentity(orderId: string, sequence: number) {
  return `message:${orderId}:${sequence}`;
}

export function newOrderMessageSoundIdentities(
  orderId: string,
  recentIncomingSequences: readonly number[],
  afterSequence: number,
) {
  return recentIncomingSequences
    .filter((sequence) => sequence > afterSequence)
    .map((sequence) => orderMessageSoundIdentity(orderId, sequence));
}
