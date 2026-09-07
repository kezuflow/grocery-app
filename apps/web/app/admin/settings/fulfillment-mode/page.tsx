"use client";

import type { GlobalCommerceConfigurationView, RpcResult } from "@freshmarkets/contracts";
import { useCallback, useEffect, useState } from "react";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { WorkspaceNavigation } from "../../../../components/admin/workspace-navigation";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useAdminContext } from "../../admin-context-provider";

type CommerceAction = "PAUSE" | "SWITCH_MODE" | "OPEN";

export default function FulfillmentModePage() {
  const { state: adminState } = useAdminContext();
  const isGlobal = adminState.phase === "ready" && adminState.selectedScope?.kind === "GLOBAL";
  const [configuration, setConfiguration] = useState<GlobalCommerceConfigurationView | null>(null);
  const [state, setState] = useState("loading");
  const [mode, setMode] = useState<"INSTANT" | "SCHEDULED">("SCHEDULED");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();

  const load = useCallback(async () => {
    if (!isGlobal) return;
    setState("loading");
    try {
      const payload = (await (
        await fetch("/api/admin/commerce-configuration")
      ).json()) as RpcResult<GlobalCommerceConfigurationView>;
      if (!payload.ok) {
        setNotice(
          payload.error.code === "FORBIDDEN"
            ? "Global commerce configuration is not permitted for this account."
            : payload.error.message,
        );
        setState("error");
        return;
      }
      setConfiguration(payload.value);
      setMode(payload.value.fulfillmentMode);
      setState("ready");
    } catch {
      setNotice("Network error loading the global commerce configuration.");
      setState("error");
    }
  }, [isGlobal]);

  useEffect(() => {
    if (isGlobal) void load();
  }, [isGlobal, load]);

  async function run(action: CommerceAction) {
    if (!configuration || !isGlobal || commandIntent.pending) return;
    if (!reason.trim()) {
      setNotice("A reason is required for commerce configuration changes.");
      return;
    }
    const payload = await commandIntent.submit(async (idempotencyKey) => {
      const response = await fetch("/api/admin/commerce-configuration", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          action,
          expectedVersion: configuration.version,
          reason: reason.trim(),
          ...(action === "SWITCH_MODE"
            ? { fulfillmentMode: mode, cadence: mode === "SCHEDULED" ? "WEEKLY" : null }
            : {}),
        }),
      });
      return (await response.json()) as RpcResult<GlobalCommerceConfigurationView>;
    });
    setNotice(
      payload.ok
        ? action === "PAUSE"
          ? "Selling paused."
          : action === "OPEN"
            ? "Selling reopened."
            : "Global fulfillment mode saved."
        : payload.error.message,
    );
    if (payload.ok) {
      setConfiguration(payload.value);
      setMode(payload.value.fulfillmentMode);
      setReason("");
    } else if (payload.error.code === "STALE_VERSION" || payload.error.code === "CONFLICT") {
      void load();
    }
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <PageHeader
        title="Fulfillment mode"
        description="Pause selling, switch the one global fulfillment mode, verify readiness, and reopen new commerce."
      />
      <WorkspaceNavigation parentCode="settings" label="Settings administration" />
      {!isGlobal ? (
        <AdminPageState
          state="permission-empty"
          title="Switch to Global scope"
          message="Commerce mode is a business-wide setting. Select Global in the Admin header to view or change it."
        />
      ) : state === "loading" ? (
        <div role="status" aria-label="Loading global commerce configuration">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-3 h-40 w-full" />
        </div>
      ) : null}
      {isGlobal && state === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Global commerce configuration could not be loaded</AlertTitle>
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
          title="FreshMarkets commerce"
          description={`Current version ${configuration.version}. Committed orders keep their original mode, promise, price, and delivery snapshots.`}
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
              Selling state
              <div className="pt-1">
                <StatusBadge tone={configuration.sellingState === "OPEN" ? "success" : "warning"}>
                  {configuration.sellingState}
                </StatusBadge>
              </div>
            </div>
          </div>
          <p className="border-t border-[var(--fm-border)] p-4 text-sm text-[var(--fm-muted-foreground)]">
            Active mode: <strong>{configuration.fulfillmentMode}</strong>. A mode switch is legal
            only while selling is paused and after mode-specific readiness passes.
          </p>
          {configuration.readinessBlockers.length > 0 ? (
            <ul
              className="border-t border-[var(--fm-border)] p-4 text-sm"
              aria-label="Readiness blockers"
            >
              {configuration.readinessBlockers.map((blocker) => (
                <li key={blocker.code}>{blocker.message}</li>
              ))}
            </ul>
          ) : null}
          <div className="space-y-3 border-t border-[var(--fm-border)] p-4">
            <label className="block space-y-1 text-sm font-medium">
              Change reason
              <Input
                aria-label="Commerce change reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {configuration.sellingState === "OPEN" ? (
                <Button disabled={commandIntent.pending} onClick={() => void run("PAUSE")}>
                  {commandIntent.pending ? "Saving…" : "Pause selling"}
                </Button>
              ) : (
                <>
                  <Button
                    disabled={commandIntent.pending || mode === configuration.fulfillmentMode}
                    onClick={() => void run("SWITCH_MODE")}
                  >
                    {commandIntent.pending ? "Saving…" : "Activate global mode"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={commandIntent.pending || mode !== configuration.fulfillmentMode}
                    onClick={() => void run("OPEN")}
                  >
                    {commandIntent.pending ? "Saving…" : "Reopen selling"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </ListPageSection>
      ) : null}
    </div>
  );
}
