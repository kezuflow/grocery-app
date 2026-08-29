"use client";

import type {
  AdminCategoryPage,
  AdminProductDetail,
  AdminProductSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdminCommandIntent } from "@/components/admin/admin-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { ProductForm, type ProductFormValue } from "@/components/admin/product-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditProductPage() {
  const productId = useParams<{ "product-id": string }>()?.["product-id"];
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = useAdminCommandIntent();
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [categories, setCategories] = useState<AdminCategoryPage["items"]>([]);
  const [value, setValue] = useState<ProductFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!productId) return;
    void Promise.all([
      fetch(`/api/admin/catalog/products/${productId}`).then(
        (r) => r.json() as Promise<RpcResult<AdminProductDetail>>,
      ),
      fetch("/api/admin/catalog/categories").then(
        (r) => r.json() as Promise<RpcResult<AdminCategoryPage>>,
      ),
    ]).then(([product, categoryResult]) => {
      if (!product.ok) {
        setError(`${product.error.message} Request reference: ${product.error.requestId}`);
        return;
      }
      setDetail(product.value);
      setValue({
        name: product.value.name,
        slug: product.value.slug,
        description: product.value.description,
        categoryId: product.value.categoryId,
        customerDetails: product.value.customerDetails.map(
          ({ label, value: detailValue, sortOrder }) => ({ label, value: detailValue, sortOrder }),
        ),
      });
      if (categoryResult.ok) setCategories(categoryResult.value.items);
    });
  }, [productId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!detail || !value) return;
    setError(null);
    try {
      const result = await intent.submit(
        async (idempotencyKey) =>
          (
            await fetch(`/api/admin/catalog/products/${productId}`, {
              method: "PATCH",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify({ ...value, expectedVersion: detail.version }),
            })
          ).json() as Promise<RpcResult<AdminProductSummary>>,
      );
      if (!result.ok) {
        setError(
          result.error.code === "STALE_VERSION"
            ? "Product changed. Refresh before retrying."
            : `${result.error.message} Request reference: ${result.error.requestId}`,
        );
        return;
      }
      const from = searchParams.get("from");
      router.push(
        `/admin/catalog/products/${productId}?updated=1${from ? `&from=${encodeURIComponent(from)}` : ""}`,
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
  if (!detail || !value) return <Skeleton className="h-80 w-full" />;
  const from = searchParams.get("from");
  return (
    <div className="space-y-6">
      <nav className="text-sm text-[var(--fm-text-muted)]">
        <Link className="underline" href={`/admin/catalog/products${from ? `?${from}` : ""}`}>
          Products
        </Link>{" "}
        /{" "}
        <Link
          className="underline"
          href={`/admin/catalog/products/${productId}${from ? `?from=${encodeURIComponent(from)}` : ""}`}
        >
          {detail.name}
        </Link>{" "}
        / Edit
      </nav>
      <PageHeader
        title="Edit product"
        description="Identity and customer details are version-guarded and audited; variants remain separate commands."
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <section className="max-w-3xl rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6">
        <ProductForm
          value={value}
          categories={categories}
          pending={intent.pending}
          submitLabel="Save product"
          onChange={setValue}
          onSubmit={submit}
        />
      </section>
    </div>
  );
}
