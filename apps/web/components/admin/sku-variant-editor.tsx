"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminCatalogSkuSummary } from "@freshmarkets/contracts";
import { adminCatalogSkuSummarySchema, adminSkuUpdateBodySchema } from "@freshmarkets/validation";
import { Button } from "@/components/admin/shadcn/button";
import { Input } from "@/components/admin/shadcn/input";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/admin/shadcn/dialog";
import { Alert, AlertDescription } from "@/components/admin/shadcn/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/admin/shadcn/field";
import { useCatalogCommand } from "./catalog-command-state";
import { useAdminScopeGuard } from "../../app/admin/admin-context-provider";
import { useAdminRouteGuard } from "./use-admin-route-guard";

function fields(sku: AdminCatalogSkuSummary) {
  return {
    name: sku.name,
    label: sku.merchandisingLabel ?? "",
    shippingGrams:
      sku.estimatedShippingWeightGrams === null ? "" : String(sku.estimatedShippingWeightGrams),
  };
}

export function SkuVariantEditor({
  sku,
  baseUnitCode,
  disabled,
  onSaved,
  onInteractionChange,
}: {
  sku: AdminCatalogSkuSummary;
  baseUnitCode: "GRAM" | "PIECE" | "MILLILITER";
  disabled?: boolean;
  onSaved: () => void;
  onInteractionChange?: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => fields(sku));
  const [notice, setNotice] = useState<string | null>(null);
  const command = useCatalogCommand(adminCatalogSkuSummarySchema);
  const frozen = command.pending || command.uncertain;
  useEffect(() => {
    onInteractionChange?.(open || frozen);
    return () => onInteractionChange?.(false);
  }, [open, frozen, onInteractionChange]);
  const dirty = open && JSON.stringify(value) !== JSON.stringify(fields(sku));
  useAdminScopeGuard(dirty, frozen, () => {
    setOpen(false);
    setValue(fields(sku));
  });
  useAdminRouteGuard(dirty, frozen);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (command.pending) return;
    const parsed = adminSkuUpdateBodySchema.safeParse({
      name: value.name,
      merchandisingLabel: value.label.trim() || null,
      expectedVersion: sku.version,
      ...(baseUnitCode === "PIECE" && value.shippingGrams.trim() !== ""
        ? { estimatedShippingWeightGrams: Number(value.shippingGrams) }
        : {}),
    });
    if (!parsed.success) {
      setNotice("Enter a name and a positive shipping weight where required.");
      return;
    }
    setNotice(null);
    try {
      // A transport retry keeps the original complete request and remains invisible.
      const result = await command
        .submit(`/api/admin/catalog/skus/${encodeURIComponent(sku.skuId)}`, parsed.data, "PATCH", {
          title: "Variant saved",
        })
        .catch(() => command.retry());
      if (!result) return;
      if (!result.ok) {
        setNotice(result.error.message);
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setNotice("The save could not be confirmed. Try Save again to check the same change.");
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (frozen) return;
        if (!next && dirty && !window.confirm("Discard this unsaved variant?")) return;
        if (next) {
          setValue(fields(sku));
          setNotice(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          aria-label={`Edit variant ${sku.name}`}
        >
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!frozen}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Edit variant</DialogTitle>
          <DialogDescription>
            {sku.name} consumes {sku.consumptionBaseQuantity.toLocaleString()}{" "}
            {baseUnitCode.toLowerCase()} from{" "}
            {sku.stockPoolId ? "this size’s counted stock" : "the shared product inventory"}.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
          <fieldset disabled={frozen}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`variant-name-${sku.skuId}`}>Display name</FieldLabel>
                <Input
                  id={`variant-name-${sku.skuId}`}
                  aria-label="Variant display name"
                  value={value.name}
                  maxLength={120}
                  required
                  onChange={(event) => setValue({ ...value, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`variant-label-${sku.skuId}`}>
                  Merchandising label (optional)
                </FieldLabel>
                <Input
                  id={`variant-label-${sku.skuId}`}
                  aria-label="Variant merchandising label"
                  value={value.label}
                  maxLength={60}
                  placeholder="Small bag"
                  onChange={(event) => setValue({ ...value, label: event.target.value })}
                />
              </Field>
              {baseUnitCode === "PIECE" ? (
                <Field>
                  <FieldLabel htmlFor={`variant-weight-${sku.skuId}`}>
                    Shipping weight for one sold unit (grams)
                  </FieldLabel>
                  <Input
                    id={`variant-weight-${sku.skuId}`}
                    aria-label="Variant shipping weight"
                    type="number"
                    min={1}
                    step={1}
                    value={value.shippingGrams}
                    onChange={(event) => setValue({ ...value, shippingGrams: event.target.value })}
                  />
                </Field>
              ) : null}
            </FieldGroup>
          </fieldset>
          {notice ? (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={frozen}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={command.pending}>
              {command.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
