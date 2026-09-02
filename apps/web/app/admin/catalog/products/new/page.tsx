"use client";

import type {
  AdminCatalogSkuSummary,
  AdminCategoryPage,
  AdminProductMediaView,
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
import { Button } from "@/components/ui/button";

const CREATE_PRODUCT_FORM_ID = "create-product-form";

class ProductSetupError extends Error {}

async function imageHasValidSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (file.type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    file.type === "image/webp" &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function jsonCommand<T>(
  url: string,
  method: "POST" | "PUT",
  body: unknown,
  idempotencyKey: string,
): Promise<RpcResult<T>> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
  return (await response.json()) as RpcResult<T>;
}

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
    status: "active",
    statusReason: "",
    customerDetails: [{ label: "", value: "", sortOrder: 1 }],
    media: [],
    variants: [
      {
        id: crypto.randomUUID(),
        code: "",
        name: "",
        sellableUnitId: "",
        sellQuantity: "",
        merchandisingLabel: "",
      },
    ],
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
    const media = value.media ?? [];
    const variants = value.variants ?? [];
    const customerDetails = value.customerDetails.filter(
      (detail) => detail.label.trim() || detail.value.trim(),
    );
    if (customerDetails.some((detail) => !detail.label.trim() || !detail.value.trim())) {
      setError("Each customer-facing detail needs both a label and a value.");
      return;
    }
    if (value.status === "inactive" && !value.statusReason?.trim()) {
      setError("A reason is required when creating an inactive product.");
      return;
    }
    const codes = variants.map((variant) => variant.code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      setError("Each variant needs a unique SKU code.");
      return;
    }
    for (const [index, image] of media.entries()) {
      if (
        !image.file ||
        image.file.size === 0 ||
        image.file.size > 5 * 1024 * 1024 ||
        !(await imageHasValidSignature(image.file))
      ) {
        setError(`Image ${index + 1} must be a valid JPEG, PNG, or WebP file up to 5 MiB.`);
        return;
      }
    }
    const normalizedVariants: Array<{
      variant: (typeof variants)[number];
      sellQuantity: number;
      consumptionBaseQuantity: number;
    }> = [];
    for (const [index, variant] of variants.entries()) {
      const unit = units.find((candidate) => candidate.unitId === variant.sellableUnitId);
      const sellQuantity = Number(variant.sellQuantity);
      const convertedNumerator = sellQuantity * (unit?.conversionNumerator ?? 0);
      const consumptionBaseQuantity = unit ? convertedNumerator / unit.conversionDenominator : 0;
      if (
        !unit ||
        !Number.isSafeInteger(sellQuantity) ||
        sellQuantity < 1 ||
        !Number.isSafeInteger(consumptionBaseQuantity) ||
        consumptionBaseQuantity < 1
      ) {
        setError(
          `Variant ${index + 1} needs a sell quantity that converts exactly to its base unit.`,
        );
        return;
      }
      normalizedVariants.push({ variant, sellQuantity, consumptionBaseQuantity });
    }
    try {
      const result = await intent.submit(async (idempotencyKey) => {
        const productResult = await jsonCommand<AdminProductSummary>(
          "/api/admin/catalog/products",
          "POST",
          {
            categoryId: value.categoryId,
            slug: value.slug,
            name: value.name,
            description: value.description,
            inventoryBaseUnitId: value.inventoryBaseUnitId,
            customerDetails,
          },
          idempotencyKey,
        );
        if (!productResult.ok) return productResult;
        const productId = productResult.value.productId;

        for (const [index, image] of media.entries()) {
          const fields = new FormData();
          fields.set("file", image.file!);
          fields.set("altText", image.altText.trim());
          fields.set("isPrimary", String(image.isPrimary));
          fields.set("sortOrder", String(index));
          fields.set("expectedProductVersion", String(index + 1));
          const response = await fetch(
            `/api/admin/catalog/products/${encodeURIComponent(productId)}/media`,
            {
              method: "POST",
              headers: { "idempotency-key": `${idempotencyKey}:media:${index}` },
              body: fields,
            },
          );
          const mediaResult = (await response.json()) as RpcResult<AdminProductMediaView>;
          if (!mediaResult.ok) {
            throw new ProductSetupError(`Image ${index + 1}: ${mediaResult.error.message}`);
          }
        }

        for (const [index, normalized] of normalizedVariants.entries()) {
          const skuResult = await jsonCommand<AdminCatalogSkuSummary>(
            "/api/admin/catalog/skus",
            "POST",
            {
              productId,
              code: normalized.variant.code.trim().toUpperCase(),
              name: normalized.variant.name.trim(),
              sellableUnitId: normalized.variant.sellableUnitId,
              sellQuantity: normalized.sellQuantity,
              consumptionBaseQuantity: normalized.consumptionBaseQuantity,
              merchandisingLabel: normalized.variant.merchandisingLabel.trim() || null,
              sortOrder: index,
            },
            `${idempotencyKey}:variant:${index}`,
          );
          if (!skuResult.ok) {
            throw new ProductSetupError(`Variant ${index + 1}: ${skuResult.error.message}`);
          }
        }
        if (value.status === "inactive") {
          const statusResult = await jsonCommand<AdminProductSummary>(
            `/api/admin/catalog/products/${encodeURIComponent(productId)}/status`,
            "POST",
            {
              status: "inactive",
              reason: value.statusReason?.trim(),
              expectedVersion: 1 + media.length,
            },
            `${idempotencyKey}:status`,
          );
          if (!statusResult.ok) {
            throw new ProductSetupError(`Status: ${statusResult.error.message}`);
          }
        }
        return productResult;
      });
      if (!result.ok) {
        setError(`${result.error.message} Request reference: ${result.error.requestId}`);
        return;
      }
      router.push(`/admin/catalog/products/${result.value.productId}?created=1`);
    } catch (caught) {
      setError(
        caught instanceof ProductSetupError
          ? `Product setup paused. ${caught.message} Retry Create product to resume safely.`
          : "Connection lost. Retry Create product to safely resume this setup.",
      );
    }
  }
  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader
        title="Add product"
        action={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/catalog/products" prefetch={false}>
                Discard
              </Link>
            </Button>
            <Button
              type="submit"
              form={CREATE_PRODUCT_FORM_ID}
              size="sm"
              className="fm-admin-reference-primary"
              disabled={intent.pending}
            >
              {intent.pending ? "Saving…" : "Create product"}
            </Button>
          </div>
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ProductForm
        formId={CREATE_PRODUCT_FORM_ID}
        hideSubmit
        value={value}
        categories={categories}
        units={units}
        pending={intent.pending}
        submitLabel="Create product"
        onChange={setValue}
        onSubmit={submit}
      />
    </div>
  );
}
