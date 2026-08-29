"use client";

import type {
  AdminCategoryPage,
  AdminProductSummary,
  AdminUnitSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdminCommandIntent } from "@/components/admin/admin-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { ProductForm, type ProductFormValue } from "@/components/admin/product-form";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function NewProductPage() {
  const router = useRouter();
  const intent = useAdminCommandIntent();
  const [categories, setCategories] = useState<AdminCategoryPage["items"]>([]);
  const [units, setUnits] = useState<AdminUnitSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<ProductFormValue>({
    name: "",
    slug: "",
    description: null,
    categoryId: "",
    inventoryBaseUnitId: "",
    customerDetails: [{ label: "", value: "", sortOrder: 1 }],
  });
  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/catalog/categories").then(
        (r) => r.json() as Promise<RpcResult<AdminCategoryPage>>,
      ),
      fetch("/api/admin/catalog/units").then(
        (r) => r.json() as Promise<RpcResult<AdminUnitSummary[]>>,
      ),
    ]).then(([categoryResult, unitResult]) => {
      if (categoryResult.ok) setCategories(categoryResult.value.items);
      if (unitResult.ok) setUnits(unitResult.value);
    });
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await intent.submit(
        async (idempotencyKey) =>
          (
            await fetch("/api/admin/catalog/products", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify(value),
            })
          ).json() as Promise<RpcResult<AdminProductSummary>>,
      );
      if (!result.ok) {
        setError(`${result.error.message} Request reference: ${result.error.requestId}`);
        return;
      }
      router.push(`/admin/catalog/products/${result.value.productId}?created=1`);
    } catch {
      setError("Connection lost. Retry to safely reuse this request.");
    }
  }
  return (
    <div className="space-y-6">
      <nav className="text-sm text-[var(--fm-text-muted)]">
        <Link className="underline" href="/admin/catalog/products">
          Products
        </Link>{" "}
        / Add
      </nav>
      <PageHeader
        title="Add product"
        description="Create Product identity, its shared inventory pool, and ordered customer details."
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
          units={units}
          pending={intent.pending}
          submitLabel="Create product"
          onChange={setValue}
          onSubmit={submit}
        />
      </section>
    </div>
  );
}
