"use client";

import type {
  BatchRoutePreview,
  DeliveryMapDetail,
  EligibleRiderView,
} from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../ui/sheet";
import { DeliveryOrderList, type OrderedDeliveryItem } from "./delivery-order-list";

type Props = {
  deliveries: ReadonlyArray<OrderedDeliveryItem>;
  riders: ReadonlyArray<EligibleRiderView>;
  riderId: string;
  preview: BatchRoutePreview | null;
  detail: DeliveryMapDetail | null;
  reviewing: boolean;
  pending: boolean;
  contextLabel: string;
  onRiderChange: (riderId: string) => void;
  onReorder: (deliveries: ReadonlyArray<OrderedDeliveryItem>) => void;
  onPreview: () => void;
  onReview: () => void;
  onConfirm: () => void;
  onReviewingChange: (reviewing: boolean) => void;
  onClear: () => void;
};

export function SelectedDeliveriesDrawer(props: Props) {
  const rider = props.riders.find((candidate) => candidate.riderId === props.riderId);

  const panel = (prefix: string) => (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${prefix}-selected-deliveries-title`} className="font-semibold">
            Selected deliveries
          </h2>
          <p className="text-sm text-[var(--fm-text-muted)]">{props.deliveries.length}/24 stops</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!props.deliveries.length}
          onClick={props.onClear}
        >
          Clear
        </Button>
      </div>
      {props.deliveries.length ? (
        <DeliveryOrderList deliveries={props.deliveries} onReorder={props.onReorder} />
      ) : (
        <p className="text-sm text-[var(--fm-text-muted)]">
          Select eligible deliveries from the map or table.
        </p>
      )}
      {props.detail ? (
        <section
          aria-labelledby={`${prefix}-delivery-detail-title`}
          className="rounded border bg-white p-3 text-sm"
        >
          <h3 id={`${prefix}-delivery-detail-title`} className="font-semibold">
            Protected delivery detail
          </h3>
          <p>{props.detail.destination.displayAddress}</p>
          <p>
            {props.detail.destination.recipient} · {props.detail.destination.phone}
          </p>
          <p>
            {Object.values(props.detail.destination.instructions).filter(Boolean).join(" · ") ||
              "No delivery instructions"}
          </p>
        </section>
      ) : null}
      <label className="block text-sm font-medium">
        Eligible Rider
        <select
          className="mt-1 min-h-11 w-full rounded border border-[var(--fm-border)] bg-white px-3"
          value={props.riderId}
          onChange={(event) => props.onRiderChange(event.target.value)}
        >
          <option value="">Select Rider…</option>
          {props.riders.map((candidate) => (
            <option key={candidate.riderId} value={candidate.riderId}>
              {candidate.displayName} · {candidate.openBatchCount} batches ·{" "}
              {candidate.openDeliveryCount} deliveries
            </option>
          ))}
        </select>
      </label>
      {props.preview ? (
        props.preview.outcome === "AVAILABLE" ? (
          <Alert variant="info">
            <AlertTitle>Route preview available</AlertTitle>
            <AlertDescription>
              {(props.preview.totalMeters / 1000).toFixed(1)} km ·{" "}
              {Math.ceil(props.preview.totalSeconds / 60)} min · {props.preview.legs.length} legs
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="warning">
            <AlertTitle>Route preview unavailable</AlertTitle>
            <AlertDescription>
              {props.preview.warning.message} Assignment remains available.
            </AlertDescription>
          </Alert>
        )
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          disabled={!props.deliveries.length}
          onClick={props.onPreview}
        >
          Preview route
        </Button>
        <Button
          type="button"
          disabled={!props.deliveries.length || !props.riderId}
          onClick={props.onReview}
        >
          Review batch
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <aside
        aria-labelledby="desktop-selected-deliveries-title"
        className="hidden rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-surface-soft)] p-4 lg:sticky lg:top-20 lg:block"
      >
        {panel("desktop")}
      </aside>
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button" className="min-h-11 w-full">
              Selected deliveries ({props.deliveries.length}/24)
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(94vw,26rem)]">
            <SheetHeader>
              <SheetTitle>Dispatch batch</SheetTitle>
              <SheetDescription>Order stops, choose a Rider, preview, and review.</SheetDescription>
            </SheetHeader>
            {panel("mobile")}
          </SheetContent>
        </Sheet>
      </div>
      <AlertDialog open={props.reviewing} onOpenChange={props.onReviewingChange}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm batch assignment</AlertDialogTitle>
          <AlertDialogDescription>
            {props.contextLabel}; {rider?.displayName}; {props.deliveries.length} stops.
          </AlertDialogDescription>
          <ol className="list-inside list-decimal text-xs">
            {props.deliveries.map((delivery) => (
              <li key={delivery.jobId}>{delivery.jobId}</li>
            ))}
          </ol>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              className="min-h-11"
              disabled={props.pending}
              onClick={props.onConfirm}
            >
              {props.pending ? "Assigning…" : "Confirm create and assign"}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
