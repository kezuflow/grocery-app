"use client";
import { useState } from "react";
import type { AdminPromotionDetail, AdminPromotionUpdateRequest } from "@freshmarkets/contracts";
import { adminPromotionUpdateBodySchema } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  PromotionProductTargetsEditor,
  type SaleTargetSelection,
} from "./promotion-product-targets-editor";

function minor(text: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return NaN;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}
export function PromotionDefinitionForm({
  promotion,
  disabled,
  onSave,
}: {
  promotion: AdminPromotionDetail;
  disabled: boolean;
  onSave: (
    body: Omit<
      AdminPromotionUpdateRequest,
      "headers" | "requestId" | "idempotencyKey" | "promotionId"
    >,
  ) => Promise<boolean>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [productSale, setProductSale] = useState(Boolean(promotion.productTargets?.length));
  const [productTargets, setProductTargets] = useState<SaleTargetSelection[]>([
    ...(promotion.productTargets ?? []),
  ]);
  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (productSale && !productTargets.length) {
          setError("Add at least one selling option to the product sale.");
          return;
        }
        const data = new FormData(event.currentTarget);
        const startsAt = String(data.get("startsAt"));
        const endsAt = String(data.get("endsAt"));
        const parsed = adminPromotionUpdateBodySchema.safeParse({
          name: data.get("name"),
          description: data.get("description"),
          ...(promotion.benefitType.endsWith("FIXED_DISCOUNT")
            ? { discountMinor: minor(String(data.get("discount"))) }
            : promotion.benefitType.endsWith("PERCENT_DISCOUNT")
              ? { percent: Number(data.get("discount")) }
              : {}),
          maximumDiscountMinor:
            !productSale && data.get("maximum") ? minor(String(data.get("maximum"))) : null,
          productTargets: productSale
            ? productTargets.map(({ skuId, locationId, quantityLimit }) => ({
                skuId,
                locationId,
                quantityLimit,
              }))
            : [],
          globalUsageLimit: data.get("globalLimit") ? Number(data.get("globalLimit")) : null,
          perCustomerUsageLimit: data.get("customerLimit")
            ? Number(data.get("customerLimit"))
            : null,
          automatic: productSale || data.get("automatic") === "on",
          minimumMinor: minor(String(data.get("minimum"))),
          startsAt: `${startsAt}Z`,
          endsAt: endsAt ? `${endsAt}Z` : null,
          expectedVersion: promotion.version,
        });
        if (!parsed.success) {
          setError("Check the name, discount, minimum purchase, and dates.");
          return;
        }
        setError(null);
        void onSave(parsed.data);
      }}
    >
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          Campaign name
          <Input
            name="name"
            aria-label="Campaign name"
            defaultValue={promotion.name}
            maxLength={120}
            required
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Description
          <Input
            name="description"
            aria-label="Campaign description"
            defaultValue={promotion.description}
            maxLength={2000}
          />
        </label>
        {promotion.benefitType !== "DELIVERY_FEE_WAIVER" ? (
          <label className="grid gap-1 text-sm font-medium">
            {promotion.benefitType.endsWith("FIXED_DISCOUNT") ? "Discount (pesos)" : "Discount (%)"}
            <Input
              name="discount"
              aria-label="Campaign discount"
              defaultValue={
                promotion.benefitType.endsWith("FIXED_DISCOUNT")
                  ? ((promotion.discountMinor ?? 0) / 100).toFixed(2)
                  : String(promotion.percent ?? 0)
              }
              required
              inputMode="decimal"
            />
          </label>
        ) : (
          <p className="text-sm">Free delivery</p>
        )}
        <label className="grid gap-1 text-sm font-medium">
          Minimum merchandise purchase (pesos)
          <Input
            name="minimum"
            aria-label="Campaign minimum purchase"
            defaultValue={(promotion.minimumMinor / 100).toFixed(2)}
            required
            inputMode="decimal"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Starts at (UTC)
          <Input
            name="startsAt"
            aria-label="Campaign start (UTC)"
            type="datetime-local"
            step="any"
            defaultValue={promotion.startsAt.replace(/Z$/, "")}
            required
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Ends at (UTC, optional)
          <Input
            name="endsAt"
            aria-label="Campaign end (UTC)"
            type="datetime-local"
            step="any"
            defaultValue={promotion.endsAt?.replace(/Z$/, "") ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Maximum discount (pesos, optional)
          <Input
            name="maximum"
            disabled={productSale}
            aria-label="Campaign maximum discount"
            defaultValue={
              promotion.maximumDiscountMinor == null
                ? ""
                : (promotion.maximumDiscountMinor / 100).toFixed(2)
            }
            inputMode="decimal"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Total redemption limit (optional)
          <Input
            name="globalLimit"
            aria-label="Campaign total redemption limit"
            type="number"
            min={1}
            step={1}
            defaultValue={promotion.globalUsageLimit ?? ""}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Redemptions per customer (optional)
          <Input
            name="customerLimit"
            aria-label="Campaign customer redemption limit"
            type="number"
            min={1}
            step={1}
            defaultValue={promotion.perCustomerUsageLimit ?? ""}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="automatic"
            disabled={productSale}
            defaultChecked={promotion.automatic}
          />
          Apply automatically when eligible
        </label>
      </fieldset>
      {promotion.benefitType.startsWith("ORDER_") ? (
        <PromotionProductTargetsEditor
          enabled={productSale}
          onEnabledChange={setProductSale}
          value={productTargets}
          onChange={setProductTargets}
          disabled={disabled}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled}>
        Save campaign
      </Button>
    </form>
  );
}
