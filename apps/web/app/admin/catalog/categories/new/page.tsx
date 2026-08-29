"use client";

import type { AdminCategoryPage, AdminCategorySummary, RpcResult } from "@freshmarkets/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CategoryForm, type CategoryFormValue } from "@/components/admin/category-form";
import { useAdminCommandIntent } from "@/components/admin/admin-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function NewCategoryPage() {
  const router = useRouter();
  const intent = useAdminCommandIntent();
  const [parents, setParents] = useState<AdminCategorySummary[]>([]);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [value, setValue] = useState<CategoryFormValue>({
    code: "",
    name: "",
    slug: "",
    parentCategoryId: null,
    iconAssetKey: null,
    sortOrder: 0,
  });
  useEffect(() => {
    void fetch("/api/admin/catalog/categories")
      .then((r) => r.json() as Promise<RpcResult<AdminCategoryPage>>)
      .then((result) => {
        if (result.ok) setParents([...result.value.items]);
      });
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await intent.submit(
        async (idempotencyKey) =>
          (
            await fetch("/api/admin/catalog/categories", {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
              body: JSON.stringify(value),
            })
          ).json() as Promise<RpcResult<AdminCategorySummary>>,
      );
      if (!result.ok) {
        setError({ message: result.error.message, requestId: result.error.requestId });
        return;
      }
      router.push(`/admin/catalog/categories/${result.value.categoryId}?created=1`);
    } catch {
      setError({ message: "Connection lost. Retry to safely reuse this request." });
    }
  }
  return (
    <div className="space-y-6">
      <nav className="text-sm text-[var(--fm-text-muted)]">
        <Link href="/admin/catalog/categories" className="underline">
          Categories
        </Link>{" "}
        / Add
      </nav>
      <PageHeader
        title="Add category"
        description="Create a durable node in the global Catalog hierarchy."
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error.message}
            {error.requestId ? (
              <>
                <br />
                <span className="font-mono text-xs">Request reference: {error.requestId}</span>
              </>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="max-w-2xl rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white p-6">
        <CategoryForm
          value={value}
          categories={parents}
          pending={intent.pending}
          submitLabel="Create category"
          onChange={setValue}
          onSubmit={submit}
        />
      </section>
    </div>
  );
}
