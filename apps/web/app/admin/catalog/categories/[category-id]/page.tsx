"use client";

import type { AdminCategoryDetail, AdminCategorySummary, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminCommandIntent } from "@/components/admin/admin-command-state";
import { ConfirmCommandDialog } from "@/components/admin/admin-controls";
import { ListPageSection, PageHeader, StatusBadge } from "@/components/admin/admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export default function CategoryDetailPage() {
  const categoryId = useParams<{ "category-id": string }>()?.["category-id"];
  const searchParams = useSearchParams();
  const intent = useAdminCommandIntent();
  const [result, setResult] = useState<RpcResult<AdminCategoryDetail> | null>(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState(
    searchParams.get("created")
      ? "Category created."
      : searchParams.get("updated")
        ? "Category updated."
        : "",
  );
  const load = useCallback(() => {
    if (categoryId)
      void fetch(`/api/admin/catalog/categories/${categoryId}`)
        .then((r) => r.json() as Promise<RpcResult<AdminCategoryDetail>>)
        .then(setResult)
        .catch(() =>
          setResult({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Network error loading Category",
              requestId: "unavailable",
            },
          }),
        );
  }, [categoryId]);
  useEffect(load, [load]);
  async function changeStatus(confirmedReason: string) {
    if (!result?.ok || !confirmedReason.trim()) {
      setNotice("A reason is required.");
      return;
    }
    setConfirming(false);
    const status = result.value.status === "active" ? "inactive" : "active";
    try {
      const response = await intent.submit(
        async (idempotencyKey) =>
          (
            await fetch(`/api/admin/catalog/categories/${categoryId}/status`, {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify({
                status,
                reason: confirmedReason,
                expectedVersion: result.value.version,
              }),
            })
          ).json() as Promise<RpcResult<AdminCategorySummary>>,
      );
      if (!response.ok) {
        setNotice(
          response.error.code === "STALE_VERSION"
            ? "Category changed. Refresh before retrying."
            : `${response.error.message} Request reference: ${response.error.requestId}`,
        );
        return;
      }
      setNotice(`Category ${status === "active" ? "activated" : "deactivated"}.`);
      setReason("");
      load();
    } catch {
      setNotice("Connection lost. Retry to safely reuse this request.");
    }
  }
  if (!result) return <Skeleton className="h-80 w-full" />;
  if (!result.ok)
    return (
      <Alert variant="destructive">
        <AlertTitle>Category could not be loaded</AlertTitle>
        <AlertDescription>
          {result.error.message}
          <br />
          <span className="font-mono text-xs">Request reference: {result.error.requestId}</span>
        </AlertDescription>
      </Alert>
    );
  const category = result.value;
  const from = searchParams.get("from");
  return (
    <div className="space-y-6">
      <PageHeader
        title={category.name}
        description={`${category.code} · Version ${category.version}`}
        action={
          category.allowedActions.includes("UPDATE") ? (
            <Button asChild variant="outline">
              <Link
                href={`/admin/catalog/categories/${category.categoryId}/edit${from ? `?from=${encodeURIComponent(from)}` : ""}`}
              >
                Edit category
              </Link>
            </Button>
          ) : null
        }
      />
      {notice ? (
        <p
          role="status"
          className="rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white p-3 text-sm"
        >
          {notice}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5 lg:col-span-2">
          <h2 className="font-semibold">Category details</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--fm-text-muted)]">Status</dt>
              <dd>
                <StatusBadge tone={category.status === "active" ? "success" : "neutral"}>
                  {category.status}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--fm-text-muted)]">Parent</dt>
              <dd>{category.parent?.name ?? "Top level"}</dd>
            </div>
            <div>
              <dt className="text-[var(--fm-text-muted)]">Slug</dt>
              <dd>{category.slug}</dd>
            </div>
            <div>
              <dt className="text-[var(--fm-text-muted)]">Icon</dt>
              <dd>{category.iconAssetKey ?? "None"}</dd>
            </div>
          </dl>
        </section>
        {category.allowedActions.includes("SET_STATUS") ? (
          <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-5">
            <h2 className="font-semibold">Lifecycle</h2>
            <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
              {category.status === "active"
                ? "Deactivation keeps history and products intact."
                : "Activation restores this category to the active hierarchy."}
            </p>
            <Input
              className="mt-4"
              aria-label="Status change reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason required"
            />
            <Button
              ref={statusTrigger}
              className="mt-3"
              variant={category.status === "active" ? "destructive" : "default"}
              disabled={intent.pending}
              onClick={() => {
                if (!reason.trim()) setNotice("A reason is required.");
                else setConfirming(true);
              }}
            >
              {category.status === "active" ? "Review deactivation" : "Review activation"}
            </Button>
          </section>
        ) : null}
      </div>
      <ListPageSection title="Child categories">
        {category.children.length ? (
          <ul className="divide-y divide-[var(--fm-border)]">
            {category.children.map((child) => (
              <li key={child.categoryId} className="p-4">
                <Link
                  className="font-medium underline"
                  href={`/admin/catalog/categories/${child.categoryId}`}
                  prefetch={false}
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No child categories.</p>
        )}
      </ListPageSection>
      <ListPageSection title="Contained products">
        {category.products.length ? (
          <ul className="divide-y divide-[var(--fm-border)]">
            {category.products.map((product) => (
              <li key={product.productId} className="p-4">
                <Link
                  className="font-medium underline"
                  href={`/admin/catalog/products/${product.productId}`}
                  prefetch={false}
                >
                  {product.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">
            No products are assigned directly to this category.
          </p>
        )}
      </ListPageSection>
      <ListPageSection title="Recent audit">
        {category.recentAudit.length ? (
          <ol className="divide-y divide-[var(--fm-border)]">
            {category.recentAudit.map((audit) => (
              <li key={audit.auditEventId} className="p-4 text-sm">
                <span className="font-medium">{audit.action}</span>
                <span className="block text-[var(--fm-text-muted)]">
                  {new Date(audit.occurredAt).toLocaleString()} ·{" "}
                  {audit.correlationId ?? "No request reference"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="p-5 text-sm text-[var(--fm-text-muted)]">No audit events recorded.</p>
        )}
      </ListPageSection>
      <ConfirmCommandDialog
        open={confirming}
        title={category.status === "active" ? "Deactivate category?" : "Activate category?"}
        resource={`${category.name} · version ${category.version}`}
        scope="Global Catalog"
        consequence={
          category.status === "active"
            ? "Products and historical records remain intact. This category becomes inactive until explicitly reactivated."
            : "This category becomes active in the global Catalog hierarchy. Products retain their own lifecycle state."
        }
        initialReason={reason}
        confirmLabel={category.status === "active" ? "Confirm deactivation" : "Confirm activation"}
        cancelLabel="Cancel"
        pending={intent.pending}
        restoreFocusRef={statusTrigger}
        onCancel={() => setConfirming(false)}
        onConfirm={(confirmedReason) => void changeStatus(confirmedReason)}
      />
    </div>
  );
}
