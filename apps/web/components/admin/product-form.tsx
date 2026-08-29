"use client";

import type {
  AdminCategorySummary,
  AdminProductCustomerDetailInput,
  AdminUnitSummary,
} from "@freshmarkets/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ProductFormValue = {
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  inventoryBaseUnitId?: string;
  customerDetails: AdminProductCustomerDetailInput[];
};

export function ProductForm({
  value,
  categories,
  units,
  pending,
  submitLabel,
  onChange,
  onSubmit,
}: {
  value: ProductFormValue;
  categories: ReadonlyArray<AdminCategorySummary>;
  units?: ReadonlyArray<AdminUnitSummary>;
  pending: boolean;
  submitLabel: string;
  onChange: (value: ProductFormValue) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  function updateDetail(index: number, field: "label" | "value", nextValue: string) {
    onChange({
      ...value,
      customerDetails: value.customerDetails.map((detail, detailIndex) =>
        detailIndex === index ? { ...detail, [field]: nextValue } : detail,
      ),
    });
  }
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <label className="block space-y-1 text-sm font-medium">
        <span>Product name</span>
        <Input
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Product slug</span>
        <Input
          value={value.slug}
          onChange={(event) => onChange({ ...value, slug: event.target.value })}
          placeholder="red-onion"
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Product description</span>
        <textarea
          className="min-h-24 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 py-2"
          value={value.description ?? ""}
          onChange={(event) => onChange({ ...value, description: event.target.value || null })}
        />
      </label>
      <label className="block space-y-1 text-sm font-medium">
        <span>Product category</span>
        <select
          className="h-9 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
          value={value.categoryId}
          onChange={(event) => onChange({ ...value, categoryId: event.target.value })}
        >
          <option value="">Select a category</option>
          {categories
            .filter(
              (category) =>
                category.status === "active" || category.categoryId === value.categoryId,
            )
            .map((category) => (
              <option key={category.categoryId} value={category.categoryId}>
                {category.name}
                {category.status === "inactive" ? " (inactive)" : ""}
              </option>
            ))}
        </select>
      </label>
      {units ? (
        <label className="block space-y-1 text-sm font-medium">
          <span>Inventory base unit</span>
          <select
            className="h-9 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
            value={value.inventoryBaseUnitId ?? ""}
            onChange={(event) => onChange({ ...value, inventoryBaseUnitId: event.target.value })}
          >
            <option value="">Select a canonical base unit</option>
            {units
              .filter(
                (unit) =>
                  unit.code === unit.canonicalBaseCode &&
                  unit.conversionNumerator === unit.conversionDenominator,
              )
              .map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.displayName} ({unit.code})
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <fieldset className="space-y-3">
        <legend className="font-semibold">Customer-facing details</legend>
        <p className="text-sm text-[var(--fm-text-muted)]">
          Ordered facts such as Contents, Storage, or Origin.
        </p>
        {value.customerDetails.map((detail, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-3 sm:grid-cols-[1fr_2fr_auto]"
          >
            <Input
              aria-label={`Detail label ${index + 1}`}
              value={detail.label}
              onChange={(event) => updateDetail(index, "label", event.target.value)}
              placeholder="Storage"
            />
            <Input
              aria-label={`Detail value ${index + 1}`}
              value={detail.value}
              onChange={(event) => updateDetail(index, "value", event.target.value)}
              placeholder="Keep refrigerated"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...value,
                  customerDetails: value.customerDetails
                    .filter((_, detailIndex) => detailIndex !== index)
                    .map((item, detailIndex) => ({ ...item, sortOrder: detailIndex + 1 })),
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange({
              ...value,
              customerDetails: [
                ...value.customerDetails,
                { label: "", value: "", sortOrder: value.customerDetails.length + 1 },
              ],
            })
          }
        >
          Add detail
        </Button>
      </fieldset>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
