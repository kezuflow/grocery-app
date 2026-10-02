import type { CustomerOrderProgressView } from "@freshmarkets/contracts";

type OrderProgressFacts = Readonly<{
  status: string;
  committedAt: number;
  checkoutPaymentStatus: string | null;
  checkoutPaymentUpdatedAt: number | null;
  fulfillmentStatus: string | null;
  fulfillmentUpdatedAt: number | null;
  packedAt: number | null;
  deliveryStatus: string | null;
  deliveryUpdatedAt: number | null;
  handedOverAt: number | null;
  deliveredAt: number | null;
}>;

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** One Core-authored milestone projection for Customer and authorized Admin Order detail. */
export function buildOrderProgress(row: OrderProgressFacts): CustomerOrderProgressView {
  const packed = ["PACKED", "HANDED_OFF", "COMPLETED"].includes(row.fulfillmentStatus ?? "");
  const outForDelivery =
    ["OUT_FOR_DELIVERY", "DELIVERED"].includes(row.status) &&
    ["EN_ROUTE", "ARRIVED", "DELIVERED"].includes(row.deliveryStatus ?? "");
  const delivered = row.status === "DELIVERED" && row.deliveryStatus === "DELIVERED";
  const stopped = ["CANCELED", "EXPIRED", "EXCEPTION", "CANCELLATION_REQUESTED"].includes(
    row.status,
  );
  return {
    steps: [
      {
        key: "PAYMENT",
        state: "COMPLETE",
        achievedAt: iso(
          row.checkoutPaymentStatus === "SUCCEEDED" &&
            row.checkoutPaymentUpdatedAt !== null &&
            row.checkoutPaymentUpdatedAt <= row.committedAt
            ? row.checkoutPaymentUpdatedAt
            : row.committedAt,
        ),
      },
      {
        key: "PACKED",
        state: packed ? "COMPLETE" : stopped ? "UPCOMING" : "CURRENT",
        achievedAt: packed
          ? iso(
              row.packedAt ??
                (row.fulfillmentStatus === "PACKED" ? row.fulfillmentUpdatedAt : null),
            )
          : null,
      },
      {
        key: "OUT_FOR_DELIVERY",
        state: outForDelivery ? "COMPLETE" : packed && !stopped ? "CURRENT" : "UPCOMING",
        achievedAt: outForDelivery
          ? iso(
              row.handedOverAt ??
                (row.deliveryStatus === "EN_ROUTE" ? row.deliveryUpdatedAt : null),
            )
          : null,
      },
      {
        key: "DELIVERED",
        state: delivered ? "COMPLETE" : outForDelivery && !stopped ? "CURRENT" : "UPCOMING",
        achievedAt: delivered ? iso(row.deliveredAt) : null,
      },
    ],
    detail: stopped
      ? row.status === "CANCELED"
        ? "This order was canceled."
        : row.status === "CANCELLATION_REQUESTED"
          ? "Cancellation is being reviewed."
          : row.status === "EXPIRED"
            ? "This order expired."
            : "This order needs assistance."
      : delivered
        ? "Your order was delivered."
        : outForDelivery
          ? row.deliveryStatus === "ARRIVED"
            ? "Your rider has arrived."
            : "Your order is on its way."
          : packed
            ? row.deliveryStatus === "ASSIGNED"
              ? "Your order is packed. A rider has been assigned."
              : "Your order is packed and awaiting handoff."
            : row.fulfillmentStatus === "PACKING"
              ? "Your order is being packed."
              : row.fulfillmentStatus === "READY_TO_PACK"
                ? "Your items are ready to pack."
                : row.fulfillmentStatus === "PICKING"
                  ? "Your items are being picked."
                  : row.fulfillmentStatus === "SHORTED"
                    ? "Your order needs a stock update."
                    : "Your order is awaiting preparation.",
  };
}
