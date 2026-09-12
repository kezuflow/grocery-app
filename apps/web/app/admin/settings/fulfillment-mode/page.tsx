"use client";

import { appErrorCodes, type GlobalCommerceConfigurationView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { useCallback, useEffect, useState, useRef } from "react";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { AdminPageState } from "../../../../components/admin/admin-page-state";
import { WorkspaceNavigation } from "../../../../components/admin/workspace-navigation";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { Skeleton } from "../../../../components/ui/skeleton";
import { useAdminContext } from "../../admin-context-provider";

type CommerceAction = "PAUSE" | "SWITCH_MODE" | "OPEN";
type Command = {
  action: CommerceAction;
  expectedVersion: number;
  reason: string;
  fulfillmentMode?: "INSTANT" | "SCHEDULED";
  cadence?: "WEEKLY" | null;
};
const responseSchema = z.union([
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      sellingState: z.enum(["OPEN", "PAUSED"]),
      fulfillmentMode: z.enum(["INSTANT", "SCHEDULED"]),
      cadence: z.literal("WEEKLY").nullable(),
      version: z.number().int().positive(),
      readinessBlockers: z.array(z.object({ code: z.string(), message: z.string() })),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
]);

export default function FulfillmentModePage() {
  const { state: adminState } = useAdminContext();
  const isGlobal = adminState.phase === "ready" && adminState.selectedScope?.kind === "GLOBAL";
  const [configuration, setConfiguration] = useState<GlobalCommerceConfigurationView | null>(null);
  const [state, setState] = useState("loading");
  const [mode, setMode] = useState<"INSTANT" | "SCHEDULED">("SCHEDULED");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const commandIntent = useAdminCommandIntent();
  const [unconfirmed, setUnconfirmed] = useState<Command | null>(null);
  const locked = commandIntent.pending || unconfirmed !== null;
  const readGeneration = useRef(0);

  const load = useCallback(async () => {
    if (!isGlobal || unconfirmed) return;
    const generation = ++readGeneration.current;
    setState("loading");
    try {
      const payload = responseSchema.parse(
        await (await fetch("/api/admin/commerce-configuration")).json(),
      );
      if (generation !== readGeneration.current) return;
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
      if (generation !== readGeneration.current) return;
      setNotice("Network error loading the global commerce configuration.");
      setState("error");
    }
  }, [isGlobal, unconfirmed]);

  useEffect(() => {
    if (isGlobal) void load();
  }, [isGlobal, load]);

  async function run(action: CommerceAction) {
    if (!configuration || (!isGlobal && !unconfirmed) || commandIntent.pending) return;
    if (!unconfirmed && !reason.trim()) {
      setNotice("A reason is required for commerce configuration changes.");
      return;
    }
    const command = unconfirmed ?? {
      action,
      expectedVersion: configuration.version,
      reason: reason.trim(),
      ...(action === "SWITCH_MODE"
        ? { fulfillmentMode: mode, cadence: mode === "SCHEDULED" ? ("WEEKLY" as const) : null }
        : {}),
    };
    readGeneration.current += 1;
    setUnconfirmed(command);
    try {
      const payload = await commandIntent.submit(async (idempotencyKey) =>
        responseSchema.parse(
          await (
            await fetch("/api/admin/commerce-configuration", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify(command),
            })
          ).json(),
        ),
      );
      setUnconfirmed(null);
      setNotice(
        payload.ok
          ? command.action === "PAUSE"
            ? "Selling paused."
            : command.action === "OPEN"
              ? "Selling reopened."
              : "Global fulfillment mode saved."
          : payload.error.message,
      );
      if (payload.ok) {
        setConfiguration(payload.value);
        setMode(payload.value.fulfillmentMode);
        setReason("");
      }
    } catch {
      setNotice(
        "Response not confirmed. Retry the original commerce request to recover its result.",
      );
    }
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Fulfillment mode"
        description="Pause selling, switch the one global fulfillment mode, verify readiness, and reopen new commerce."
      />
      <WorkspaceNavigation parentCode="settings" label="Settings administration" />
      {!isGlobal && !unconfirmed ? (
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
      {(isGlobal || unconfirmed) && state === "ready" && configuration ? (
        <ListPageSection
          title="FreshMarkets commerce"
          description="Committed orders keep their original mode, promise, price, and delivery snapshots."
        >
          {notice ? (
            <p role="status" className="border-b p-3 text-sm">
              {notice}
            </p>
          ) : null}
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              Global mode
              <Select
                disabled={locked}
                value={mode}
                onValueChange={(value) => {
                  if (value === "INSTANT" || value === "SCHEDULED") setMode(value);
                }}
              >
                <SelectTrigger aria-label="Global fulfillment mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHEDULED">Scheduled (Weekly cadence)</SelectItem>
                  <SelectItem value="INSTANT">Instant</SelectItem>
                </SelectContent>
              </Select>
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
                disabled={locked}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {unconfirmed && (
                <Button
                  disabled={commandIntent.pending}
                  onClick={() => void run(unconfirmed.action)}
                >
                  Retry unconfirmed commerce request
                </Button>
              )}
              {configuration.sellingState === "OPEN" ? (
                <Button disabled={locked} onClick={() => void run("PAUSE")}>
                  {commandIntent.pending ? "Saving…" : "Pause selling"}
                </Button>
              ) : (
                <>
                  <Button
                    disabled={locked || mode === configuration.fulfillmentMode}
                    onClick={() => void run("SWITCH_MODE")}
                  >
                    {commandIntent.pending ? "Saving…" : "Activate global mode"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={locked || mode !== configuration.fulfillmentMode}
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
