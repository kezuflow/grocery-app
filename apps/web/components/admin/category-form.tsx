"use client";

import type { AdminCategorySummary } from "@freshmarkets/contracts";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export type CategoryFormValue = {
  code?: string;
  name: string;
  slug: string;
  parentCategoryId: string | null;
  iconAssetKey: string | null;
  sortOrder: number;
};

export function CategoryForm({
  value,
  categories,
  pending,
  submitLabel,
  lockCode = false,
  onChange,
  onSubmit,
}: {
  value: CategoryFormValue;
  categories: ReadonlyArray<AdminCategorySummary>;
  pending: boolean;
  submitLabel: string;
  lockCode?: boolean;
  onChange: (value: CategoryFormValue) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {value.code !== undefined ? (
        <label className="block space-y-1 text-sm font-medium">
          <span>Category code</span>
          <Input
            value={value.code}
            disabled={lockCode}
            onChange={(event) => onChange({ ...value, code: event.target.value })}
            placeholder="FRESH_PRODUCE"
          />
        </label>
      ) : null}
      <label className="block space-y-1 text-sm font-medium">
        <span>Category name</span>
        <Input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Category slug</span>
        <Input
          value={value.slug}
          onChange={(event) => onChange({ ...value, slug: event.target.value })}
          placeholder="fresh-produce"
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Parent category</span>
        <select
          className="h-9 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
          value={value.parentCategoryId ?? ""}
          onChange={(event) => onChange({ ...value, parentCategoryId: event.target.value || null })}
        >
          <option value="">No parent</option>
          {categories.map((category) => (
            <option key={category.categoryId} value={category.categoryId}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Icon asset</span>
        <Input
          value={value.iconAssetKey ?? ""}
          onChange={(event) => onChange({ ...value, iconAssetKey: event.target.value || null })}
          placeholder="fresh-produce.svg"
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Sort order</span>
        <Input
          type="number"
          min={0}
          value={value.sortOrder}
          onChange={(event) => onChange({ ...value, sortOrder: Number(event.target.value) })}
        />
      </label>
      <Button type="submit" size="sm" className="fm-admin-reference-primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
