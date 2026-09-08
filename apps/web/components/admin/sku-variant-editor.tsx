"use client";

import { useState, type FormEvent } from "react";
import type { AdminCatalogSkuSummary } from "@freshmarkets/contracts";
import { adminCatalogSkuSummarySchema, adminSkuUpdateBodySchema } from "@freshmarkets/validation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  AlertDialog as Dialog,
  AlertDialogContent as DialogContent,
  AlertDialogTrigger as DialogTrigger,
  AlertDialogTitle as DialogTitle,
  AlertDialogDescription as DialogDescription,
} from "../ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useCatalogCommand } from "./catalog-command-state";

function fields(sku: AdminCatalogSkuSummary) {
  return {
    name: sku.name,
    label: sku.merchandisingLabel ?? "",
    sortOrder: String(sku.sortOrder),
    status: sku.status,
    shippingGrams:
      sku.estimatedShippingWeightGrams === null ? "" : String(sku.estimatedShippingWeightGrams),
  };
}

export function SkuVariantEditor({
  sku,
  baseUnitCode,
  disabled,
  onSaved,
}: {
  sku: AdminCatalogSkuSummary;
  baseUnitCode: "GRAM" | "PIECE" | "MILLILITER";
  disabled?: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => fields(sku));
  const [notice, setNotice] = useState<string | null>(null);
  const command = useCatalogCommand(adminCatalogSkuSummarySchema);
  const frozen = command.pending || command.uncertain;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (command.pending) return;
    const parsed = adminSkuUpdateBodySchema.safeParse({
      name: value.name,
      merchandisingLabel: value.label.trim() || null,
      sortOrder: Number(value.sortOrder),
      status: value.status,
      expectedVersion: sku.version,
      ...(baseUnitCode === "PIECE" && value.shippingGrams.trim() !== ""
        ? { estimatedShippingWeightGrams: Number(value.shippingGrams) }
        : {}),
    });
    if (!parsed.success) {
      setNotice(
        "Enter a name, a whole display order, and a positive shipping weight where required.",
      );
      return;
    }
    setNotice(null);
    try {
      // A transport retry keeps the original complete request and remains invisible.
      const result = await command
        .submit(`/api/admin/catalog/skus/${encodeURIComponent(sku.skuId)}`, parsed.data, "PATCH")
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="space-y-2">
          <DialogTitle>Edit variant</DialogTitle>
          <DialogDescription>
            {sku.name} consumes {sku.consumptionBaseQuantity.toLocaleString()}{" "}
            {baseUnitCode.toLowerCase()} from the shared product inventory.
          </DialogDescription>
        </div>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <fieldset disabled={frozen} className="space-y-4">
            <label className="grid gap-1 text-sm font-medium">
              Display name
              <Input
                aria-label="Variant display name"
                value={value.name}
                maxLength={120}
                required
                onChange={(event) => setValue({ ...value, name: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Merchandising label (optional)
              <Input
                aria-label="Variant merchandising label"
                value={value.label}
                maxLength={60}
                placeholder="Small bag"
                onChange={(event) => setValue({ ...value, label: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Display order
              <Input
                aria-label="Variant display order"
                type="number"
                min={0}
                max={10000}
                step={1}
                required
                value={value.sortOrder}
                onChange={(event) => setValue({ ...value, sortOrder: event.target.value })}
              />
            </label>
            <div className="space-y-1 text-sm font-medium">
              Catalog status
              <Select
                value={value.status}
                disabled={frozen}
                onValueChange={(status) => {
                  if (status === "active" || status === "inactive") setValue({ ...value, status });
                }}
              >
                <SelectTrigger aria-label="Variant catalog status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs font-normal text-muted-foreground">
                Inactive variants are unavailable at every location. Local selling status is managed
                separately.
              </p>
            </div>
            {baseUnitCode === "PIECE" ? (
              <label className="grid gap-1 text-sm font-medium">
                Shipping weight for one sold unit (grams)
                <Input
                  aria-label="Variant shipping weight"
                  type="number"
                  min={1}
                  step={1}
                  value={value.shippingGrams}
                  onChange={(event) => setValue({ ...value, shippingGrams: event.target.value })}
                />
              </label>
            ) : null}
          </fieldset>
          {notice ? (
            <p role="alert" className="text-sm">
              {notice}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
