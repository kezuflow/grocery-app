"use client";
import { useState } from "react";
import Link from "next/link";
import { z, adminLocationViewSchema } from "@freshmarkets/validation";
import { appErrorCodes } from "@freshmarkets/contracts";
import { useLocationSetup, useSetupNavigationLock } from "./location-setup-state";
import { LocationFulfillmentWorkspace } from "./location-fulfillment-workspace";
import { useAdminCommandIntent } from "./admin-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
  const [pending, setPending] = useState<{
    action: "ACTIVATE";
    locationId: string;
    expectedVersion: number;
    reason: string;
  } | null>(null);
  async function activate() {
    if (!data?.location || !data.canManage || intent.pending) return;
    const payload = pending ?? {
      action: "ACTIVATE" as const,
      locationId,
      expectedVersion: data.location.version,
      reason,
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
        notifyCommandSuccess("Location activated");
        setReason("");
        reload();
      } else setNotice(response.error.message);
    } catch {
      setNotice("Activation not confirmed. Retry to confirm this change.");
    }
  }
  useSetupNavigationLock(pending !== null || intent.pending);
  if (loading && !pending) return <p role="status">Loading saved setup…</p>;
  if (!data?.location || !data.readiness)
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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Review {data.location.name}</h1>
      <Button variant="outline" disabled={navigationLocked} onClick={reload}>
        Refresh review
      </Button>
      <dl className="grid gap-4 rounded border p-4 sm:grid-cols-3">
        <div>
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
        <div>
          <dt className="font-medium">Pickup contact</dt>
          <dd>{data.pickup ? (data.pickup.profile?.senderName ?? "Not saved") : "Unavailable"}</dd>
          <dd>
            <Link {...guardedLink} className="underline" href={`${base}/pickup`}>
              Review pickup contact
            </Link>
          </dd>
        </div>
        <div>
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
          className="space-y-3 rounded border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void activate();
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
              (!pending && (navigationLocked || !reason.trim()))
            }
          >
            {intent.pending ? "Activating…" : pending ? "Retry activation" : "Activate location"}
          </Button>
        </form>
      )}
      {!pending && (
        <LocationFulfillmentWorkspace
          key={data.readiness.version}
          initial={{ ok: true, requestId: "location-setup", value: data.readiness }}
          locationId={locationId}
          onSaved={reload}
          embedded
        />
      )}
    </div>
  );
}
