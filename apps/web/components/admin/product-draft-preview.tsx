"use client";

import { ImageIcon, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { AdminStatusPill } from "./admin-status-pill";
import type { ProductFormValue } from "./product-form";

export function ProductDraftPreview({
  value,
  categoryName,
  existingMediaUrl,
}: {
  value: ProductFormValue;
  categoryName?: string;
  existingMediaUrl?: string | null;
}) {
  const primaryDraft = value.media?.find((media) => media.isPrimary) ?? value.media?.[0];
  const [draftUrl, setDraftUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!primaryDraft?.file) {
      setDraftUrl(null);
      return;
    }
    const url = URL.createObjectURL(primaryDraft.file);
    setDraftUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [primaryDraft?.file]);

  const previewUrl = draftUrl ?? existingMediaUrl ?? null;
  const firstVariant = value.variants?.find((variant) => variant.name.trim());

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-[var(--fm-shadow-card)]">
      <CardHeader className="border-b px-4 py-4">
        <CardTitle className="flex items-center gap-2">
          Product preview
          <Info className="size-4 text-[var(--fm-text-muted)]" aria-hidden="true" />
        </CardTitle>
        <CardDescription>This uses the customer-facing details entered here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 py-4">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="aspect-square w-full rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] object-cover"
          />
        ) : (
          <div className="grid aspect-square w-full place-items-center rounded-lg border border-dashed border-[var(--fm-border)] bg-[var(--fm-admin-surface-muted)] text-[var(--fm-text-muted)]">
            <span className="grid justify-items-center gap-2 text-xs">
              <ImageIcon className="size-6" aria-hidden="true" />
              Add a main product image
            </span>
          </div>
        )}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold tracking-[-0.02em]">
              {value.name.trim() || "Product name"}
            </h3>
            {value.status ? (
              <AdminStatusPill
                status={value.status}
                tone={value.status === "active" ? "success" : "neutral"}
              />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
            {categoryName ?? "Select a category"}
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--fm-text-muted)]">
            {value.description?.trim() || "Add a helpful customer-facing description."}
          </p>
        </div>
        <div className="border-t border-[var(--fm-border)] pt-4">
          <p className="text-sm font-semibold">
            {firstVariant?.name.trim() || "Selling option preview"}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--fm-text-muted)]">
            Exact-location prices and selling availability are configured after the Product and its
            options exist.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
