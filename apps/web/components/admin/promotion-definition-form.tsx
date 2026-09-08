"use client";
import { useState } from "react";
import type { AdminPromotionDetail, AdminPromotionUpdateRequest } from "@freshmarkets/contracts";
import { adminPromotionUpdateBodySchema } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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
  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const startsAt = String(data.get("startsAt"));
        const endsAt = String(data.get("endsAt"));
        const parsed = adminPromotionUpdateBodySchema.safeParse({
          name: data.get("name"),
          description: data.get("description"),
          ...(promotion.benefitType === "ORDER_FIXED_DISCOUNT"
            ? { discountMinor: minor(String(data.get("discount"))) }
            : { percent: Number(data.get("discount")) }),
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
        <label className="grid gap-1 text-sm font-medium">
          {promotion.benefitType === "ORDER_FIXED_DISCOUNT"
            ? "Merchandise discount (pesos)"
            : "Merchandise discount (%)"}
          <Input
            name="discount"
            aria-label="Campaign discount"
            defaultValue={
              promotion.benefitType === "ORDER_FIXED_DISCOUNT"
                ? ((promotion.discountMinor ?? 0) / 100).toFixed(2)
                : String(promotion.percent ?? 0)
            }
            required
            inputMode="decimal"
          />
        </label>
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
      </fieldset>
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
