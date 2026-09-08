"use client";
import { useState } from "react";
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
}: {
  initial: RpcResult<AdminLocationFulfillmentView>;
  locationId: string;
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
      accept(
        responseSchema.parse(
          await (
            await fetch(
              `/api/admin/location-fulfillment?locationId=${encodeURIComponent(locationId)}`,
            )
          ).json(),
        ),
      );
      setNotice("");
    } catch {
      setNotice("Settings could not be loaded. Retry refresh.");
    } finally {
      setLoading(false);
    }
  }
  async function save() {
    if (!result.ok || intent.pending) return;
    const payload = pending ?? {
      locationId,
      expectedVersion: result.value.version,
      dispatchReady: ready,
      instantPromiseMinutes: minutes.trim() ? Number(minutes) : null,
      reason,
    };
    setPending(payload);
    try {
      const next = await intent.submit(async (key) =>
        responseSchema.parse(
          await (
            await fetch("/api/admin/location-fulfillment", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": key },
              body: JSON.stringify(payload),
            })
          ).json(),
        ),
      );
      setPending(null);
      if (next.ok) {
        accept(next);
        setNotice("Fulfillment settings saved. Existing orders keep their accepted promises.");
      } else setNotice(next.error.message);
    } catch {
      setNotice("Response not confirmed. Retry the same fulfillment request.");
    }
  }
  return (
    <div className="space-y-4">
      <Link href="/admin/locations" className="underline">
        Locations
      </Link>
      <PageHeader
        title={
          result.ok ? `${result.value.locationName} fulfillment readiness` : "Fulfillment readiness"
        }
        description="Confirm operational readiness and set the promise for new Instant orders."
      />
      <p role="status">{notice || (!result.ok ? result.error.message : "")}</p>
      <Button variant="outline" disabled={locked} onClick={() => void refresh()}>
        Refresh settings
      </Button>
      {pending && (
        <Button disabled={intent.pending} onClick={() => void save()}>
          Retry unconfirmed settings
        </Button>
      )}
      {result.ok && (
        <>
          {result.value.blockers.length > 0 && (
            <ul className="list-disc pl-5">
              {result.value.blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {!result.value.canManage && (
            <p>Global location management access is required to change these settings.</p>
          )}
          <fieldset disabled={locked || !result.value.canManage} className="max-w-xl space-y-4">
            <legend className="font-semibold">Location fulfillment</legend>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={ready}
                disabled={locked || !result.value.canManage}
                onCheckedChange={(checked) => setReady(checked === true)}
              />
              Ready to dispatch customer orders
            </label>
            <label className="block">
              Instant delivery promise (minutes)
              <Input
                type="number"
                min="1"
                step="1"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              An Instant promise is required before opening Instant commerce. Scheduled orders use
              their accepted delivery window.
            </p>
            <label className="block">
              Reason
              <Input
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <Button
              disabled={locked || !result.value.canManage || !reason.trim()}
              onClick={() => void save()}
            >
              Save fulfillment settings
            </Button>
          </fieldset>
        </>
      )}
    </div>
  );
}
