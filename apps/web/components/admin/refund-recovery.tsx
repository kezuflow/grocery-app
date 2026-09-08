"use client";
import { useState } from "react";
import type { AdminRefundProgress } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
const response = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.object({
      refundId: z.string(),
      state: z.literal("QUEUED"),
      version: z.number().int().safe().positive(),
      acceptedAt: z.string().datetime(),
    }),
  }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);
export function RefundRecovery({
  refund,
  onAccepted,
}: {
  refund: AdminRefundProgress;
  onAccepted: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<{ body: string; key: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  async function submit() {
    const intent = saved ?? {
      body: JSON.stringify({
        refundId: refund.refundId,
        expectedVersion: refund.version,
        reason: reason.trim(),
      }),
      key: crypto.randomUUID(),
    };
    setSaved(intent);
    setPending(true);
    try {
      const result = response.safeParse(
        await (
          await fetch("/api/admin/payments/refunds/recheck", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": intent.key },
            body: intent.body,
          })
        ).json(),
      );
      if (!result.success) throw new Error("Unknown acceptance");
      if (result.data.ok && result.data.value.refundId !== refund.refundId)
        throw new Error("Mismatched acceptance");
      setSaved(null);
      setNotice(
        result.data.ok
          ? "Provider check queued. Refresh for current progress."
          : result.data.error.message,
      );
      await onAccepted();
    } catch {
      setNotice("The response is unknown. Retry the saved check to recover its acceptance.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-2 min-w-0 space-y-2">
      <p className="text-xs text-[var(--fm-text-muted)]">
        Provider checks: {refund.recovery.attempts}
        {refund.recovery.nextCheckAt
          ? ` · Next check ${refund.recovery.nextCheckAt.slice(0, 19)}`
          : ""}
        {refund.recovery.lastErrorCode
          ? ` · ${refund.recovery.lastErrorCode.replaceAll("_", " ").toLowerCase()}`
          : ""}
      </p>
      {refund.recovery.canRecheck || saved ? (
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="Provider check reason"
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
                ? "Retry saved provider check"
                : "Check provider status"}
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
