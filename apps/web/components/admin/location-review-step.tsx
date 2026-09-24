"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z, adminLocationViewSchema } from "@freshmarkets/validation";
import { appErrorCodes } from "@freshmarkets/contracts";
import { useLocationSetup, useSetupNavigationLock } from "./location-setup-state";
import { LocationFulfillmentWorkspace } from "./location-fulfillment-workspace";
import { useAdminCommandIntent } from "./admin-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useAdminScopeGuard } from "../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "./use-admin-route-guard";
import { AdminStatusPill } from "./admin-status-pill";
import { AdminConfirmationDialog } from "./admin-controls";

const responseSchema = z.union([
  z.object({ ok: z.literal(true), requestId: z.string(), value: adminLocationViewSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
]);
export function LocationReviewStep({ locationId }: { locationId: string }) {
  const { data, loading, reload, navigationLocked } = useLocationSetup();
  const intent = useAdminCommandIntent();
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [dispatchDirty, setDispatchDirty] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const deactivateTriggerRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<{
    action: "ACTIVATE" | "DEACTIVATE";
    locationId: string;
    expectedVersion: number;
    reason: string;
  } | null>(null);
  const locked = pending !== null || intent.pending;
  useAdminScopeGuard(Boolean(reason.trim()), locked, () => setReason(""));
  useAdminRouteGuard(Boolean(reason.trim()), locked);
  async function changeStatus(confirmedReason?: string) {
    if (!data?.location || !data.canManage || intent.pending) return;
    if (dispatchDirty && !pending) {
      setNotice("Save or discard dispatch changes before changing location status.");
      return;
    }
    const action = data.location.status === "active" ? "DEACTIVATE" : "ACTIVATE";
    const payload = pending ?? {
      action,
      locationId,
      expectedVersion: data.location.version,
      reason: confirmedReason ?? reason,
    };
    setPending(payload);
    setNotice("");
    try {
      const response = await intent.submit(async (key) =>
        responseSchema.parse(
          await (
            await fetch("/api/admin/locations", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(15_000),
            })
          ).json(),
        ),
      );
      setPending(null);
      if (response.ok) {
        notifyCommandSuccess(
          payload.action === "ACTIVATE" ? "Location activated" : "Location deactivated",
        );
        setReason("");
        setConfirmDeactivate(false);
        reload();
      } else {
        setNotice(response.error.message);
        if (payload.action === "DEACTIVATE") setConfirmDeactivate(false);
      }
    } catch {
      setNotice(
        payload.action === "ACTIVATE"
          ? "Activation not confirmed. Retry to confirm this change."
          : "Deactivation not confirmed. Retry the same change to recover its result.",
      );
    }
  }
  useSetupNavigationLock(locked);
  if (loading && !pending) return <p role="status">Loading saved setup…</p>;
  if (!data?.location)
    return (
      <div role="alert">
        Setup could not be loaded. <Button onClick={reload}>Retry review</Button>
      </div>
    );
  const base = `/admin/locations/${encodeURIComponent(locationId)}`;
  const guardedLink = {
    "aria-disabled": navigationLocked,
    tabIndex: navigationLocked ? -1 : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (navigationLocked) event.preventDefault();
    },
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Review {data.location.name}</h1>
          <p className="text-sm text-muted-foreground">
            Check saved details, location status and dispatch setup.
          </p>
        </div>
        <AdminStatusPill
          status={data.location.status}
          tone={data.location.status === "active" ? "success" : "neutral"}
        />
      </div>
      <Button
        variant="outline"
        disabled={navigationLocked}
        onClick={() => {
          if (
            (dispatchDirty || reason.trim()) &&
            !window.confirm("Discard unsaved review changes and refresh?")
          )
            return;
          setReason("");
          setDispatchDirty(false);
          reload();
        }}
      >
        Refresh review
      </Button>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-4">
          <dt className="font-medium">Location</dt>
          <dd>
            {data.location.address
              ? [data.location.address.addressLine1, data.location.address.city].join(", ")
              : "Address incomplete"}
          </dd>
          <dd>
            {data.location.status === "active" ? "Active" : "Inactive"} ·{" "}
            <Link {...guardedLink} className="underline" href={base}>
              Edit location
            </Link>
          </dd>
        </div>
        <div className="space-y-2 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-4">
          <dt className="font-medium">Pickup contact</dt>
          <dd>{data.pickup ? (data.pickup.profile?.senderName ?? "Not saved") : "Unavailable"}</dd>
          <dd>
            <Link {...guardedLink} className="underline" href={`${base}/pickup`}>
              Review pickup contact
            </Link>
          </dd>
        </div>
        <div className="space-y-2 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-4">
          <dt className="font-medium">Instant operating hours</dt>
          <dd>
            {data.hours
              ? data.hours.schedule?.weekly.length
                ? `${data.hours.schedule.weekly.length} saved intervals`
                : "Not configured"
              : "Unavailable"}
          </dd>
          <dd>
            <Link {...guardedLink} className="underline" href={`${base}/schedule`}>
              Review hours
            </Link>
          </dd>
        </div>
      </dl>
      {data.location.status === "inactive" && (
        <form
          className="space-y-4 rounded-xl border border-border bg-[var(--fm-admin-surface)] p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void changeStatus();
          }}
        >
          <p>
            Activate this location before enabling dispatch. Instant selling also requires saved
            operating hours and a delivery promise; Scheduled uses its cycle timing.
          </p>
          <label className="block">
            Reason for activation
            <Input
              required
              value={reason}
              disabled={pending !== null || !data.canManage}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {notice && <p role="alert">{notice}</p>}
          <Button
            disabled={
              intent.pending ||
              !data.canManage ||
              (!pending && (navigationLocked || !reason.trim() || dispatchDirty))
            }
          >
            {intent.pending ? "Activating…" : pending ? "Retry activation" : "Activate location"}
          </Button>
        </form>
      )}
      {data.location.status === "active" && data.canManage && (
        <div className="rounded-xl border border-border bg-[var(--fm-admin-surface)] p-5">
          <h2 className="font-semibold">Location status</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Deactivate this location to stop new fulfillment work. Core checks existing obligations
            before changing status.
          </p>
          <Button
            ref={deactivateTriggerRef}
            type="button"
            variant="outline"
            className="mt-3"
            disabled={navigationLocked || dispatchDirty}
            onClick={() => setConfirmDeactivate(true)}
          >
            Deactivate location
          </Button>
        </div>
      )}
      <AdminConfirmationDialog
        open={confirmDeactivate}
        title="Deactivate location"
        resource={data.location.name}
        scope="Location fulfillment"
        consequence="This location will stop serving new fulfillment work. The change may be blocked while operational obligations remain."
        confirmLabel={pending ? "Retry deactivation" : "Deactivate location"}
        initialReason={pending?.reason ?? ""}
        reasonLocked={pending !== null}
        error={confirmDeactivate ? notice : undefined}
        maxReasonLength={500}
        restoreFocusRef={deactivateTriggerRef}
        pending={intent.pending}
        cancelDisabled={pending !== null}
        onCancel={() => {
          if (!pending) setConfirmDeactivate(false);
        }}
        onConfirm={(confirmedReason) => void changeStatus(confirmedReason)}
      />
      {data.location.status === "active" && notice && !confirmDeactivate && (
        <p role="alert">{notice}</p>
      )}
      {dispatchDirty && (
        <p className="text-sm text-muted-foreground">
          Save or discard dispatch changes before changing location status.
        </p>
      )}
      {!pending && data.readiness && (
        <LocationFulfillmentWorkspace
          key={data.readiness.version}
          initial={{ ok: true, requestId: "location-setup", value: data.readiness }}
          locationId={locationId}
          onSaved={reload}
          onDirtyChange={setDispatchDirty}
          embedded
        />
      )}
      {!pending && !data.readiness && (
        <div
          role="alert"
          className="rounded-xl border border-border bg-[var(--fm-admin-surface)] p-5"
        >
          Dispatch settings could not be loaded.{" "}
          <Button variant="outline" onClick={reload}>
            Retry review
          </Button>
        </div>
      )}
    </div>
  );
}
