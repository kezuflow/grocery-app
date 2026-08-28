"use client";
import { useCallback, useEffect, useState } from "react";
import type { FulfillmentModeConfigurationView, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
const location = "location-cebu-central";
export default function FulfillmentModePage() {
  const [configuration, setConfiguration] = useState<FulfillmentModeConfigurationView | null>(null);
  const [state, setState] = useState("loading");
  const [mode, setMode] = useState<"INSTANT" | "SCHEDULED">("SCHEDULED");
  const [promiseMinutes, setPromiseMinutes] = useState("");
  const [capacity, setCapacity] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    setState("loading");
    try {
      const payload = (await (
        await fetch(`/api/admin/fulfillment-mode?locationId=${location}`)
      ).json()) as RpcResult<FulfillmentModeConfigurationView>;
      if (!payload.ok) {
        setNotice(
          payload.error.code === "FORBIDDEN"
            ? "Fulfillment configuration is not permitted for this scope."
            : payload.error.message,
        );
        setState("error");
        return;
      }
      setConfiguration(payload.value);
      setMode(payload.value.activeMode);
      setPromiseMinutes(payload.value.promiseMinutes?.toString() ?? "");
      setCapacity(payload.value.maxConcurrentInstantOrders?.toString() ?? "");
      setState("ready");
    } catch {
      setNotice("Network error loading fulfillment configuration.");
      setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    if (!configuration) return;
    const promise = promiseMinutes.trim() === "" ? null : Number(promiseMinutes);
    const max = capacity.trim() === "" ? null : Number(capacity);
    if (
      (promise !== null && (!Number.isInteger(promise) || promise <= 0)) ||
      (max !== null && (!Number.isInteger(max) || max <= 0))
    ) {
      setNotice("Promise and capacity must be positive integers when supplied.");
      return;
    }
    const response = await fetch("/api/admin/fulfillment-mode", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        locationId: location,
        fulfillmentMode: mode,
        cadence: mode === "SCHEDULED" ? "WEEKLY" : null,
        promiseMinutes: promise,
        maxConcurrentInstantOrders: max,
        expectedVersion: configuration.version,
      }),
    });
    const payload = (await response.json()) as RpcResult<FulfillmentModeConfigurationView>;
    setNotice(payload.ok ? "Fulfillment mode configuration saved." : payload.error.message);
    if (payload.ok) {
      setConfiguration(payload.value);
      setMode(payload.value.activeMode);
    }
  }
  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <PageHeader
        title="Fulfillment mode"
        description="Explicit location configuration. INSTANT and SCHEDULED are the only fulfillment modes; WEEKLY is Scheduled cadence."
      />
      {state === "loading" ? (
        <div role="status" aria-label="Loading fulfillment mode">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
      ) : null}
      {state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Fulfillment configuration could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {state === "ready" && configuration ? (
        <ListPageSection
          title="Cebu Central configuration"
          description={`Current version ${configuration.version}. Changes never rewrite committed order snapshots.`}
        >
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Mode
              <select
                aria-label="Fulfillment mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as "INSTANT" | "SCHEDULED")}
                className="flex h-9 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm"
              >
                <option value="SCHEDULED">Scheduled (Weekly cadence)</option>
                <option value="INSTANT">Instant</option>
              </select>
            </label>
            <div className="space-y-1 text-sm font-medium">
              Current state
              <div className="pt-1">
                <StatusBadge>{configuration.activeMode}</StatusBadge>
              </div>
            </div>
            <label className="space-y-1 text-sm font-medium">
              Promise minutes
              <Input
                aria-label="Promise minutes"
                inputMode="numeric"
                value={promiseMinutes}
                onChange={(event) => setPromiseMinutes(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Instant concurrent order limit
              <Input
                aria-label="Instant concurrent order limit"
                inputMode="numeric"
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
              />
            </label>
          </div>
          <div className="border-t border-[var(--fm-border)] p-4">
            <Button onClick={() => void save()}>Save configuration</Button>
          </div>
        </ListPageSection>
      ) : null}
    </div>
  );
}
