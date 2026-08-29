"use client";

import type {
  AdminCategoryDetail,
  AdminCategoryPage,
  AdminCategorySummary,
  RpcResult,
} from "@freshmarkets/contracts";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CategoryForm, type CategoryFormValue } from "@/components/admin/category-form";
import { useAdminCommandIntent } from "@/components/admin/admin-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditCategoryPage() {
  const categoryId = useParams<{ "category-id": string }>()?.["category-id"];
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = useAdminCommandIntent();
  const [detail, setDetail] = useState<AdminCategoryDetail | null>(null);
  const [parents, setParents] = useState<AdminCategorySummary[]>([]);
  const [value, setValue] = useState<CategoryFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!categoryId) return;
    void Promise.all([
      fetch(`/api/admin/catalog/categories/${categoryId}`).then(
        (r) => r.json() as Promise<RpcResult<AdminCategoryDetail>>,
      ),
      fetch("/api/admin/catalog/categories").then(
        (r) => r.json() as Promise<RpcResult<AdminCategoryPage>>,
      ),
    ]).then(([category, list]) => {
      if (!category.ok) {
        setError(`${category.error.message} Request reference: ${category.error.requestId}`);
        return;
      }
      setDetail(category.value);
      setValue({
        name: category.value.name,
        slug: category.value.slug,
        parentCategoryId: category.value.parent?.categoryId ?? null,
        iconAssetKey: category.value.iconAssetKey,
        sortOrder: category.value.sortOrder,
      });
      if (list.ok) setParents(list.value.items.filter((item) => item.categoryId !== categoryId));
    });
  }, [categoryId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!value || !detail) return;
    setError(null);
    try {
      const result = await intent.submit(
        async (idempotencyKey) =>
          (
            await fetch(`/api/admin/catalog/categories/${categoryId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify({ ...value, expectedVersion: detail.version }),
            })
          ).json() as Promise<RpcResult<AdminCategorySummary>>,
      );
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
      <nav className="text-sm text-[var(--fm-text-muted)]">
        <Link
          className="underline"
          href={`/admin/catalog/categories${searchParams.get("from") ? `?${searchParams.get("from")}` : ""}`}
        >
          Categories
        </Link>{" "}
        /{" "}
        <Link
          className="underline"
          href={`/admin/catalog/categories/${categoryId}${searchParams.get("from") ? `?from=${encodeURIComponent(searchParams.get("from")!)}` : ""}`}
        >
          {detail.name}
        </Link>{" "}
        / Edit
      </nav>
      <PageHeader
        title="Edit category"
        description="Identity and hierarchy changes are version-guarded and audited."
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <section className="max-w-2xl rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6">
        <CategoryForm
          value={value}
          categories={parents}
          pending={intent.pending}
          submitLabel="Save category"
          onChange={setValue}
          onSubmit={submit}
        />
      </section>
    </div>
  );
}
