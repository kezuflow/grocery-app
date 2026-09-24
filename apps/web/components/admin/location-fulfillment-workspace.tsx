"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  appErrorCodes,
  type AdminLocationFulfillmentView,
  type RpcResult,
} from "@freshmarkets/contracts";
import { z, adminLocationFulfillmentViewSchema } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { PageHeader } from "./admin-shell";
import { useAdminCommandIntent } from "./admin-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { useSetupNavigationLock } from "./location-setup-state";
import { useAdminScopeGuard } from "@/app/admin/admin-context-provider";
import { useAdminRouteGuard } from "./use-admin-route-guard";
const responseSchema = z.union([
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: adminLocationFulfillmentViewSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
]);
type Payload = {
  locationId: string;
  expectedVersion: number;
  dispatchReady: boolean;
  instantPromiseMinutes: number | null;
  reason: string;
};
export function LocationFulfillmentWorkspace({
  initial,
  locationId,
  onSaved,
  onDirtyChange,
  embedded = false,
}: {
  initial: RpcResult<AdminLocationFulfillmentView>;
  locationId: string;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  embedded?: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [ready, setReady] = useState(initial.ok && initial.value.dispatchReady);
  const [minutes, setMinutes] = useState(
    initial.ok ? String(initial.value.instantPromiseMinutes ?? "") : "",
  );
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const intent = useAdminCommandIntent();
  const locked = pending !== null || intent.pending || loading;
  useSetupNavigationLock(pending !== null || intent.pending);
  const changed =
    result.ok &&
    (ready !== result.value.dispatchReady ||
      minutes !== String(result.value.instantPromiseMinutes ?? ""));
  const dirty = changed || reason.trim().length > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useAdminScopeGuard(dirty, locked, () => {
    if (result.ok) {
      setReady(result.value.dispatchReady);
      setMinutes(String(result.value.instantPromiseMinutes ?? ""));
    }
    setReason("");
    setNotice("");
  });
  useAdminRouteGuard(dirty, locked);
  function accept(next: RpcResult<AdminLocationFulfillmentView>) {
    setResult(next);
    if (next.ok) {
      setReady(next.value.dispatchReady);
      setMinutes(String(next.value.instantPromiseMinutes ?? ""));
    }
  }
  async function refresh() {
    setLoading(true);
    try {
      const next = responseSchema.parse(
        await (
          await fetch(
            `/api/admin/location-fulfillment?locationId=${encodeURIComponent(locationId)}`,
            {
              signal: AbortSignal.timeout(15_000),
            },
          )
        ).json(),
      );
      if (next.ok) {
        accept(next);
        setReason("");
        setNotice("");
      } else setNotice(next.error.message);
    } catch {
      setNotice("Settings could not be loaded. Retry refresh.");
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    if (!result.ok || intent.pending || loading || !result.value.canManage) return;
    const payload = pending ?? {
      locationId,
      expectedVersion: result.value.version,
      dispatchReady: ready,
      instantPromiseMinutes: minutes.trim() ? Number(minutes) : null,
      reason,
    };
    setPending(payload);
    setNotice("");
    try {
      const next = await intent.submit(async (key) =>
        responseSchema.parse(
          await (
            await fetch("/api/admin/location-fulfillment", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(15_000),
            })
          ).json(),
        ),
      );
      setPending(null);
      if (next.ok) {
        accept(next);
        setReason("");
        notifyCommandSuccess("Fulfillment settings saved");
        onSaved?.();
      } else
        setNotice(
          next.error.code === "STALE_VERSION"
            ? `${next.error.message} Refresh settings, review your changes and save again.`
            : next.error.message,
        );
    } catch {
      setNotice("Save not confirmed. Retry saving to confirm these settings.");
    }
  }
  return (
    <div
      className={
        embedded
          ? "space-y-4 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-5"
          : "space-y-4"
      }
    >
      {!embedded && (
        <Link href="/admin/locations" className="underline">
          Locations
        </Link>
      )}
      {embedded ? (
        <h2 className="text-lg font-semibold tracking-tight">Enable dispatch</h2>
      ) : (
        <PageHeader
          title={
            result.ok
              ? `${result.value.locationName} fulfillment readiness`
              : "Fulfillment readiness"
          }
          description="Dispatch readiness applies to Instant and Scheduled orders. The delivery promise below applies only to Instant."
        />
      )}
      {!result.ok && <p role="alert">{notice || result.error.message}</p>}
      <Button
        variant="outline"
        disabled={locked}
        onClick={() => {
          if (dirty && !window.confirm("Discard unsaved dispatch changes and refresh?")) return;
          void refresh();
        }}
      >
        {loading ? "Refreshing…" : "Refresh settings"}
      </Button>
      {result.ok && (
        <>
          <p className="font-medium">
            Saved dispatch status: {result.value.dispatchReady ? "Ready" : "Not ready"}
          </p>
          {result.value.blockers.length > 0 && (
            <section
              className="rounded-lg border border-border bg-muted/30 p-4 text-sm"
              aria-label="Fulfillment setup"
            >
              <h2 className="font-semibold">Setup requirements</h2>
              <ul className="mt-2 list-disc pl-5">
                {result.value.blockers.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {result.value.blockers.includes("Configure the courier pickup profile") && (
                <p className="mt-2">
                  Open{" "}
                  <Link
                    href={`/admin/locations/${encodeURIComponent(locationId)}/pickup`}
                    className="underline"
                  >
                    Courier pickup
                  </Link>{" "}
                  and complete the pickup details for {result.value.locationName}. Then return to
                  Dispatch readiness.
                </p>
              )}
            </section>
          )}
          {!result.value.canManage && (
            <p>Global location management access is required to change these settings.</p>
          )}
          <form
            className="max-w-xl space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={locked || !result.value.canManage} className="space-y-4">
              <legend className="font-semibold">Location fulfillment</legend>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={ready}
                  disabled={locked || !result.value.canManage}
                  aria-describedby="fulfillment-save-help"
                  onCheckedChange={(checked) => {
                    setReady(checked === true);
                    setNotice("");
                  }}
                />
                Ready to dispatch customer orders
              </label>
              <p id="fulfillment-save-help" className="text-sm text-muted-foreground">
                Changes take effect after you save. Checking this box does not enable dispatch yet.
              </p>
              <label className="block">
                Instant delivery promise (minutes)
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={minutes}
                  onChange={(event) => {
                    setMinutes(event.target.value);
                    setNotice("");
                  }}
                />
              </label>
              <p className="text-sm text-muted-foreground">
                An Instant promise is required before opening Instant commerce. Scheduled orders use
                their accepted delivery range.
              </p>
              <label className="block">
                Reason for change (required)
                <Input
                  required
                  pattern=".*\S.*"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </fieldset>
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {intent.pending
                ? "Saving fulfillment settings…"
                : pending
                  ? "Save awaiting confirmation."
                  : changed
                    ? "Unsaved changes. Enter a reason and save to apply them."
                    : "No unsaved changes."}
            </p>
            {notice && (
              <p role="alert" className="rounded border border-destructive p-3 text-sm">
                {notice}
              </p>
            )}
            <Button
              type="submit"
              disabled={
                intent.pending || loading || !result.value.canManage || (!pending && !changed)
              }
            >
              {intent.pending ? "Saving…" : pending ? "Retry saving" : "Save fulfillment settings"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
