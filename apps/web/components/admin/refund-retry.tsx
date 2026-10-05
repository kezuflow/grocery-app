"use client";
import type { AdminRefundProgress } from "@freshmarkets/contracts";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/admin/shadcn/button";
import { refundResponse } from "@/lib/refund-response";
import { AdminConfirmationDialog } from "./admin-controls";
import { notifyCommandSuccess } from "./admin-feedback";

export function RefundRetry({
  refund,
  onAccepted,
  onInteractionState,
}: {
  refund: AdminRefundProgress;
  onAccepted(): Promise<void>;
  onInteractionState?(active: boolean): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<{ body: string; key: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const interaction = useRef(onInteractionState);
  interaction.current = onInteractionState;
  useEffect(() => {
    interaction.current?.(confirm || pending || saved !== null);
  }, [confirm, pending, saved]);
  useEffect(() => () => interaction.current?.(false), []);
  async function submit(reason: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    const intent = saved ?? {
      body: JSON.stringify({ refundId: refund.refundId, expectedVersion: refund.version, reason }),
      key: crypto.randomUUID(),
    };
    setSaved(intent);
    setPending(true);
    try {
      const result = refundResponse.parse(
        await (
          await fetch("/api/admin/payments/refunds/retry", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": intent.key },
            body: intent.body,
          })
        ).json(),
      );
      if (
        result.ok &&
        (result.value.paymentIntentId !== refund.paymentIntentId ||
          result.value.amountMinor !== refund.amountMinor ||
          result.value.currency !== refund.currency ||
          result.value.refundId === refund.refundId)
      )
        throw new Error("Mismatched retry receipt");
      setSaved(null);
      setConfirm(false);
      setNotice(
        result.ok
          ? "Refund retry accepted. Current provider progress is shown below."
          : result.error.message,
      );
      if (result.ok)
        notifyCommandSuccess("Refund retry accepted", "Current provider progress is shown below.");
      try {
        await onAccepted();
      } catch {
        setNotice(
          result.ok
            ? "Refund retry accepted. Reload this page to see current progress."
            : result.error.message,
        );
      }
    } catch {
      setConfirm(false);
      setNotice("The response is unknown. Retry the saved request to recover its result.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  if (!refund.recovery.canRetry && !saved && !notice) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {saved ? (
        <Button variant="outline" disabled={pending} onClick={() => void submit("")}>
          {pending ? "Retrying…" : "Retry saved refund retry"}
        </Button>
      ) : refund.recovery.canRetry ? (
        <Button ref={buttonRef} variant="outline" onClick={() => setConfirm(true)}>
          Retry refund
        </Button>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
      <AdminConfirmationDialog
        open={confirm}
        title="Retry rejected refund"
        resource={new Intl.NumberFormat("en-PH", {
          style: "currency",
          currency: refund.currency,
        }).format(refund.amountMinor / 100)}
        scope="Refund management"
        consequence="This submits a new refund for the same amount as the rejected attempt. Any linked cancellation continues after provider confirmation. Ensure the provider account has sufficient funds."
        maxReasonLength={500}
        restoreFocusRef={buttonRef}
        cancelLabel="Keep unchanged"
        confirmLabel="Retry refund"
        pending={pending}
        onCancel={() => {
          if (!inFlight.current) setConfirm(false);
        }}
        onConfirm={(reason) => void submit(reason)}
      />
    </div>
  );
}
