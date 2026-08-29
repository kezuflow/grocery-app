"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminPaymentDetail, RpcResult } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import { AdminConfirmationDialog } from "../../../../components/admin/admin-controls";
import { useAdminCommandIntent } from "../../../../components/admin/admin-command-state";
import { PaymentNavigation } from "../../../../components/admin/payment-navigation";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

export default function PaymentDetailPage({
  params,
}: {
  params: Promise<{ "payment-intent-id": string }>;
}) {
  const [paymentId, setPaymentId] = useState("");
  const [payment, setPayment] = useState<AdminPaymentDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const command = useAdminCommandIntent();
  const load = useCallback(async (id: string) => {
    setLoadError(null);
    try {
      const payload = (await (
        await fetch(`/api/admin/payments/${encodeURIComponent(id)}`)
      ).json()) as RpcResult<AdminPaymentDetail>;
      if (!payload.ok) return setLoadError(payload.error.message);
      setPayment(payload.value);
    } catch {
      setLoadError("Network error loading this payment.");
    }
  }, []);
  useEffect(() => {
    void params.then(({ "payment-intent-id": id }) => {
      setPaymentId(id);
      void load(id);
    });
  }, [load, params]);
  async function refund(reason: string) {
    if (!payment) return;
    const amountMinor = Math.round(Number(amount) * 100);
    if (
      !Number.isInteger(amountMinor) ||
      amountMinor <= 0 ||
      amountMinor > payment.remainingRefundableMinor
    ) {
      setNotice("Enter a positive refund amount no greater than the refundable balance.");
      return;
    }
    try {
      const result = await command.submit(
        async (idempotencyKey) =>
          (await (
            await fetch("/api/admin/payments/refunds", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify({
                paymentIntentId: payment.paymentIntentId,
                amountMinor,
                reason,
              }),
            })
          ).json()) as RpcResult<unknown>,
      );
      setNotice(
        result.ok
          ? "Refund request recorded; provider confirmation remains authoritative."
          : result.error.message,
      );
      if (result.ok) {
        setConfirming(false);
        setAmount("");
        await load(paymentId);
      }
    } catch {
      setNotice("Connection lost. Retry confirmation to safely reuse the refund request.");
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <Link className="text-sm underline" href="/admin/payments/transactions">
        ← Transactions
      </Link>
      <PaymentNavigation />
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Payment could not be loaded</AlertTitle>
          <AlertDescription>
            {loadError}
            <br />
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => void load(paymentId)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!payment && !loadError ? (
        <div role="status">
          <Skeleton className="h-36 w-full" />
        </div>
      ) : null}
      {payment ? (
        <>
          <PageHeader
            title={`Payment ${payment.paymentIntentId}`}
            description={`${payment.customerEmail} · ${payment.purpose}`}
            action={<StatusBadge>{payment.status}</StatusBadge>}
          />
          {notice ? (
            <Alert>
              <AlertTitle>Payment status</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          {payment.reconciliationCases.some((item) => item.status === "OPEN") ? (
            <Alert variant="destructive">
              <AlertTitle>Reconciliation required</AlertTitle>
              <AlertDescription>
                This payment has an open reconciliation case. Review provider evidence before
                resolution.
              </AlertDescription>
            </Alert>
          ) : null}
          <ListPageSection title="Summary">
            <dl className="grid gap-4 p-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[var(--fm-text-muted)]">Amount</dt>
                <dd className="font-semibold">{money(payment.amountMinor, payment.currency)}</dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Refunded</dt>
                <dd>{money(payment.refundedMinor, payment.currency)}</dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Refundable</dt>
                <dd>{money(payment.remainingRefundableMinor, payment.currency)}</dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Subject</dt>
                <dd>
                  {payment.subjectType} · {payment.subjectId}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Version</dt>
                <dd>{payment.version}</dd>
              </div>
              <div>
                <dt className="text-[var(--fm-text-muted)]">Updated</dt>
                <dd>{payment.updatedAt.slice(0, 19)}</dd>
              </div>
            </dl>
          </ListPageSection>
          <ListPageSection title="Attempts">
            {payment.attempts.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No provider attempts.</p>
            ) : (
              <ul className="divide-y text-sm">
                {payment.attempts.map((attempt) => (
                  <li className="flex justify-between gap-3 p-4" key={attempt.attemptId}>
                    <span>
                      {attempt.provider} · {money(attempt.amountMinor, attempt.currency)}
                    </span>
                    <StatusBadge>{attempt.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
          <ListPageSection title="Refund history">
            {payment.refunds.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No refunds.</p>
            ) : (
              <ul className="divide-y text-sm">
                {payment.refunds.map((item) => (
                  <li className="flex justify-between gap-3 p-4" key={item.refundId}>
                    <span>
                      {money(item.amountMinor, item.currency)}
                      {item.reason ? ` · ${item.reason}` : ""}
                    </span>
                    <StatusBadge>{item.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
          <div className="grid gap-6 lg:grid-cols-2">
            <ListPageSection title="Provider event history">
              {payment.events.length === 0 ? (
                <p className="p-4 text-sm text-[var(--fm-text-muted)]">
                  No linked provider events.
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {payment.events.map((event) => (
                    <li className="p-4" key={event.eventId}>
                      <div className="flex justify-between">
                        <span>
                          {event.provider} · {event.eventType}
                        </span>
                        <StatusBadge>{event.processingStatus}</StatusBadge>
                      </div>
                      <time className="text-xs text-[var(--fm-text-muted)]">
                        {event.receivedAt.slice(0, 19)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </ListPageSection>
            <ListPageSection title="Downstream reactions">
              {payment.reactions.length === 0 ? (
                <p className="p-4 text-sm text-[var(--fm-text-muted)]">No downstream reactions.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {payment.reactions.map((reaction) => (
                    <li className="p-4" key={reaction.reactionId}>
                      <div className="flex justify-between">
                        <span>{reaction.reactionType}</span>
                        <StatusBadge>{reaction.status}</StatusBadge>
                      </div>
                      <p className="text-xs text-[var(--fm-text-muted)]">
                        {reaction.subjectType} · attempts {reaction.attempts}
                        {reaction.lastErrorCode ? ` · ${reaction.lastErrorCode}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </ListPageSection>
          </div>
          <ListPageSection title="Reconciliation cases">
            {payment.reconciliationCases.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No reconciliation cases.</p>
            ) : (
              <ul className="divide-y text-sm">
                {payment.reconciliationCases.map((item) => (
                  <li className="flex justify-between gap-3 p-4" key={item.caseId}>
                    <span>{item.category}</span>
                    <StatusBadge>{item.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
          {payment.allowedActions.includes("REQUEST_REFUND") ? (
            <ListPageSection
              title="Request refund"
              description="Creates a provider-backed REQUESTED refund; it does not assert financial success."
            >
              <div className="flex flex-wrap gap-2 p-4">
                <Input
                  className="max-w-56"
                  aria-label="Refund amount"
                  inputMode="decimal"
                  placeholder={`up to ${money(payment.remainingRefundableMinor, payment.currency)}`}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <Button
                  variant="destructive"
                  disabled={command.pending}
                  onClick={() => setConfirming(true)}
                >
                  Request refund
                </Button>
              </div>
            </ListPageSection>
          ) : null}
          <AdminConfirmationDialog
            open={confirming}
            title="Confirm refund request"
            resource={`Payment ${payment.paymentIntentId} · ${payment.currency} ${amount || "0"}`}
            scope="Core-authorized global payment scope"
            consequence="This creates a financial refund request. Provider confirmation determines the canonical outcome."
            pending={command.pending}
            onCancel={() => setConfirming(false)}
            onConfirm={(reason) => void refund(reason)}
          />
          <ListPageSection title="Recent audit">
            {payment.recentAudit.length === 0 ? (
              <p className="p-4 text-sm text-[var(--fm-text-muted)]">No admin audit events.</p>
            ) : (
              <ul className="divide-y text-sm">
                {payment.recentAudit.map((event) => (
                  <li className="p-4" key={event.auditEventId}>
                    {event.action} · {event.occurredAt.slice(0, 19)}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </ListPageSection>
        </>
      ) : null}
    </div>
  );
}
