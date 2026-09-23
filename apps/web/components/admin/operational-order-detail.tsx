"use client";

import Link from "next/link";
import type { FulfillmentQueueView } from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StatusBadge } from "./admin-shell";

const actionLabels: Record<string, string> = {
  START_PICKING: "Accept order & start picking",
  MARK_READY_TO_PACK: "Finish picking",
  START_PACKING: "Start packing",
  MARK_PACKED: "Finish packing",
  RECORD_SHORTAGE: "Report shortage",
  RESUME_PICKING: "Resume picking",
  RESUME_READY_TO_PACK: "Resume packing preparation",
  ESCALATE: "Escalate shortage",
};

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not scheduled";

function deliveryLabel(detail: NonNullable<FulfillmentQueueView["operational"]>): string {
  const execution = detail.deliveryExecution;
  if (!execution)
    return detail.fulfillmentMode === "INSTANT"
      ? "Lalamove books automatically when packing starts"
      : (detail.deliveryStatus ?? "Choose dispatch after packing");
  if (execution.method === "MANUAL") return `Manual delivery · ${execution.status}`;
  if (execution.status === "OUTCOME_UNKNOWN" || execution.status === "RECONCILIATION_REQUIRED")
    return "Awaiting provider confirmation";
  if (execution.status === "PENDING" || execution.status === "CREATING") return "Booking Lalamove…";
  if (execution.status === "RETRY_REQUIRED") return "Retrying Lalamove booking…";
  if (execution.status === "FAILED") return "Lalamove booking failed";
  if (execution.status === "CANCELED") return "Lalamove booking canceled";
  switch (execution.providerStatus) {
    case "ALLOCATING":
      return "Finding rider";
    case "PENDING_PICKUP":
    case "PICKING_UP":
    case "PENDING_DROP_OFF":
      return "Rider assigned";
    case "IN_DELIVERY":
      return "Out for delivery";
    case "COMPLETED":
      return "Delivered";
    default:
      return detail.deliveryStatus ?? execution.status;
  }
}

/** Reusable location-safe detail; it never accepts global finance data. */
export function OperationalOrderDetail({
  item,
  reason,
  setReason,
  pending,
  onAction,
}: {
  item: FulfillmentQueueView;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  onAction: (action: string) => void;
}) {
  const detail = item.operational;
  if (!detail) return null;
  const receivingNeeded =
    detail.fulfillmentMode === "SCHEDULED" &&
    item.status === "PACKING" &&
    !item.allowedActions.includes("MARK_PACKED");
  return (
    <aside
      aria-label={`Order ${detail.orderNumber} details`}
      className="space-y-5 rounded-xl border border-[var(--fm-border)] bg-[var(--fm-surface)] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
            {detail.fulfillmentMode}
          </p>
          <h2 className="text-xl font-semibold">Order {detail.orderNumber}</h2>
          <p className="text-sm text-[var(--fm-text-muted)]">
            Paid {date(detail.committedAt)} · {detail.recipient.name} · {detail.recipient.phone}
          </p>
        </div>
        <StatusBadge>{item.status}</StatusBadge>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Delivery timing</dt>
          <dd>
            {detail.timing.windowName ?? detail.timing.cycleName ?? "Instant"} ·{" "}
            {date(detail.timing.startsAt ?? detail.timing.pickupAt)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Dispatch</dt>
          <dd>{deliveryLabel(detail)}</dd>
        </div>
      </dl>
      {detail.blockers.length ? (
        <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
          {detail.blockers.join(" · ")}
          {receivingNeeded ? (
            <Link
              className="mt-2 block font-semibold underline"
              href={
                item.cycleId
                  ? `/admin/receiving?cycleId=${encodeURIComponent(item.cycleId)}`
                  : "/admin/receiving"
              }
            >
              Open receiving for this delivery week
            </Link>
          ) : null}
        </div>
      ) : null}
      <div>
        <h3 className="font-semibold">Paid item snapshot</h3>
        <ul className="mt-2 divide-y divide-[var(--fm-border)] border-y border-[var(--fm-border)]">
          {detail.lines.map((line) => (
            <li key={line.lineId} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto]">
              <span>
                <span className="font-medium">{line.productName}</span>
                {line.variantName ? ` · ${line.variantName}` : ""}
                <span className="block text-[var(--fm-text-muted)]">
                  {line.source === "COMMITTED_ADDITION" ? "Paid addition" : "Original order"}
                </span>
              </span>
              <span className="sm:text-right">
                {line.quantity} {line.unit}
                <span className="block text-[var(--fm-text-muted)]">
                  {line.goods.kind === "INSTANT_RESERVATION" ? "Reserved" : "Cycle allocated"}:{" "}
                  {line.goods.allocatedBase} {line.baseUnit ?? "base units"}
                  {line.goods.kind === "SCHEDULED_ALLOCATION"
                    ? line.goods.receivedBase === null
                      ? " · no receipt recorded"
                      : ` · cycle received ${line.goods.receivedBase}`
                    : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {item.allowedActions.length ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">
            {receivingNeeded ? "Preparation actions" : "Next preparation step"}
          </p>
          {item.allowedActions.includes("RECORD_SHORTAGE") ? (
            <Input
              aria-label="Fulfillment action reason"
              placeholder="Describe a shortage when reporting one"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {item.allowedActions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={
                  action === item.allowedActions[0] && action !== "RECORD_SHORTAGE"
                    ? "default"
                    : "outline"
                }
                disabled={pending}
                onClick={() => onAction(action)}
              >
                {actionLabels[action] ?? action}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {["PACKED", "HANDED_OFF", "COMPLETED"].includes(item.status) || detail.deliveryExecution ? (
        <Link
          className="inline-flex min-h-11 items-center font-semibold underline"
          href={`/admin/delivery?orderId=${encodeURIComponent(item.orderId)}`}
        >
          {detail.fulfillmentMode === "INSTANT"
            ? "View Lalamove delivery"
            : "Choose Manual or Lalamove dispatch"}
        </Link>
      ) : null}
    </aside>
  );
}
