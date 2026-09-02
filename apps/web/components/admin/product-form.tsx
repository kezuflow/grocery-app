"use client";

import type {
  AdminCategorySummary,
  AdminProductCustomerDetailInput,
  AdminUnitSummary,
} from "@freshmarkets/contracts";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EditorLayout } from "./admin-compositions";

export type ProductMediaDraft = {
  id: string;
  file: File | null;
  altText: string;
  isPrimary: boolean;
};

export type ProductVariantDraft = {
  id: string;
  code: string;
  name: string;
  sellableUnitId: string;
  sellQuantity: string;
  merchandisingLabel: string;
};

export type ProductFormValue = {
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  inventoryBaseUnitId?: string;
  status?: "active" | "inactive";
  statusReason?: string;
  customerDetails: AdminProductCustomerDetailInput[];
  media?: ProductMediaDraft[];
  variants?: ProductVariantDraft[];
};

export function ProductForm({
  formId,
  hideSubmit = false,
  value,
  categories,
  units,
  pending,
  submitLabel,
  onChange,
  onSubmit,
}: {
  formId?: string;
  hideSubmit?: boolean;
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
  function updateMedia(id: string, patch: Partial<ProductMediaDraft>) {
    onChange({
      ...value,
      media: value.media?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }
  function updateVariant(id: string, patch: Partial<ProductVariantDraft>) {
    onChange({
      ...value,
      variants: value.variants?.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  }
  const baseUnit = units?.find((unit) => unit.unitId === value.inventoryBaseUnitId);
  const sellableUnits = (units ?? []).filter(
    (unit) => unit.status === "active" && (!baseUnit || unit.dimension === baseUnit.dimension),
  );
  return (
    <form id={formId} onSubmit={onSubmit}>
      <EditorLayout
        asideLabel="Product organization"
        editor={
          <div className="space-y-4">
            <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
              <CardHeader className="border-b px-4 py-4 sm:px-5">
                <CardTitle>Product details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 px-4 py-5 sm:grid-cols-2 sm:px-5">
                <label className="block space-y-1 text-sm font-medium">
                  <span>Product name</span>
                  <Input
                    value={value.name}
                    required
                    onChange={(event) => onChange({ ...value, name: event.target.value })}
                  />
                </label>
                <label className="block space-y-1 text-sm font-medium">
                  <span>Product slug</span>
                  <Input
                    value={value.slug}
                    required
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
                </label>
              </CardContent>
            </Card>

            {value.media ? (
              <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="border-b px-4 py-4 sm:px-5">
                  <CardTitle>Product images</CardTitle>
                  <CardDescription>Add JPEG, PNG, or WebP images up to 5 MiB each.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 px-4 py-5 sm:px-5">
                  {value.media.map((media, index) => (
                    <div
                      key={media.id}
                      className="grid gap-3 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-3 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto_auto] md:items-end"
                    >
                      <label className="grid gap-1 text-sm font-medium">
                        <span>Image {index + 1}</span>
                        <Input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          required
                          onChange={(event) =>
                            updateMedia(media.id, { file: event.target.files?.[0] ?? null })
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm font-medium">
                        <span>Alt text</span>
                        <Input
                          value={media.altText}
                          maxLength={300}
                          placeholder="Fresh red onions"
                          required
                          onChange={(event) =>
                            updateMedia(media.id, { altText: event.target.value })
                          }
                        />
                      </label>
                      <label className="flex h-10 items-center gap-2 text-sm font-medium">
                        <input
                          type="radio"
                          name="primary-product-image"
                          checked={media.isPrimary}
                          onChange={() =>
                            onChange({
                              ...value,
                              media: value.media?.map((item) => ({
                                ...item,
                                isPrimary: item.id === media.id,
                              })),
                            })
                          }
                        />
                        Primary
                      </label>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove image ${index + 1}`}
                        onClick={() =>
                          onChange({
                            ...value,
                            media: value.media
                              ?.filter((item) => item.id !== media.id)
                              .map((item, itemIndex) => ({
                                ...item,
                                isPrimary: media.isPrimary ? itemIndex === 0 : item.isPrimary,
                              })),
                          })
                        }
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange({
                        ...value,
                        media: [
                          ...value.media!,
                          {
                            id: crypto.randomUUID(),
                            file: null,
                            altText: "",
                            isPrimary: value.media!.length === 0,
                          },
                        ],
                      })
                    }
                  >
                    <ImagePlus aria-hidden="true" className="size-4" />
                    Add image
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {value.variants ? (
              <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
                <CardHeader className="border-b px-4 py-4 sm:px-5">
                  <CardTitle>Variants</CardTitle>
                  <CardDescription>Configure the sizes or packs customers can buy.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 px-4 py-5 sm:px-5">
                  {value.variants.map((variant, index) => (
                    <div
                      key={variant.id}
                      className="space-y-3 rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold">Variant {index + 1}</p>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove variant ${index + 1}`}
                          onClick={() =>
                            onChange({
                              ...value,
                              variants: value.variants?.filter((item) => item.id !== variant.id),
                            })
                          }
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <label className="grid gap-1 text-sm font-medium">
                          <span>SKU</span>
                          <Input
                            value={variant.code}
                            placeholder="ONION-250G"
                            maxLength={80}
                            required
                            onChange={(event) =>
                              updateVariant(variant.id, { code: event.target.value.toUpperCase() })
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-sm font-medium">
                          <span>Variant name</span>
                          <Input
                            value={variant.name}
                            placeholder="250 g bag"
                            maxLength={120}
                            required
                            onChange={(event) =>
                              updateVariant(variant.id, { name: event.target.value })
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-sm font-medium">
                          <span>Sell unit</span>
                          <select
                            className="h-10 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
                            value={variant.sellableUnitId}
                            required
                            onChange={(event) =>
                              updateVariant(variant.id, { sellableUnitId: event.target.value })
                            }
                          >
                            <option value="">Select a unit</option>
                            {sellableUnits.map((unit) => (
                              <option key={unit.unitId} value={unit.unitId}>
                                {unit.displayName} ({unit.code})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm font-medium">
                          <span>Quantity</span>
                          <Input
                            value={variant.sellQuantity}
                            type="number"
                            min={1}
                            step={1}
                            placeholder="250"
                            required
                            onChange={(event) =>
                              updateVariant(variant.id, { sellQuantity: event.target.value })
                            }
                          />
                        </label>
                        <label className="grid gap-1 text-sm font-medium sm:col-span-2">
                          <span>Merchandising label (optional)</span>
                          <Input
                            value={variant.merchandisingLabel}
                            placeholder="Best value"
                            maxLength={60}
                            onChange={(event) =>
                              updateVariant(variant.id, {
                                merchandisingLabel: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      onChange({
                        ...value,
                        variants: [
                          ...value.variants!,
                          {
                            id: crypto.randomUUID(),
                            code: "",
                            name: "",
                            sellableUnitId: "",
                            sellQuantity: "",
                            merchandisingLabel: "",
                          },
                        ],
                      })
                    }
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    Add variant
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <Card className="gap-0 py-0 shadow-[var(--fm-shadow-card)]">
              <CardHeader className="border-b px-4 py-4 sm:px-5">
                <CardTitle>Customer-facing details</CardTitle>
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
                    required
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
                      required
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
                {value.status ? (
                  <>
                    <label className="block space-y-1 text-sm font-medium">
                      <span>Status</span>
                      <select
                        className="h-10 w-full rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] bg-white px-3"
                        value={value.status}
                        onChange={(event) =>
                          onChange({
                            ...value,
                            status: event.target.value as "active" | "inactive",
                            statusReason: event.target.value === "active" ? "" : value.statusReason,
                          })
                        }
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </label>
                    {value.status === "inactive" ? (
                      <label className="block space-y-1 text-sm font-medium">
                        <span>Reason for inactive status</span>
                        <Input
                          value={value.statusReason ?? ""}
                          maxLength={500}
                          placeholder="Not ready for the storefront"
                          required
                          onChange={(event) =>
                            onChange({ ...value, statusReason: event.target.value })
                          }
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}
              </CardContent>
            </Card>
            {!hideSubmit ? (
              <Card className="gap-3 py-4 shadow-[var(--fm-shadow-card)]">
                <CardContent className="px-4">
                  <Button
                    className="fm-admin-reference-primary w-full"
                    type="submit"
                    disabled={pending}
                  >
                    {pending ? "Saving…" : submitLabel}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        }
      />
    </form>
  );
}
