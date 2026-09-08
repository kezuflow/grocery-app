"use client";

import { useCategoryOptions } from "@/components/admin/category-authoring-state";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryForm, type CategoryFormValue } from "@/components/admin/category-form";
import { useCategoryCommand } from "@/components/admin/category-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function NewCategoryPage() {
  const router = useRouter();
  const intent = useCategoryCommand();
  const parents = useCategoryOptions();
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);
  const [value, setValue] = useState<CategoryFormValue>({
    code: "",
    name: "",
    slug: "",
    parentCategoryId: null,
    iconAssetKey: null,
    sortOrder: 0,
  });
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await intent.submit("/api/admin/catalog/categories", value);
      if (!result) return;
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
      <PageHeader title="Add category" />
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
          categories={parents.items}
          pending={intent.pending}
          locked={intent.uncertain}
          submitLabel={intent.uncertain ? "Retry saved category" : "Create category"}
          onChange={setValue}
          onSubmit={submit}
        />
      </section>
    </div>
  );
}
