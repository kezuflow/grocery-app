"use client";
import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { supplierPurchaseListSchema, z } from "@freshmarkets/validation";
import { Button } from "./shadcn/button";
import { Alert, AlertDescription } from "./shadcn/alert";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "./shadcn/dropdown-menu";

const responseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: supplierPurchaseListSchema }),
  z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
]);

export function SupplierExport({
  cycleId,
  locationId,
  disabled,
}: {
  cycleId: string;
  locationId?: string;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function download(format: "pdf" | "xlsx") {
    if (controller.current || disabled) return;
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cycleId });
      if (locationId) params.set("locationId", locationId);
      const response = await fetch(`/api/admin/procurement/supplier-list?${params}`, {
        signal: current.signal,
        cache: "no-store",
      });
      const result = responseSchema.parse(await response.json());
      if (!result.ok) throw new Error(result.error.message);
      if (!result.value.items.length)
        throw new Error("There are no paid products to export for this week.");
      const { createSupplierFile } = await import("../../lib/admin/supplier-export");
      const bytes = await createSupplierFile(result.value, format);
      if (current.signal.aborted) return;
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type:
            format === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `freshmarkets-supplier-list-${result.value.cycleName.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.${format}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not export the supplier list. Please try again.",
        );
    } finally {
      if (!current.signal.aborted) {
        controller.current = null;
        setPending(false);
      }
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={disabled || pending}>
            <Download data-icon="inline-start" />
            {pending ? "Preparing export…" : "Export supplier list"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="fm-admin" align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void download("pdf")}>PDF document</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void download("xlsx")}>
              Excel workbook
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Preparing all paid products for this week.
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
