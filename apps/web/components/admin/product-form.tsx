"use client";

import type {
  AdminCategorySummary,
  AdminProductCustomerDetailInput,
  AdminUnitSummary,
} from "@freshmarkets/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EditorLayout } from "./admin-compositions";

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
    <form onSubmit={onSubmit}>
      <EditorLayout
        asideLabel="Product classification and command"
        editor={
          <div className="space-y-4">
            <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
              <CardHeader className="border-b px-4 py-4 sm:px-5">
                <CardTitle>Product details</CardTitle>
                <CardDescription>Global customer-facing Product identity.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 px-4 py-5 sm:grid-cols-2 sm:px-5">
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
                <label className="block space-y-1 text-sm font-medium sm:col-span-2">
                  <span>Product description</span>
                  <textarea
                    className="min-h-32 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3 py-2"
                    value={value.description ?? ""}
                    onChange={(event) =>
                      onChange({ ...value, description: event.target.value || null })
                    }
                  />
                  <span className="block text-xs font-normal text-[var(--fm-text-muted)]">
                    Describe the Product without changing SKU, price, or inventory truth.
                  </span>
                </label>
              </CardContent>
            </Card>

            <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
              <CardHeader className="border-b px-4 py-4 sm:px-5">
                <CardTitle>Customer-facing details</CardTitle>
                <CardDescription>
                  Ordered facts such as Contents, Storage, or Origin.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 px-4 py-5 sm:px-5">
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
                            .map((item, detailIndex) => ({
                              ...item,
                              sortOrder: detailIndex + 1,
                            })),
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
                        {
                          label: "",
                          value: "",
                          sortOrder: value.customerDetails.length + 1,
                        },
                      ],
                    })
                  }
                >
                  Add detail
                </Button>
              </CardContent>
            </Card>
          </div>
        }
        aside={
          <div className="space-y-4">
            <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
              <CardHeader className="border-b px-4 py-4">
                <CardTitle>Product classification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 px-4 py-5">
                <label className="block space-y-1 text-sm font-medium">
                  <span>Product category</span>
                  <select
                    className="h-10 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
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
                      className="h-10 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
                      value={value.inventoryBaseUnitId ?? ""}
                      onChange={(event) =>
                        onChange({ ...value, inventoryBaseUnitId: event.target.value })
                      }
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
              </CardContent>
            </Card>
            <Card className="gap-3 py-4 shadow-[var(--fm-shadow-card)]">
              <CardHeader className="px-4">
                <CardTitle>Save Product</CardTitle>
                <CardDescription>
                  This runs the legal Core command. Draft and arbitrary publish states are not
                  available.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                <Button className="w-full" type="submit" disabled={pending}>
                  {pending ? "Saving…" : submitLabel}
                </Button>
              </CardContent>
            </Card>
          </div>
        }
      />
    </form>
  );
}
