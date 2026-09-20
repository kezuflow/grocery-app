"use client";

import { useRef, useState } from "react";
import { Copy, Pencil, Power, PowerOff, X } from "lucide-react";
import type { AdminDeliveryCycleView } from "@freshmarkets/contracts";
import { Button } from "@/components/ui/button";
import { AdminStatusPill } from "../admin-status-pill";
import { AdminConfirmationDialog } from "../admin-controls";
import { CycleTimeline } from "./cycle-timeline";

const activationReason = "Activated from the Scheduled cycles workspace.";
const deactivationReason = "Deactivated from the Scheduled cycles workspace.";

function formatWindow(start: string, end: string, timezone: string) {
  const date = new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(new Date(start));
  const time = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return `${date} · ${time.format(new Date(start))}–${time.format(new Date(end))}`;
}

export function CycleDetailsPanel({
  cycle,
  canManage,
  pending,
  submitting,
  retryAvailable,
  onClose,
  onEdit,
  onDuplicate,
  onCommand,
  onRetry,
}: {
  cycle: AdminDeliveryCycleView;
  canManage: boolean;
  pending: boolean;
  submitting: boolean;
  retryAvailable: boolean;
  onClose(): void;
  onEdit(): void;
  onDuplicate(): void;
  onCommand(action: "SCHEDULE" | "CANCEL", reason: string): void;
  onRetry(): void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<"activate" | "deactivate" | null>(null);
  const primaryWindow = cycle.windows[0];
  const locationNames = [...new Set(cycle.participation.map((item) => item.locationName))];
  const editable = canManage && cycle.status === "DRAFT";
  const deactivatable =
    canManage &&
    ["SCHEDULED", "OPEN"].includes(cycle.status) &&
    !cycle.cancellationUnavailableReason;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--fm-border)] p-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold">{cycle.name}</h2>
            <AdminStatusPill
              status={cycle.status}
              tone={
                cycle.status === "CANCELED"
                  ? "danger"
                  : cycle.status === "DRAFT"
                    ? "neutral"
                    : "success"
              }
            />
          </div>
          <p className="text-sm text-[var(--fm-text-muted)]">
            {locationNames.join(", ") || "No fulfillment locations"}
          </p>
          <p className="mt-1 text-xs text-[var(--fm-text-muted)]">All times in {cycle.timezone}</p>
        </div>
        <Button
          ref={closeRef}
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Close cycle details"
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <section aria-labelledby="cycle-delivery-heading">
          <h3
            id="cycle-delivery-heading"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]"
          >
            Customer delivery
          </h3>
          {primaryWindow ? (
            <p className="mt-2 text-base font-semibold">
              {formatWindow(primaryWindow.startsAt, primaryWindow.endsAt, cycle.timezone)}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--fm-text-muted)]">No delivery range recorded.</p>
          )}
          {cycle.windows.length > 1 ? (
            <div className="mt-3 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-3">
              <p className="text-xs font-medium text-[var(--fm-text-muted)]">
                Legacy delivery ranges
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {cycle.windows.slice(1).map((window) => (
                  <li key={window.windowId}>
                    {formatWindow(window.startsAt, window.endsAt, cycle.timezone)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        <section aria-labelledby="cycle-schedule-heading">
          <h3
            id="cycle-schedule-heading"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]"
          >
            Schedule
          </h3>
          <CycleTimeline
            timezone={cycle.timezone}
            items={[
              { label: "Orders open", value: cycle.orderOpensAt, kind: "orders-open" },
              { label: "Order cutoff", value: cycle.cutoffAt, kind: "cutoff" },
              { label: "Procurement starts", value: cycle.procurementAt, kind: "procurement" },
              { label: "Preparation starts", value: cycle.preparationAt, kind: "preparation" },
              { label: "Planned courier pickup", value: cycle.pickupAt, kind: "pickup" },
              {
                label: "Customer delivery",
                value: primaryWindow?.startsAt ?? null,
                endValue: primaryWindow?.endsAt ?? null,
                kind: "delivery",
              },
            ]}
          />
        </section>
        <section aria-labelledby="cycle-locations-heading">
          <h3
            id="cycle-locations-heading"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]"
          >
            Fulfillment locations
          </h3>
          <p className="mt-2 text-sm">{locationNames.join(", ") || "No fulfillment locations"}</p>
        </section>
        {cycle.cancellationUnavailableReason ? (
          <p className="rounded-[var(--fm-radius-control)] border border-[var(--fm-warning-border)] bg-[var(--fm-warning-soft)] p-3 text-sm">
            Deactivate unavailable: {cycle.cancellationUnavailableReason}
          </p>
        ) : null}
      </div>
      <footer className="grid grid-cols-2 gap-2 border-t border-[var(--fm-border)] p-4">
        {retryAvailable ? (
          <Button type="button" className="col-span-2" disabled={submitting} onClick={onRetry}>
            {submitting ? "Retrying…" : "Retry unconfirmed request"}
          </Button>
        ) : editable ? (
          <Button type="button" className="col-span-2" disabled={pending} onClick={onEdit}>
            <Pencil aria-hidden className="size-3.5" /> Edit draft
          </Button>
        ) : null}
        {!retryAvailable ? (
          <Button
            type="button"
            variant="outline"
            className={!editable && !deactivatable ? "col-span-2" : undefined}
            disabled={pending}
            onClick={onDuplicate}
          >
            <Copy aria-hidden className="size-3.5" /> Duplicate
          </Button>
        ) : null}
        {!retryAvailable && editable ? (
          <Button
            type="button"
            className="w-full"
            disabled={pending || !cycle.pickupAt || cycle.windows.length !== 1}
            onClick={() => setConfirmation("activate")}
          >
            <Power aria-hidden className="size-3.5" /> Activate cycle
          </Button>
        ) : !retryAvailable && deactivatable ? (
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            disabled={pending}
            onClick={() => setConfirmation("deactivate")}
          >
            <PowerOff aria-hidden className="size-3.5" /> Deactivate
          </Button>
        ) : null}
      </footer>
      <AdminConfirmationDialog
        open={confirmation !== null}
        title={confirmation === "activate" ? "Activate this cycle?" : "Deactivate this cycle?"}
        resource={cycle.name}
        scope={cycle.marketName}
        consequence={
          confirmation === "activate"
            ? "Activation makes the cycle eligible for ordering at its opening time and locks the schedule for editing."
            : "Deactivation closes unstarted checkout quotes and cannot be undone for this cycle."
        }
        reasonRequired={false}
        destructive={confirmation === "deactivate"}
        confirmLabel={confirmation === "activate" ? "Activate cycle" : "Deactivate cycle"}
        restoreFocusRef={closeRef}
        pending={pending}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation === "activate" ? "SCHEDULE" : "CANCEL";
          setConfirmation(null);
          onCommand(action, action === "SCHEDULE" ? activationReason : deactivationReason);
        }}
      />
    </div>
  );
}
