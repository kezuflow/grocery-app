"use client";
import { useState } from "react";
import type { AdminReconciliationCaseView } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
const response = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      caseId: z.string(),
      state: z.literal("QUEUED"),
      version: z.number().int().safe().positive(),
      acceptedAt: z.string().datetime(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export function PaymentReactionRecovery({
  record,
  onAccepted,
}: {
  record: AdminReconciliationCaseView;
  onAccepted: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<{ body: string; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function submit() {
    const intent = saved ?? {
      body: JSON.stringify({
        caseId: record.caseId,
        expectedVersion: record.version,
        expectedPaymentVersion: record.paymentReactionRecovery?.paymentVersion,
        reason: reason.trim(),
      }),
      key: crypto.randomUUID(),
    };
    setSaved(intent);
    setPending(true);
    try {
      const result = response.safeParse(
        await (
          await fetch("/api/admin/payments/reaction-retry", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": intent.key },
            body: intent.body,
          })
        ).json(),
      );
      if (!result.success) throw new Error("Unknown acceptance");
      if (result.data.ok && result.data.value.caseId !== record.caseId)
        throw new Error("Mismatched acceptance");
      setSaved(null);
      setNotice(
        result.data.ok
          ? "Commitment retry queued. Refresh for current progress."
          : result.data.error.message,
      );
      try {
        await onAccepted();
      } catch {
        setNotice(
          result.data.ok
            ? "Commitment retry queued. Current progress could not be refreshed; reload this page."
            : result.data.error.message,
        );
      }
    } catch {
      setNotice(
        "The response is unknown. Retry the saved commitment request to recover its acceptance.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-2 min-w-0 space-y-2">
      <p className="text-sm">
        Paid commitment: {record.paymentReactionRecovery?.state.replaceAll("_", " ")} · Attempts in
        this window: {record.paymentReactionRecovery?.attempts}
      </p>
      {record.paymentReactionRecovery?.unavailableReason ? (
        <p className="text-sm">{record.paymentReactionRecovery.unavailableReason}</p>
      ) : null}
      {record.paymentReactionRecovery?.canRetry || saved ? (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Commitment retry reason"
            maxLength={500}
            value={reason}
            disabled={pending || saved !== null}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for checking again"
            className="min-w-0 max-w-sm"
          />
          <Button
            variant="outline"
            disabled={pending || (!saved && !reason.trim())}
            onClick={() => void submit()}
          >
            {pending
              ? "Queuing check…"
              : saved
                ? "Retry saved commitment request"
                : "Retry paid commitment"}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
