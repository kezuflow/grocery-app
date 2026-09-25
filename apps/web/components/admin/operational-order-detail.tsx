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

const date = (value: string | null, timezone: string | null) =>
  value
    ? `${new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone ?? "UTC",
      }).format(new Date(value))} ${timezone ?? "UTC"}`
    : "Not scheduled";

export function preparationStatus(status: string): string {
  if (status === "NOT_STARTED") return "New";
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());
}

function reservationEvidence(status: string): string {
  const label = preparationStatus(status);
  return label === "Reserved" ? label : `Reservation ${label}`;
}

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
  canManage,
  onAction,
  presentation = "queue",
}: {
  item: FulfillmentQueueView;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  canManage: boolean;
  onAction: (action: string) => void;
  presentation?: "queue" | "station";
}) {
  const detail = item.operational;
  if (!detail) return null;
  const receivingNeeded =
    detail.fulfillmentMode === "SCHEDULED" &&
    item.status === "PACKING" &&
    !item.allowedActions.includes("MARK_PACKED");
  const shortageAllowed = item.allowedActions.includes("RECORD_SHORTAGE");
  const escalationAllowed = item.allowedActions.includes("ESCALATE");
  const issueAction = shortageAllowed ? "RECORD_SHORTAGE" : escalationAllowed ? "ESCALATE" : null;
  const preparationActions = item.allowedActions.filter(
    (action) => action !== "RECORD_SHORTAGE" && action !== "ESCALATE",
  );
  const nextAction = preparationActions[0];
  return (
    <aside
      aria-label={`Order ${detail.orderNumber} details`}
      className={`space-y-5 rounded-xl border border-[var(--fm-border)] bg-[var(--fm-surface)] p-5 ${
        presentation === "station" ? "[&_button]:min-h-11 [&_input]:min-h-11" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
            {detail.fulfillmentMode}
          </p>
          <h2 className="text-xl font-semibold">Order {detail.orderNumber}</h2>
          <p className="text-sm text-[var(--fm-text-muted)]">
            Paid {date(detail.committedAt, detail.timing.timezone)} · {detail.recipient.name} ·{" "}
            <span>{detail.recipient.phone}</span>
          </p>
        </div>
        <StatusBadge>{preparationStatus(item.status)}</StatusBadge>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Delivery timing</dt>
          <dd>
            {detail.timing.windowName ?? detail.timing.cycleName ?? "Instant"} ·{" "}
            {date(detail.timing.startsAt ?? detail.timing.pickupAt, detail.timing.timezone)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Dispatch</dt>
          <dd>{deliveryLabel(detail)}</dd>
        </div>
      </dl>
      {detail.blockers.length ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <p className="font-semibold">{receivingNeeded ? "Packing blocked" : "Needs attention"}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {detail.blockers.map((blocker, index) => (
              <li key={`${index}-${blocker}`}>{blocker}</li>
            ))}
          </ul>
          {receivingNeeded ? (
            <Link
              className="mt-3 inline-flex min-h-9 items-center font-semibold underline underline-offset-2"
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
        <h3 className="font-semibold">Ordered item checklist</h3>
        <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
          Prepare each immutable paid quantity using the goods evidence shown below.
        </p>
        <ol className="mt-3 divide-y divide-[var(--fm-border)] rounded-lg border border-[var(--fm-border)]">
          {detail.lines.map((line, index) => (
            <li
              key={line.lineId}
              className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-1 p-3 text-sm"
            >
              <span
                aria-hidden="true"
                className="row-span-2 flex size-7 items-center justify-center rounded-full border border-[var(--fm-border)] bg-[var(--fm-workspace)] text-xs font-semibold"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{line.productName}</span>
                {line.variantName ? ` · ${line.variantName}` : ""}
                <span className="mt-1 block text-xs text-[var(--fm-text-muted)]">
                  {line.source === "COMMITTED_ADDITION" ? "Paid addition" : "Original order"}
                </span>
              </span>
              <span className="col-start-2">
                <span className="font-semibold">
                  {line.quantity} {line.unit}
                </span>
                <span className="mt-1 block text-xs text-[var(--fm-text-muted)]">
                  {line.goods.kind === "INSTANT_RESERVATION" ? (
                    <>
                      {reservationEvidence(line.goods.status)} · {line.goods.allocatedBase}{" "}
                      {line.baseUnit ?? "base units"}
                    </>
                  ) : line.goods.receivedBase === null ? (
                    <>
                      {line.goods.allocatedBase} {line.baseUnit ?? "base units"} allocated · no
                      receipt recorded
                    </>
                  ) : (
                    <>
                      {line.goods.allocatedBase} {line.baseUnit ?? "base units"} allocated to this
                      line · {line.goods.receivedBase} {line.baseUnit ?? "base units"} received for
                      the delivery week pool
                    </>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      {item.allowedActions.length ? (
        <div className="space-y-3 rounded-lg border border-[var(--fm-border)] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fm-text-muted)]">
              Next preparation step
            </p>
            <p className="mt-1 font-semibold">
              {nextAction
                ? (actionLabels[nextAction] ?? nextAction)
                : receivingNeeded
                  ? "Record received goods before finishing packing"
                  : "Resolve the current shortage before preparation continues"}
            </p>
          </div>
          {canManage && nextAction ? (
            <div className="flex flex-wrap gap-2">
              <Button
                key={nextAction}
                size="sm"
                disabled={pending}
                onClick={() => onAction(nextAction)}
              >
                {actionLabels[nextAction] ?? nextAction}
              </Button>
              {preparationActions.slice(1).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => onAction(action)}
                >
                  {actionLabels[action] ?? action}
                </Button>
              ))}
            </div>
          ) : null}
          {canManage && issueAction ? (
            <div className="space-y-2 border-t border-[var(--fm-border)] pt-3">
              <p className="text-sm font-medium">
                {issueAction === "RECORD_SHORTAGE" ? "Item shortage" : "Shortage escalation"}
              </p>
              <Input
                aria-label={
                  issueAction === "RECORD_SHORTAGE"
                    ? "Optional shortage reason"
                    : "Optional escalation reason"
                }
                placeholder={
                  issueAction === "RECORD_SHORTAGE"
                    ? "Describe the shortage (optional)"
                    : "Add escalation context (optional)"
                }
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => onAction(issueAction)}
              >
                {actionLabels[issueAction] ?? issueAction}
              </Button>
            </div>
          ) : null}
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
