"use client";
import { adminCategorySummarySchema } from "@freshmarkets/validation";

import { useCategoryOptions } from "@/components/admin/category-authoring-state";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CategoryForm, type CategoryFormValue } from "@/components/admin/category-form";
import { useCatalogCommand } from "@/components/admin/catalog-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewCategoryWorkspace({
  onCreated,
  onCancel,
  embedded = false,
}: {
  onCreated?: (categoryId: string) => void;
  onCancel?: () => void;
  embedded?: boolean;
} = {}) {
  const router = useRouter();
  const intent = useCatalogCommand(adminCategorySummarySchema);
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
      if (onCreated) onCreated(result.value.categoryId);
      else router.push(`/admin/catalog/categories/${result.value.categoryId}?created=1`);
    } catch {
      setError({ message: "Connection lost. Retry to safely reuse this request." });
    }
  }
  return (
    <div className={embedded ? "flex h-full min-h-0 flex-col" : "space-y-6"}>
      {embedded ? (
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-5">
          <div>
            <h2 id="create-category-panel-title" className="text-xl font-bold tracking-[-0.03em]">
              Add category
            </h2>
            <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
              Create a new catalog category and choose its position.
            </p>
          </div>
          {onCancel ? (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : (
        <PageHeader title="Add category" />
      )}
      <div className={embedded ? "min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4" : "contents"}>
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
        <section className="rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-6">
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
    </div>
  );
}

export default function NewCategoryPage() {
  return <NewCategoryWorkspace />;
}
