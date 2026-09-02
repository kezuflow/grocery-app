"use client";

import { useCallback, useEffect, useState } from "react";
import type { FulfillmentModeConfigurationView, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { WorkspaceNavigation } from "../../../../components/admin/workspace-navigation";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { useAdminContext } from "../../admin-context-provider";

export default function FulfillmentModePage() {
  const { state: adminState } = useAdminContext();
  const isGlobal = adminState.phase === "ready" && adminState.selectedScope?.kind === "GLOBAL";
  const [configuration, setConfiguration] = useState<FulfillmentModeConfigurationView | null>(null);
  const [state, setState] = useState("loading");
  const [mode, setMode] = useState<"INSTANT" | "SCHEDULED">("SCHEDULED");
  const [notice, setNotice] = useState<string | null>(null);
  const saveIntent = useAdminCommandIntent();

  const load = useCallback(async () => {
    if (!isGlobal) return;
    setState("loading");
    try {
      const payload = (await (
        await fetch("/api/admin/fulfillment-mode")
      ).json()) as RpcResult<FulfillmentModeConfigurationView>;
      if (!payload.ok) {
        setNotice(
          payload.error.code === "FORBIDDEN"
            ? "Global fulfillment configuration is not permitted for this account."
            : payload.error.message,
        );
        setState("error");
        return;
      }
      setConfiguration(payload.value);
      setMode(payload.value.activeMode);
      setState("ready");
    } catch {
      setNotice("Network error loading the global fulfillment configuration.");
      setState("error");
    }
  }, [isGlobal]);

  useEffect(() => {
    if (isGlobal) void load();
  }, [isGlobal, load]);

  async function save() {
    if (!configuration || !isGlobal || saveIntent.pending) return;
    const payload = await saveIntent.submit(async (idempotencyKey) => {
      const response = await fetch("/api/admin/fulfillment-mode", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          fulfillmentMode: mode,
          cadence: mode === "SCHEDULED" ? "WEEKLY" : null,
          expectedVersion: configuration.version,
        }),
      });
      return (await response.json()) as RpcResult<FulfillmentModeConfigurationView>;
    });
    setNotice(payload.ok ? "Global fulfillment mode saved." : payload.error.message);
    if (payload.ok) {
      setConfiguration(payload.value);
      setMode(payload.value.activeMode);
    }
    if (
      !payload.ok &&
      (payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT")
    )
      void load();
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <PageHeader
        title="Fulfillment mode"
        description="One global mode governs all new customer orders. Locations never run mixed customer modes."
      />
      <WorkspaceNavigation parentCode="settings" label="Settings administration" />
      {!isGlobal ? (
        <AdminPageState
          state="permission-empty"
          title="Switch to Global scope"
          message="Fulfillment mode is a business-wide setting. Select Global in the Admin header to view or change it."
        />
      ) : state === "loading" ? (
        <div role="status" aria-label="Loading global fulfillment mode">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
      ) : null}
      {isGlobal && state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Global fulfillment configuration could not be loaded</AlertTitle>
          <AlertDescription>
            {notice}
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {isGlobal && state === "ready" && configuration ? (
        <ListPageSection
          title="FreshMarkets fulfillment"
          description={`Current version ${configuration.version}. Committed orders keep their original mode and location snapshots.`}
        >
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Global mode
              <select
                aria-label="Global fulfillment mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as "INSTANT" | "SCHEDULED")}
                className="flex h-9 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 text-sm dark:bg-[var(--fm-surface)]"
              >
                <option value="SCHEDULED">Scheduled (Weekly cadence)</option>
                <option value="INSTANT">Instant</option>
              </select>
            </label>
            <div className="space-y-1 text-sm font-medium">
              Active across FreshMarkets
              <div className="pt-1">
                <StatusBadge>{configuration.activeMode}</StatusBadge>
              </div>
            </div>
          </div>
          <div className="border-t border-[var(--fm-border)] p-4 text-sm text-[var(--fm-muted-foreground)]">
            Switching to Instant is blocked until every open location is dispatch-ready and all
            outstanding Scheduled demand is protected.
          </div>
          <div className="border-t border-[var(--fm-border)] p-4">
            <Button
              disabled={saveIntent.pending || mode === configuration.activeMode}
              onClick={() => void save()}
            >
              {saveIntent.pending ? "Saving…" : "Activate global mode"}
            </Button>
          </div>
        </ListPageSection>
      ) : null}
    </div>
  );
}
