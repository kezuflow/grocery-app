"use client";
import { adminProductSummarySchema, adminProductDetailSchema } from "@freshmarkets/validation";
import { Button } from "@/components/ui/button";

import type { AdminProductDetail } from "@freshmarkets/contracts";
import { useCategoryOptions } from "@/components/admin/category-authoring-state";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCatalogCommand, catalogResultSchema } from "@/components/admin/catalog-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { ProductForm, type ProductFormValue } from "@/components/admin/product-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminContext } from "../../../../admin-context-provider";

export default function EditProductPage() {
  const productId = useParams<{ "product-id": string }>()?.["product-id"];
  const router = useRouter();
  const searchParams = useSearchParams();
  const intent = useCatalogCommand(adminProductSummarySchema);
  const adminContext = useAdminContext();
  const selectedScope =
    adminContext.state.phase === "ready" ? adminContext.state.selectedScope : null;
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const categories = useCategoryOptions();
  const [value, setValue] = useState<ProductFormValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!productId || (selectedScope?.kind !== "GLOBAL" && selectedScope?.kind !== "LOCATION"))
      return;
    const scopeParams = new URLSearchParams(
      selectedScope.kind === "LOCATION"
        ? {
            scopeKind: "LOCATION",
            marketId: selectedScope.marketId,
            locationId: selectedScope.locationId,
          }
        : { scopeKind: "GLOBAL" },
    );
    let current = true;
    setError(null);
    setDetail(null);
    setValue(null);
    void fetch(`/api/admin/catalog/products/${productId}?${scopeParams}`)
      .then(async (r) => catalogResultSchema(adminProductDetailSchema).parse(await r.json()))
      .then((product) => {
        if (!current) return;
        if (!product.ok) {
          setError(`${product.error.message} Request reference: ${product.error.requestId}`);
          return;
        }
        if (
          !product.value.allowedActions.includes("UPDATE") ||
          product.value.scope.kind !== "GLOBAL"
        ) {
          setError("Global catalog management is required to edit this product.");
          return;
        }
        setDetail(product.value);
        setValue({
          name: product.value.name,
          slug: product.value.slug,
          description: product.value.description,
          categoryId: product.value.categoryId,
          customerDetails: product.value.customerDetails.map(
            ({ label, value: detailValue, sortOrder }) => ({
              label,
              value: detailValue,
              sortOrder,
            }),
          ),
        });
      })
      .catch(() => {
        if (current) setError("Product could not be loaded. Refresh to retry.");
      });
    return () => {
      current = false;
    };
  }, [productId, selectedScope]);
  async function save(retry = false) {
    if (!retry && (!detail || !value)) return;
    setError(null);
    try {
      const result = retry
        ? await intent.retry()
        : detail && value
          ? await intent.submit(
              `/api/admin/catalog/products/${productId}`,
              { ...value, expectedVersion: detail.version },
              "PATCH",
            )
          : null;
      if (!result) return;
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
        `/admin/catalog/products/${result.value.productId}?updated=1${from ? `&from=${encodeURIComponent(from)}` : ""}`,
      );
    } catch {
      setError("Connection lost. Retry to safely reuse this request.");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await save();
  }
  if (intent.uncertain && !value)
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            {error ?? "The previous response was lost. Recover the saved product request."}
          </AlertDescription>
        </Alert>
        <Button disabled={intent.pending} onClick={() => void save(true)}>
          Retry saved product
        </Button>
      </div>
    );
  if (error && !value)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (!detail || !value) return <Skeleton className="h-80 w-full" />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit product"
        description="Identity and customer details are version-guarded and audited; variants remain separate commands."
      />
      {error || categories.error ? (
        <Alert variant="destructive">
          <AlertDescription>{error ?? categories.error}</AlertDescription>
        </Alert>
      ) : null}
      <section className="max-w-3xl rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6">
        <fieldset disabled={intent.pending || intent.uncertain}>
          <ProductForm
            value={value}
            categories={categories.items}
            currentCategoryName={detail.categoryName}
            pending={intent.pending}
            submitLabel="Save product"
            onChange={setValue}
            onSubmit={submit}
          />
        </fieldset>
        {intent.uncertain ? (
          <Button disabled={intent.pending} onClick={() => void save(true)}>
            Retry saved product
          </Button>
        ) : null}
        {categories.hasMore || categories.error ? (
          <Button disabled={categories.loading} onClick={() => void categories.loadMore()}>
            {categories.error ? "Retry categories" : "More categories"}
          </Button>
        ) : null}
      </section>
    </div>
  );
}
