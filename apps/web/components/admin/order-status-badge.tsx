import { AdminStatusPill, type AdminStatusTone } from "./admin-status-pill";

const orderStatusTone: Readonly<Record<string, AdminStatusTone>> = {
  PENDING_PAYMENT: "warning",
  COMMITTED: "neutral",
  FULFILLMENT_PENDING: "warning",
  FULFILLMENT_READY: "info",
  OUT_FOR_DELIVERY: "accent",
  DELIVERED: "success",
  CANCELLATION_REQUESTED: "warning",
  CANCELED: "danger",
  EXPIRED: "neutral",
  EXCEPTION: "danger",
};

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  return <AdminStatusPill status={status} tone={orderStatusTone[status]} className={className} />;
}
