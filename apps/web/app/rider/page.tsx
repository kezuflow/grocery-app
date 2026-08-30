"use client";

import type { Coordinate, RiderBatchList, RiderDeliveryView } from "@freshmarkets/contracts";
import {
  CheckCircle2,
  CircleAlert,
  MapPin,
  Navigation,
  PackageOpen,
  Phone,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  GoogleMapsCoordinateValidationError,
  googleMapsNavigationUrl,
} from "../../lib/maps/google-maps-url";

type RiderState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; value: RiderBatchList };

type RiderAction = RiderDeliveryView["allowedActions"][number];
type ActionNotice = { kind: "pending" | "success" | "error"; message: string } | null;

const ACTION_LABELS: Record<RiderAction, string> = {
  MARK_EN_ROUTE: "En Route",
  MARK_ARRIVED: "Arrived",
  MARK_DELIVERED: "Delivered",
  MARK_FAILED: "Failed",
};

function displayStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

function shortId(id: string): string {
  return id.length <= 14 ? id : `${id.slice(0, 12)}…`;
}

function loadError(payload: { error?: { code?: string; message?: string } }): string {
  return payload.error?.code === "UNAUTHENTICATED"
    ? "Sign in with your rider account to see assigned deliveries."
    : (payload.error?.message ?? "Assigned delivery batches could not be loaded.");
}

function navigationUrl(coordinate: Coordinate | null): string | null {
  if (!coordinate) return null;
  try {
    return googleMapsNavigationUrl(coordinate);
  } catch (error) {
    if (error instanceof GoogleMapsCoordinateValidationError) return null;
    throw error;
  }
}

/**
 * Current-delivery-first Rider workflow. Reads are canonical assigned-batch
 * DTOs; lifecycle writes keep the existing explicit Core command adapter.
 */
export default function RiderPage() {
  const [state, setState] = useState<RiderState>({ phase: "loading" });
  const [notice, setNotice] = useState<ActionNotice>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/rider/batches");
      const payload = (await response.json()) as {
        ok: boolean;
        value?: RiderBatchList;
        error?: { code?: string; message?: string };
      };
      if (payload.ok && payload.value) setState({ phase: "ready", value: payload.value });
      else setState({ phase: "error", message: loadError(payload) });
    } catch {
      setState({ phase: "error", message: "Network error loading your deliveries." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(delivery: RiderDeliveryView, action: RiderAction) {
    const actionId = `${delivery.jobId}:${action}`;
    let idempotencyKey = keys.current.get(actionId);
    if (!idempotencyKey) {
      idempotencyKey = `delivery-${crypto.randomUUID()}`;
      keys.current.set(actionId, idempotencyKey);
    }

    setPendingAction(actionId);
    setNotice({ kind: "pending", message: "Updating delivery…" });
    try {
      const response = await fetch(
        `/api/rider/jobs?v=${encodeURIComponent(String(delivery.jobVersion))}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
          body: JSON.stringify({ orderId: delivery.orderId, action }),
        },
      );
      const result = (await response.json()) as {
        ok: boolean;
        value?: { status: string };
        error?: { code?: string; message?: string };
      };
      const definitive = result.ok || result.error?.code === "STALE_VERSION";
      if (definitive) {
        keys.current.delete(actionId);
        setNotice({
          kind: "success",
          message: result.ok
            ? `Delivery is now ${displayStatus(result.value?.status ?? "updated")}.`
            : "Delivery changed elsewhere. Current delivery refreshed.",
        });
        await load();
      } else {
        setNotice({ kind: "error", message: result.error?.message ?? "Update failed." });
      }
    } catch {
      setNotice({ kind: "error", message: "Update could not be completed. Try again." });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-md bg-white px-5 py-8">
      <p className="text-sm font-semibold text-emerald-700">Rider route</p>
      <h1 className="mt-1 text-2xl font-semibold">Your deliveries</h1>

      {state.phase === "loading" ? (
        <p role="status" className="mt-6 rounded border p-5 text-sm text-slate-600">
          Loading assigned batches…
        </p>
      ) : null}

      {state.phase === "error" ? (
        <p role="alert" className="mt-6 rounded border border-red-200 bg-red-50 p-5 text-sm">
          {state.message}
        </p>
      ) : null}

      {state.phase === "ready" ? (
        <>
          {notice ? (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={`mt-4 rounded p-3 text-sm ${
                notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-slate-100"
              }`}
            >
              {notice.message}
            </p>
          ) : null}

          {state.value.batches.length === 0 ? (
            <div className="mt-6 rounded-lg border p-6 text-center">
              <PackageOpen className="mx-auto size-6 text-slate-400" aria-hidden />
              <p className="mt-3 text-sm text-slate-600">
                No delivery batches are assigned to you right now. Dispatch assigns new stops.
              </p>
            </div>
          ) : (
            <ul className="mt-6 space-y-6">
              {state.value.batches.map((batch) => (
                <li key={batch.batchId} className="rounded-xl border bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Batch {shortId(batch.batchId)}
                      </p>
                      <p className="mt-1 text-sm font-semibold capitalize">
                        {displayStatus(batch.status)}
                      </p>
                    </div>
                    <span className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-600">
                      {batch.fulfillmentMode === "INSTANT" ? "Instant" : "Scheduled"}
                    </span>
                  </div>

                  {batch.currentDelivery ? (
                    <CurrentDelivery
                      delivery={batch.currentDelivery}
                      pending={pendingAction !== null}
                      onAction={act}
                    />
                  ) : (
                    <p className="mt-4 rounded-lg bg-white p-4 text-sm text-slate-600">
                      No unfinished deliveries remain in this batch.
                    </p>
                  )}

                  {batch.upcomingDeliveries.length > 0 ? (
                    <section className="mt-5" aria-labelledby={`upcoming-${batch.batchId}`}>
                      <h2
                        id={`upcoming-${batch.batchId}`}
                        className="text-sm font-semibold text-slate-800"
                      >
                        Upcoming stops
                      </h2>
                      <ol className="mt-2 space-y-2">
                        {batch.upcomingDeliveries.map((delivery) => (
                          <li
                            key={delivery.jobId}
                            data-testid="upcoming-delivery"
                            className="rounded-lg border bg-white p-3"
                          >
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-semibold">Stop {delivery.sequence}</span>
                              <span className="capitalize text-slate-500">
                                {displayStatus(delivery.status)}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              {delivery.destination.displayAddress}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}

function CurrentDelivery({
  delivery,
  pending,
  onAction,
}: {
  delivery: RiderDeliveryView;
  pending: boolean;
  onAction: (delivery: RiderDeliveryView, action: RiderAction) => Promise<void>;
}) {
  const googleNavigationUrl = navigationUrl(delivery.destination.coordinate);
  const instructionItems = [
    ["Building / unit", delivery.destination.instructions.buildingUnit],
    ["Landmark", delivery.destination.instructions.landmark],
    ["Gate / guard", delivery.destination.instructions.gateGuard],
    ["Delivery note", delivery.destination.instructions.deliveryNote],
    ["Recipient guidance", delivery.destination.instructions.recipientInstruction],
  ].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].length > 0);

  return (
    <article data-testid="current-delivery" className="mt-4 rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Current delivery · Stop {delivery.sequence}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500">{shortId(delivery.orderId)}</p>
        </div>
        <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium capitalize text-emerald-800">
          {displayStatus(delivery.status)}
        </span>
      </div>

      <div className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <MapPin className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden />
        <span>{delivery.destination.displayAddress}</span>
      </div>
      <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm">
        <p className="flex items-center gap-2">
          <UserRound className="size-4 text-slate-500" aria-hidden />
          {delivery.destination.recipient}
        </p>
        <p className="flex items-center gap-2">
          <Phone className="size-4 text-slate-500" aria-hidden />
          {delivery.destination.phone}
        </p>
      </div>

      {instructionItems.length > 0 ? (
        <dl className="mt-4 space-y-2 text-sm">
          {instructionItems.map(([label, value]) => (
            <div key={label}>
              <dt className="font-medium text-slate-700">{label}</dt>
              <dd className="text-slate-600">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-5 grid gap-2">
        {googleNavigationUrl ? (
          <Button asChild>
            <a href={googleNavigationUrl} target="_blank" rel="noopener noreferrer">
              <Navigation className="size-4" aria-hidden /> Navigate
            </a>
          </Button>
        ) : (
          <p className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            Navigation unavailable for this delivery
          </p>
        )}

        {delivery.allowedActions.map((action) => (
          <Button
            key={action}
            data-rider-action={action}
            variant={action === "MARK_FAILED" ? "outline" : "default"}
            disabled={pending}
            onClick={() => void onAction(delivery, action)}
          >
            {action === "MARK_DELIVERED" ? <CheckCircle2 className="size-4" /> : null}
            {action === "MARK_FAILED" ? <TriangleAlert className="size-4" /> : null}
            {ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
    </article>
  );
}
