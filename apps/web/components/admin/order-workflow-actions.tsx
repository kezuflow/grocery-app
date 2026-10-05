"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  appErrorCodes,
  type AdminOrderDetail,
  type AdminDeliveryOperationView,
  type DeliveryOperationsSummary,
  type FulfillmentAction,
  type FulfillmentQueuePage,
  type FulfillmentQueueView,
  type ManualDeliveryAction,
  type RpcResult,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { useAdminContext } from "../../app/admin/admin-context-provider";
import { useAdminCommandIntent } from "./admin-command-state";
import { ManualDeliveryControls } from "./delivery/manual-delivery-controls";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "./shadcn/button";
import { Alert, AlertDescription, AlertTitle } from "./shadcn/alert";
import { Input } from "./shadcn/input";
import { FieldGroup, Field, FieldLabel } from "./shadcn/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./shadcn/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "./shadcn/alert-dialog";

const preparationLabels: Record<FulfillmentAction, string> = {
  START_PICKING: "Accept order & start picking",
  MARK_READY_TO_PACK: "Finish picking",
  START_PACKING: "Start packing",
  MARK_PACKED: "Finish packing",
  COMPLETE_SCHEDULED_PACKING: "Finish packing order",
  RECORD_SHORTAGE: "Report shortage",
  RESUME_PICKING: "Resume picking",
  RESUME_READY_TO_PACK: "Resume packing preparation",
  ESCALATE: "Escalate shortage",
};
const manualLabels: Record<ManualDeliveryAction, string> = {
  ASSIGN: "Assign and hand over order",
  HAND_OVER: "Hand over packed order",
  COMPLETE: "Record delivered",
  FAIL: "Record delivery failure",
};
const commandResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), requestId: z.string(), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(appErrorCodes),
      message: z.string(),
      requestId: z.string(),
      details: z.record(z.string(), z.string()).optional(),
    }),
  }),
]);

export function OrderWorkflowActions({
  order,
  disabled,
  onCancel,
  onChanged,
  onInteractionState,
}: {
  order: AdminOrderDetail;
  disabled: boolean;
  onCancel: () => void;
  onChanged: () => Promise<void>;
  onInteractionState: (dirty: boolean, locked: boolean) => void;
}) {
  const { state } = useAdminContext();
  const controlId = useId();
  const locationId = order.fulfillment?.locationId;
  // An exact Order supplies its authoritative location; never choose a fallback assignment.
  const scopeMatches =
    state.phase === "ready" &&
    (state.selectedScope?.kind === "GLOBAL" ||
      (state.selectedScope?.kind === "LOCATION" && state.selectedScope.locationId === locationId));
  const capabilities = state.phase === "ready" ? state.context.capabilities : [];
  const readPreparation = Boolean(
    locationId && scopeMatches && capabilities.includes("fulfillment.read"),
  );
  const managePreparation = readPreparation && capabilities.includes("fulfillment.manage");
  const readDelivery = Boolean(
    locationId && scopeMatches && capabilities.includes("delivery.read"),
  );
  const manageDelivery = readDelivery && capabilities.includes("delivery.manage");
  const [preparation, setPreparation] = useState<FulfillmentQueueView | null>(null);
  const [delivery, setDelivery] = useState<AdminDeliveryOperationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<FulfillmentAction | null>(null);
  const [manualAction, setManualAction] = useState<ManualDeliveryAction | null>(null);
  const [manualInteraction, setManualInteraction] = useState({ dirty: false, locked: false });
  const [reason, setReason] = useState("");
  const [frozen, setFrozen] = useState<{ action: FulfillmentAction; body: string } | null>(null);
  const intent = useAdminCommandIntent({
    retainConflict: (error) => error.details?.outcome === "RECONCILIATION_PENDING",
  });
  const locked = intent.pending || intent.uncertain || frozen !== null || manualInteraction.locked;
  const dirty = selected !== null || manualInteraction.dirty;
  const blocked = useRef(false);
  blocked.current = disabled || locked || dirty;
  const readSequence = useRef(0);
  const callbacks = useRef({ onChanged, onInteractionState });
  callbacks.current = { onChanged, onInteractionState };
  useEffect(() => {
    callbacks.current.onInteractionState(dirty, locked);
  }, [dirty, locked]);
  useEffect(() => () => callbacks.current.onInteractionState(false, false), []);

  const load = useCallback(
    async (confirmedCommand = false) => {
      if (blocked.current && !confirmedCommand) return;
      const sequence = ++readSequence.current;
      setLoading(true);
      setReadError(null);
      setPreparation(null);
      setDelivery(null);
      const params = new URLSearchParams({
        locationId: locationId ?? "",
        orderId: order.orderId,
        limit: "1",
      });
      const read = async <T,>(url: string): Promise<T> => {
        const response = await fetch(url, { cache: "no-store" });
        const result = (await response.json()) as RpcResult<T>;
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      };
      const results = await Promise.allSettled([
        readPreparation
          ? read<FulfillmentQueuePage>(`/api/admin/fulfillment?${params}&filter=ALL`)
          : Promise.resolve(null),
        readDelivery
          ? read<DeliveryOperationsSummary>(`/api/admin/delivery?${params}`)
          : Promise.resolve(null),
      ]);
      if (sequence !== readSequence.current) return;
      const [prep, dispatch] = results;
      if (prep.status === "fulfilled")
        setPreparation(
          prep.value?.items.find(
            (item) => item.orderId === order.orderId && item.locationId === locationId,
          ) ?? null,
        );
      if (dispatch.status === "fulfilled")
        setDelivery(
          dispatch.value?.items.find(
            (item) => item.orderId === order.orderId && item.locationId === locationId,
          ) ?? null,
        );
      if (results.some((result) => result.status === "rejected"))
        setReadError("Some workflow actions could not be loaded. Refresh before continuing.");
      setLoading(false);
    },
    [locationId, order.orderId, readPreparation, readDelivery],
  );

  useEffect(() => {
    void load();
    return () => {
      readSequence.current += 1;
    };
  }, [load, order.version, order.fulfillment?.version, order.delivery?.version]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  async function submit(request: NonNullable<typeof frozen>) {
    if (intent.pending) return;
    blocked.current = true;
    readSequence.current += 1;
    setFrozen(request);
    setSelected(null);
    setMessage(null);
    try {
      const result = await intent.submit(async (key) => {
        const response = await fetch("/api/admin/fulfillment", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": key },
          body: request.body,
        });
        return commandResult.parse(await response.json());
      });
      if (
        !result.ok &&
        result.error.code === "CONFLICT" &&
        result.error.details?.outcome === "RECONCILIATION_PENDING"
      ) {
        setMessage(
          "The original action is still processing. Retry the saved request to confirm its outcome.",
        );
        return;
      }
      setFrozen(null);
      setReason("");
      setMessage(
        result.ok ? `${preparationLabels[request.action]} completed.` : result.error.message,
      );
      if (result.ok) notifyCommandSuccess("Order preparation updated");
      await callbacks.current.onChanged();
      await load(true);
    } catch {
      setMessage("The outcome is unknown. Retry the saved request before starting another action.");
    }
  }

  function confirmPreparation() {
    if (
      !selected ||
      !preparation ||
      disabled ||
      locked ||
      !managePreparation ||
      !preparation.allowedActions.includes(selected)
    )
      return;
    void submit({
      action: selected,
      body: JSON.stringify({
        locationId,
        orderId: order.orderId,
        action: selected,
        expectedVersion: preparation.version,
        ...(["RECORD_SHORTAGE", "ESCALATE"].includes(selected) && reason.trim()
          ? { reason: reason.trim() }
          : {}),
      }),
    });
  }

  const preparationActions = managePreparation ? (preparation?.allowedActions ?? []) : [];
  const manualActions = manageDelivery ? (delivery?.manualActions ?? []) : [];
  const canCancel = order.allowedActions.includes("CANCEL");
  const hasActions = canCancel || preparationActions.length > 0 || manualActions.length > 0;
  return (
    <section className="flex flex-col gap-3" aria-label="Order workflow actions">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={controlId}>Update order</FieldLabel>
          <Select
            value=""
            disabled={disabled || locked || dirty || !hasActions}
            onValueChange={(value) => {
              if (blocked.current) return;
              if (value === "CANCEL" && canCancel) onCancel();
              else if (value.startsWith("PREPARATION:")) {
                const action = value.slice(12) as FulfillmentAction;
                if (preparationActions.includes(action)) {
                  setReason("");
                  setSelected(action);
                }
              } else if (value.startsWith("MANUAL:")) {
                const action = value.slice(7) as ManualDeliveryAction;
                if (manualActions.includes(action)) setManualAction(action);
              }
            }}
          >
            <SelectTrigger id={controlId} aria-label="Order status" className="w-full">
              <SelectValue
                placeholder={loading ? "Loading workflow actions…" : "Choose status action"}
              />
            </SelectTrigger>
            <SelectContent>
              {preparationActions.length ? (
                <SelectGroup>
                  <SelectLabel>Preparation</SelectLabel>
                  {preparationActions.map((action) => (
                    <SelectItem key={action} value={`PREPARATION:${action}`}>
                      {preparationLabels[action]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {manualActions.length ? (
                <SelectGroup>
                  <SelectLabel>Manual delivery</SelectLabel>
                  {manualActions.map((action) => (
                    <SelectItem key={action} value={`MANUAL:${action}`}>
                      {manualLabels[action]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {canCancel ? (
                <SelectGroup>
                  <SelectLabel>Cancellation</SelectLabel>
                  <SelectItem value="CANCEL">Cancel order</SelectItem>
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
      {!loading && !hasActions ? (
        <p className="text-sm text-muted-foreground">
          No status action is currently available for this order and your permissions.
        </p>
      ) : null}
      {preparation?.operational?.blockers.map((blocker) => (
        <p key={blocker} className="text-sm text-muted-foreground">
          {blocker}
        </p>
      ))}
      {locationId && !scopeMatches ? (
        <p className="text-sm text-muted-foreground">
          Select this order’s location scope to manage preparation and delivery.
        </p>
      ) : null}
      {delivery?.externalDispatch ? (
        <p className="text-sm text-muted-foreground">
          Courier delivery status updates from the provider. Use Manage delivery for courier
          actions.
        </p>
      ) : null}
      {readError ? (
        <Alert>
          <AlertTitle>Workflow actions unavailable</AlertTitle>
          <AlertDescription>
            {readError}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || locked || dirty}
              onClick={() => void load()}
            >
              Refresh actions
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert role="status">
          <AlertTitle>Workflow update</AlertTitle>
          <AlertDescription>
            {message}
            {frozen ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={intent.pending}
                onClick={() => void submit(frozen)}
              >
                Retry saved preparation
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {manualAction && delivery ? (
        <ManualDeliveryControls
          key={`${delivery.jobId}:${manualAction}`}
          item={delivery}
          disabled={disabled || intent.pending || frozen !== null}
          initialAction={manualAction}
          onDismiss={() => setManualAction(null)}
          onRejected={(error) => {
            setMessage(error);
            setManualAction(null);
            void callbacks.current.onChanged().then(() => load(true));
          }}
          onInteractionState={(draft, pending) =>
            setManualInteraction({ dirty: draft, locked: pending })
          }
          onChanged={() => {
            setManualAction(null);
            void callbacks.current.onChanged().then(() => load(true));
          }}
        />
      ) : null}
      <AlertDialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !intent.pending) setSelected(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {selected ? preparationLabels[selected] : "Update preparation"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {selected === "MARK_PACKED" || selected === "COMPLETE_SCHEDULED_PACKING"
              ? "Confirm every paid item and quantity in this Order has been physically packed and checked accurately."
              : "Confirm this preparation action for the selected Order. Current eligibility and quantities will be checked before saving."}
          </AlertDialogDescription>
          {selected === "RECORD_SHORTAGE" || selected === "ESCALATE" ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${controlId}-reason`}>Reason (optional)</FieldLabel>
                <Input
                  id={`${controlId}-reason`}
                  value={reason}
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            </FieldGroup>
          ) : null}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                Back
              </Button>
            </AlertDialogCancel>
            <Button type="button" disabled={disabled || locked} onClick={confirmPreparation}>
              Confirm preparation
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
