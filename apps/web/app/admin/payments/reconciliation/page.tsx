"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AdminReconciliationCaseView, AdminReconciliationPage } from "@freshmarkets/contracts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert";
import { Button } from "../../../../components/ui/button";
import { Skeleton } from "../../../../components/ui/skeleton";
import { ListPageSection, PageHeader, StatusBadge } from "../../../../components/admin/admin-shell";
import {
  AdminCursorPagination,
  ConfirmCommandDialog,
  useAdminPagination,
} from "../../../../components/admin/admin-controls";
import { PaymentNavigation } from "../../../../components/admin/payment-navigation";
import {
  reconciliationPageResponse,
  reconciliationResolutionResponse,
} from "../../../../lib/reconciliation-response";

type SavedResolution = { caseId: string; body: string; key: string };
export default function PaymentReconciliationPage() {
  const [page, setPage] = useState<AdminReconciliationPage | null>(null);
  const [selected, setSelected] = useState<AdminReconciliationCaseView | null>(null);
  const [saved, setSaved] = useState<SavedResolution | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pagination = useAdminPagination();
  const load = useCallback(async (cursor: string | null) => {
    try {
      const parsed = reconciliationPageResponse.safeParse(
        await (
          await fetch(
            `/api/admin/payments/reconciliation?status=OPEN&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
        ).json(),
      );
      if (!parsed.success) throw new Error("Invalid review response");
      if (!parsed.data.ok) return setNotice(parsed.data.error.message);
      setPage(parsed.data.value);
    } catch {
      setNotice("Reconciliation cases could not be loaded. Refresh to retry.");
    }
  }, []);
  useEffect(() => {
    void load(pagination.cursor);
  }, [load, pagination.cursor]);
  async function resolve(intent: SavedResolution) {
    setSaved(intent);
    setPending(true);
    try {
      const parsed = reconciliationResolutionResponse.safeParse(
        await (
          await fetch(
            `/api/admin/payments/reconciliation/${encodeURIComponent(intent.caseId)}/resolve`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": intent.key },
              body: intent.body,
            },
          )
        ).json(),
      );
      if (!parsed.success) throw new Error("Unknown resolution response");
      if (parsed.data.ok && parsed.data.value.caseId !== intent.caseId)
        throw new Error("Mismatched resolution");
      setSaved(null);
      setNotice(parsed.data.ok ? "Reconciliation case resolved." : parsed.data.error.message);
      await load(pagination.cursor);
    } catch {
      setNotice("The response is unknown. Retry the saved resolution to recover its result.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <PageHeader
        title="Payment reconciliation"
        description="Review completed financial recovery before closing an exception."
      />
      <PaymentNavigation />
      {notice ? (
        <Alert>
          <AlertTitle>Reconciliation status</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {saved && !pending ? (
        <Button onClick={() => void resolve(saved)}>Retry saved resolution</Button>
      ) : null}
      <Button variant="outline" disabled={pending} onClick={() => void load(pagination.cursor)}>
        Refresh cases
      </Button>
      {!page ? (
        <div role="status">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <ListPageSection title="Open cases">
          {page.items.length === 0 ? (
            <p className="p-4 text-sm text-[var(--fm-text-muted)]">No open reconciliation cases.</p>
          ) : (
            <ul className="divide-y">
              {page.items.map((item) => (
                <li key={item.caseId} className="min-w-0 space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {item.category.replaceAll("_", " ")}
                    </span>
                    <StatusBadge>{item.status}</StatusBadge>
                  </div>
                  <p className="text-xs text-[var(--fm-text-muted)]">
                    Opened {item.createdAt.slice(0, 10)}
                  </p>
                  {item.resolutionUnavailableReason ? (
                    <p className="text-sm">{item.resolutionUnavailableReason}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    {item.paymentIntentId ? (
                      <Link
                        className="text-sm underline"
                        href={`/admin/payments/transactions/${encodeURIComponent(item.paymentIntentId)}`}
                        prefetch={false}
                      >
                        Review payment
                      </Link>
                    ) : (
                      <span className="text-sm">Payment evidence is not linked.</span>
                    )}
                    <Button
                      size="sm"
                      disabled={
                        pending || saved !== null || item.resolutionUnavailableReason !== null
                      }
                      onClick={() => setSelected(item)}
                    >
                      Review resolution
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <AdminCursorPagination
            pageNumber={pagination.pageNumber}
            nextCursor={page.nextCursor}
            onPrevious={pagination.previous}
            onNext={pagination.next}
          />
        </ListPageSection>
      )}
      <ConfirmCommandDialog
        open={selected !== null}
        title="Resolve reconciliation case?"
        resource={selected?.category.replaceAll("_", " ") ?? "Financial exception"}
        scope="Global financial review"
        consequence="Core verifies completed financial recovery and records your resolution with an immutable audit event."
        confirmLabel="Confirm resolution"
        pending={pending}
        onCancel={() => setSelected(null)}
        onConfirm={(reason) => {
          const item = selected;
          setSelected(null);
          if (item)
            void resolve({
              caseId: item.caseId,
              key: crypto.randomUUID(),
              body: JSON.stringify({ expectedVersion: item.version, reason: reason.trim() }),
            });
        }}
      />
    </div>
  );
}
