import { cn } from "../../lib/utils";

const orderStatusTone: Readonly<Record<string, string>> = {
  PENDING_PAYMENT: "fm-order-status-warning",
  COMMITTED: "fm-order-status-neutral",
  FULFILLMENT_PENDING: "fm-order-status-warning",
  FULFILLMENT_READY: "fm-order-status-info",
  OUT_FOR_DELIVERY: "fm-order-status-accent",
  DELIVERED: "fm-order-status-success",
  CANCELLATION_REQUESTED: "fm-order-status-warning",
  CANCELED: "fm-order-status-danger",
  EXPIRED: "fm-order-status-neutral",
  EXCEPTION: "fm-order-status-danger",
};

function orderStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        orderStatusTone[status] ?? "fm-order-status-neutral",
        className,
      )}
    >
      {orderStatusLabel(status)}
    </span>
  );
}
