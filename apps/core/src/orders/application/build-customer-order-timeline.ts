import type { CustomerTimelineEntry } from "@freshmarkets/contracts";

export type CustomerTimelineFact = {
  type: CustomerTimelineEntry["type"];
  id: string;
  status: string;
  occurredAt: number;
};

const titles: Record<CustomerTimelineEntry["type"], string> = {
  ORDER_COMMITTED: "Order confirmed",
  PAYMENT_STATUS: "Payment update",
  FULFILLMENT_STATUS: "Order preparation update",
  DELIVERY_STATUS: "Delivery update",
  AMENDMENT_STATUS: "Order addition update",
  REFUND_STATUS: "Refund update",
  ISSUE_STATUS: "Reported issue update",
};

function readableStatus(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}

function description(type: CustomerTimelineEntry["type"], status: string): string {
  const readable = readableStatus(status);
  switch (type) {
    case "ORDER_COMMITTED":
      return "We confirmed your order after payment was verified.";
    case "PAYMENT_STATUS":
      return `Your payment is now ${readable}.`;
    case "FULFILLMENT_STATUS":
      return `Order preparation is now ${readable}.`;
    case "DELIVERY_STATUS":
      return `Your delivery is now ${readable}.`;
    case "AMENDMENT_STATUS":
      return `Your requested order addition is now ${readable}.`;
    case "REFUND_STATUS":
      return `Your refund is now ${readable}.`;
    case "ISSUE_STATUS":
      return `Your reported issue is now ${readable}.`;
  }
}

export function buildCustomerOrderTimeline(
  facts: readonly CustomerTimelineFact[],
): CustomerTimelineEntry[] {
  return [...facts]
    .sort(
      (left, right) =>
        left.occurredAt - right.occurredAt ||
        left.type.localeCompare(right.type) ||
        left.id.localeCompare(right.id),
    )
    .map((fact) => ({
      eventId: `${fact.type}:${fact.id}`,
      type: fact.type,
      title: titles[fact.type],
      description: description(fact.type, fact.status),
      status: fact.status,
      occurredAt: new Date(fact.occurredAt).toISOString(),
    }));
}
