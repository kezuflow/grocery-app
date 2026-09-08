"use client";
import { adminCategorySummarySchema } from "@freshmarkets/validation";

import type { AdminCategoryDetail } from "@freshmarkets/contracts";
import {
  categoryDetailResultSchema,
  useCategoryOptions,
} from "@/components/admin/category-authoring-state";
import { Button } from "@/components/ui/button";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CategoryForm, type CategoryFormValue } from "@/components/admin/category-form";
import { useCatalogCommand } from "@/components/admin/catalog-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditCategoryPage() {
  const categoryId = useParams<{ "category-id": string }>()?.["category-id"];
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = useCatalogCommand(adminCategorySummarySchema);
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const parents = useCategoryOptions(categoryId);
  const [value, setValue] = useState<CategoryFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!categoryId) return;
    let current = true;
    setDetail(null);
    setValue(null);
    setError(null);
    void fetch(`/api/admin/catalog/categories/${encodeURIComponent(categoryId)}`)
      .then(async (response) => categoryDetailResultSchema.parse(await response.json()))
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setDetail(result.value);
        setValue({
          name: result.value.name,
          slug: result.value.slug,
          parentCategoryId: result.value.parent?.categoryId ?? null,
          iconAssetKey: result.value.iconAssetKey,
          sortOrder: result.value.sortOrder,
        });
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
      <section className="max-w-2xl rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6">
        <CategoryForm
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
    </div>
  );
}
