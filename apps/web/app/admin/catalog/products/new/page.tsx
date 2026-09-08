"use client";
import {
  z,
  adminProductSummarySchema,
  adminCatalogSkuSummarySchema,
  adminProductMediaViewSchema,
  adminUnitSummarySchema,
} from "@freshmarkets/validation";
import { catalogResultSchema } from "@/components/admin/catalog-command-state";

import type {
  AdminCatalogSkuSummary,
  AdminProductSummary,
  AdminUnitSummary,
  RpcResult,
} from "@freshmarkets/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAdminCommandIntent } from "@/components/admin/admin-command-state";
import { PageHeader } from "@/components/admin/admin-shell";
import { ProductForm, type ProductFormValue } from "@/components/admin/product-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useCategoryOptions } from "@/components/admin/category-authoring-state";

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
  schema: z.ZodType<T>,
): Promise<RpcResult<T>> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
  return catalogResultSchema(schema).parse(await response.json());
}

export default function NewProductPage() {
  const router = useRouter();
  const intent = useAdminCommandIntent();
  const savedSetup = useRef<ProductFormValue | null>(null);
  const [recovering, setRecovering] = useState(false);
  const categories = useCategoryOptions();
  const [units, setUnits] = useState<AdminUnitSummary[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitsAttempt, setUnitsAttempt] = useState(0);
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
        estimatedShippingWeightGrams: "",
        merchandisingLabel: "",
      },
    ],
  });
  useEffect(() => {
    let current = true;
    setUnitsLoading(true);
    setUnitsError(null);
    void fetch("/api/admin/catalog/units")
      .then(async (r) => catalogResultSchema(z.array(adminUnitSummarySchema)).parse(await r.json()))
      .then((result) => {
        if (!current) return;
        if (result.ok) setUnits(result.value);
        else setUnitsError(result.error.message);
      })
      .catch(() => {
        if (current) setUnitsError("Units could not be loaded. Retry to continue product setup.");
      })
      .finally(() => {
        if (current) setUnitsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [unitsAttempt]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (intent.pending) return;
    setError(null);
    const submitted = savedSetup.current ?? value;
    const media = submitted.media ?? [];
    const variants = submitted.variants ?? [];
    const customerDetails = submitted.customerDetails.filter(
      (detail) => detail.label.trim() || detail.value.trim(),
    );
    if (customerDetails.some((detail) => !detail.label.trim() || !detail.value.trim())) {
      setError("Each customer-facing detail needs both a label and a value.");
      return;
    }
    if (submitted.status === "inactive" && !submitted.statusReason?.trim()) {
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
      estimatedShippingWeightGrams: number | null;
    }> = [];
    for (const [index, variant] of variants.entries()) {
      const unit = units.find((candidate) => candidate.unitId === variant.sellableUnitId);
      const sellQuantity = Number(variant.sellQuantity);
      const convertedNumerator = sellQuantity * (unit?.conversionNumerator ?? 0);
      const consumptionBaseQuantity = unit ? convertedNumerator / unit.conversionDenominator : 0;
      const estimatedShippingWeightGrams =
        unit?.canonicalBaseCode === "GRAM" ? null : Number(variant.estimatedShippingWeightGrams);
      if (
        !unit ||
        !Number.isSafeInteger(sellQuantity) ||
        sellQuantity < 1 ||
        !Number.isSafeInteger(consumptionBaseQuantity) ||
        consumptionBaseQuantity < 1 ||
        (unit.canonicalBaseCode !== "GRAM" &&
          (typeof estimatedShippingWeightGrams !== "number" ||
            !Number.isSafeInteger(estimatedShippingWeightGrams) ||
            estimatedShippingWeightGrams < 1))
      ) {
        setError(
          `Variant ${index + 1} needs a sell quantity that converts exactly to its base unit.`,
        );
        return;
      }
      normalizedVariants.push({
        variant,
        sellQuantity,
        consumptionBaseQuantity,
        estimatedShippingWeightGrams,
      });
    }
    savedSetup.current = submitted;
    setRecovering(true);
    try {
      const result = await intent.submit(async (idempotencyKey) => {
        const productResult = await jsonCommand<AdminProductSummary>(
          "/api/admin/catalog/products",
          "POST",
          {
            categoryId: submitted.categoryId,
            slug: submitted.slug,
            name: submitted.name,
            description: submitted.description,
            inventoryBaseUnitId: submitted.inventoryBaseUnitId,
            customerDetails,
          },
          idempotencyKey,
          adminProductSummarySchema,
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
          const mediaResult = catalogResultSchema(adminProductMediaViewSchema).parse(
            await response.json(),
          );
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
              estimatedShippingWeightGrams: normalized.estimatedShippingWeightGrams,
              merchandisingLabel: normalized.variant.merchandisingLabel.trim() || null,
              sortOrder: index,
            },
            `${idempotencyKey}:variant:${index}`,
            adminCatalogSkuSummarySchema,
          );
          if (!skuResult.ok) {
            throw new ProductSetupError(`Variant ${index + 1}: ${skuResult.error.message}`);
          }
        }
        if (submitted.status === "inactive") {
          const statusResult = await jsonCommand<AdminProductSummary>(
            `/api/admin/catalog/products/${encodeURIComponent(productId)}/status`,
            "POST",
            {
              status: "inactive",
              reason: submitted.statusReason?.trim(),
              expectedVersion: 1 + media.length,
            },
            `${idempotencyKey}:status`,
            adminProductSummarySchema,
          );
          if (!statusResult.ok) {
            throw new ProductSetupError(`Status: ${statusResult.error.message}`);
          }
        }
        return productResult;
      });
      if (!result.ok) {
        savedSetup.current = null;
        setRecovering(false);
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
              disabled={intent.pending || unitsLoading || !!unitsError}
            >
              {intent.pending ? "Saving…" : recovering ? "Retry saved setup" : "Create product"}
            </Button>
          </div>
        }
      />
      {error || categories.error || unitsError ? (
        <Alert variant="destructive">
          <AlertDescription>{error ?? categories.error ?? unitsError}</AlertDescription>
        </Alert>
      ) : null}
      {unitsError ? (
        <Button onClick={() => setUnitsAttempt((attempt) => attempt + 1)}>Retry units</Button>
      ) : null}
      {categories.hasMore || categories.error ? (
        <Button disabled={categories.loading} onClick={() => void categories.loadMore()}>
          {categories.error ? "Retry categories" : "More categories"}
        </Button>
      ) : null}
      <fieldset disabled={intent.pending || recovering || unitsLoading}>
        <ProductForm
          formId={CREATE_PRODUCT_FORM_ID}
          hideSubmit
          value={value}
          categories={categories.items}
          units={units}
          pending={intent.pending || recovering}
          submitLabel="Create product"
          onChange={setValue}
          onSubmit={submit}
        />
      </fieldset>
    </div>
  );
}
