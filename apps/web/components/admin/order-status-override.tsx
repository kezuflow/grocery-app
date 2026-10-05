"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  appErrorCodes,
  orderStates,
  type AdminOrderDetail,
  type OrderState,
} from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { useAdminCommandIntent } from "./admin-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "./shadcn/button";
import { FieldGroup, Field, FieldLabel, FieldDescription } from "./shadcn/field";
import { Textarea } from "./shadcn/textarea";
import { Alert, AlertTitle, AlertDescription } from "./shadcn/alert";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
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

const responseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    requestId: z.string(),
    value: z.object({
      orderId: z.string(),
      previousStatus: z.string(),
      status: z.enum(orderStates),
      version: z.number().int().positive(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(appErrorCodes), message: z.string(), requestId: z.string() }),
  }),
]);
function label(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function OrderStatusOverride({
  order,
  disabled,
  onChanged,
  onInteractionState,
}: {
  order: Pick<
    AdminOrderDetail,
    "orderId" | "orderNumber" | "status" | "version" | "allowedActions"
  >;
  disabled: boolean;
  onChanged: () => Promise<void>;
  onInteractionState: (dirty: boolean, locked: boolean) => void;
}) {
  const [target, setTarget] = useState<OrderState | null>(null);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const intent = useAdminCommandIntent({ retainConflict: (error) => error.code === "CONFLICT" });
  const locked = intent.pending || intent.uncertain || saved !== null;
  const callbacks = useRef({ onChanged, onInteractionState });
  callbacks.current = { onChanged, onInteractionState };
  const controlId = useId();
  useEffect(() => {
    callbacks.current.onInteractionState(target !== null, locked);
  }, [target, locked]);
  useEffect(() => () => callbacks.current.onInteractionState(false, false), []);
  const allowed = order.allowedActions.includes("OVERRIDE_STATUS");

  async function submit(body: string) {
    if (intent.pending || disabled) return;
    setSaved(body);
    setTarget(null);
    setMessage(null);
    try {
      const result = await intent.submit(async (key) => {
        const response = await fetch(
          `/api/admin/orders/${encodeURIComponent(order.orderId)}/status`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": key },
            body,
          },
        );
        const payload = responseSchema.parse(await response.json());
        if (!payload.ok && payload.error.code === "INTERNAL_ERROR")
          throw new Error("Unconfirmed status correction");
        return payload;
      });
      if (!result.ok && result.error.code === "CONFLICT") {
        setMessage("The original correction is not confirmed yet. Retry the saved request.");
        return;
      }
      setSaved(null);
      setReason("");
      setMessage(
        result.ok
          ? `Order status changed to ${label(result.value.status)}. Other workflow records were not changed.`
          : result.error.message,
      );
      if (result.ok) notifyCommandSuccess("Order status corrected");
      await callbacks.current.onChanged();
    } catch {
      setMessage("The result is unknown. Retry the saved correction before making another change.");
    }
  }
  if (!allowed && !locked) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Order status override">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={controlId}>Order status</FieldLabel>
          <Select
            value={order.status}
            disabled={disabled || locked || !allowed}
            onValueChange={(value) => {
              if (disabled || locked || !allowed || !orderStates.includes(value as OrderState))
                return;
              setTarget(value as OrderState);
              setReason("");
            }}
          >
            <SelectTrigger id={controlId} aria-label="Override Order status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {!orderStates.includes(order.status as OrderState) ? (
                  <SelectItem value={order.status} disabled>
                    {label(order.status)}
                  </SelectItem>
                ) : null}
                {orderStates.map((status) => (
                  <SelectItem key={status} value={status}>
                    {label(status)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Administrative status correction only. Use workflow actions below for refunds,
            preparation and delivery.
          </FieldDescription>
        </Field>
      </FieldGroup>
      {message ? (
        <Alert role="status">
          <AlertTitle>Status correction</AlertTitle>
          <AlertDescription>
            {message}
            {saved ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={intent.pending || disabled}
                onClick={() => void submit(saved)}
              >
                Retry saved status correction
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !locked) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Override Order status</AlertDialogTitle>
          <AlertDialogDescription>
            Change Order {order.orderNumber ?? order.orderId} from {label(order.status)} to{" "}
            {target ? label(target) : ""}. This changes the Order status only; payments, refunds,
            stock and delivery records remain unchanged.
          </AlertDialogDescription>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${controlId}-reason`}>Audit reason</FieldLabel>
              <Textarea
                id={`${controlId}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                required
              />
            </Field>
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="outline">
                Back
              </Button>
            </AlertDialogCancel>
            <Button
              type="button"
              disabled={disabled || locked || !allowed || !reason.trim()}
              onClick={() => {
                if (target && reason.trim() && allowed)
                  void submit(
                    JSON.stringify({
                      status: target,
                      reason: reason.trim(),
                      expectedVersion: order.version,
                    }),
                  );
              }}
            >
              Confirm status override
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
