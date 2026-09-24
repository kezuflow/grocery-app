"use client";
import { adminCategorySummarySchema } from "@freshmarkets/validation";

import type { AdminCategoryDetail } from "@freshmarkets/contracts";
import {
  categoryDetailResultSchema,
  useCategoryOptions,
} from "@/components/admin/category-authoring-state";
import { Button } from "@/components/ui/button";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CategoryForm, type CategoryFormValue } from "@/components/admin/category-form";
import { useCatalogCommand } from "@/components/admin/catalog-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminContext, useAdminScopeGuard } from "../../../../admin-context-provider";

export default function EditCategoryPage() {
  const categoryId = useParams<{ "category-id": string }>()?.["category-id"];
  const router = useRouter();
  const searchParams = useSearchParams();
  const admin = useAdminContext();
  const intent = useCatalogCommand(adminCategorySummarySchema);
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const parents = useCategoryOptions(categoryId);
  const [value, setValue] = useState<CategoryFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialSnapshot = useRef<string | null>(null);
  const dirty =
    value !== null &&
    initialSnapshot.current !== null &&
    JSON.stringify(value) !== initialSnapshot.current;
  const locked = intent.pending || intent.uncertain;
  useAdminScopeGuard(dirty, locked, () => {
    if (initialSnapshot.current) setValue(JSON.parse(initialSnapshot.current) as CategoryFormValue);
  });
  useEffect(() => {
    if (!categoryId) return;
    let current = true;
    setDetail(null);
    setValue(null);
    setError(null);
    initialSnapshot.current = null;
    void fetch(`/api/admin/catalog/categories/${encodeURIComponent(categoryId)}`)
      .then(async (response) => categoryDetailResultSchema.parse(await response.json()))
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setDetail(result.value);
        const loadedValue: CategoryFormValue = {
          name: result.value.name,
          slug: result.value.slug,
          parentCategoryId: result.value.parent?.categoryId ?? null,
          iconAssetKey: result.value.iconAssetKey,
          sortOrder: result.value.sortOrder,
        };
        initialSnapshot.current = JSON.stringify(loadedValue);
        setValue(loadedValue);
      })
      .catch(() => {
        if (current) setError("Category could not be loaded. Refresh to retry.");
      });
    return () => {
      current = false;
    };
  }, [categoryId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || !detail) return;
    setError(null);
    try {
      const result = await intent.submit(
        `/api/admin/catalog/categories/${categoryId}`,
        { ...value, expectedVersion: detail.version },
        "PATCH",
        { title: "Category saved" },
      );
      if (!result) return;
      if (!result.ok) {
        setError(
          result.error.code === "STALE_VERSION"
            ? "Category changed. Refresh before retrying."
            : `${result.error.message} Request reference: ${result.error.requestId}`,
        );
        return;
      }
      const from = searchParams.get("from");
      router.push(
        `/admin/catalog/categories/${categoryId}?updated=1${from ? `&from=${encodeURIComponent(from)}` : ""}`,
      );
    } catch {
      setError("Connection lost. Retry to safely reuse this request.");
    }
  }
  if (error && !value)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!value || !detail) return <Skeleton className="h-80 w-full" />;
  if (admin.state.phase !== "ready") return <p role="status">Loading Admin access…</p>;
  if (admin.state.selectedScope?.kind !== "GLOBAL")
    return (
      <Alert variant="warning">
        <AlertDescription>Select Global scope to edit a category.</AlertDescription>
      </Alert>
    );
  if (!detail.allowedActions.includes("UPDATE"))
    return (
      <Alert variant="destructive">
        <AlertDescription>Catalog management is required to edit this category.</AlertDescription>
      </Alert>
    );
  const from = searchParams.get("from");
  const detailHref = `/admin/catalog/categories/${categoryId}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit category"
        description="Identity and hierarchy changes are version-guarded and audited."
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {parents.error ? <p role="alert">{parents.error}</p> : null}
      {parents.loading ? <p role="status">Loading parent categories…</p> : null}
      {parents.hasMore || parents.error ? (
        <Button
          type="button"
          variant="outline"
          disabled={parents.loading}
          onClick={() => void parents.loadMore()}
        >
          {parents.error ? "Retry parent categories" : "More parent categories"}
        </Button>
      ) : null}
      {dirty ? (
        <p role="status" className="text-sm text-[var(--fm-text-muted)]">
          Unsaved changes
        </p>
      ) : null}
      <section className="max-w-2xl rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-6">
        <CategoryForm
          formId="edit-category-form"
          hideSubmit
          value={value}
          categories={
            detail.parent &&
            !parents.items.some((item) => item.categoryId === detail.parent?.categoryId)
              ? [detail.parent, ...parents.items]
              : parents.items
          }
          pending={intent.pending}
          locked={intent.uncertain}
          submitLabel={intent.uncertain ? "Retry saved category" : "Save category"}
          onChange={setValue}
          onSubmit={submit}
        />
      </section>
      <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-[var(--fm-border)] bg-[var(--fm-admin-content)]/95 px-4 py-4 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          disabled={locked}
          onClick={() => {
            if (dirty && !window.confirm("Discard this unsaved category?")) return;
            router.push(detailHref);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" form="edit-category-form" disabled={intent.pending}>
          {intent.pending ? "Saving…" : intent.uncertain ? "Retry saved category" : "Save category"}
        </Button>
      </div>
    </div>
  );
}
