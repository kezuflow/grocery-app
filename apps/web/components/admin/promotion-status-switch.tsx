"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AdminPromotionSummary } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { cn } from "../../lib/utils";
import { useCatalogCommand } from "./catalog-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { adminStatusPillClassName } from "./admin-status-pill";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";

const statusLabels: Record<AdminPromotionSummary["status"], string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

/**
 * Switch pill for promotion/sale rows. The switch opens a confirmation
 * popover, and the checked position only follows Core-confirmed status —
 * the pill never optimistically shows the new state while a command is pending.
 */
export function PromotionStatusSwitch({
  promotion,
  onApplied,
}: {
  promotion: Pick<AdminPromotionSummary, "promotionId" | "name" | "status" | "version">;
  onApplied?(summary: AdminPromotionSummary): void;
}) {
  const command = useCatalogCommand(adminPromotionSummarySchema);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (promotion.status === "ARCHIVED") {
    return (
      <span className={cn(adminStatusPillClassName, "fm-admin-status-neutral")}>Archived</span>
    );
  }

  const active = promotion.status === "ACTIVE";
  const action = active ? "DEACTIVATE" : "ACTIVATE";

  async function confirm() {
    setError(null);
    try {
      const payload = await command
        .submit(`/api/admin/promotions/${encodeURIComponent(promotion.promotionId)}/status`, {
          action,
          expectedVersion: promotion.version,
        })
        .catch(() => command.retry());
      if (!payload) return;
      if (payload.ok) {
        setOpen(false);
        notifyCommandSuccess(
          active ? `${promotion.name} deactivated` : `${promotion.name} activated`,
          `Status is now ${statusLabels[payload.value.status]}.`,
        );
        onApplied?.(payload.value);
      } else {
        setError(
          payload.error.requestId
            ? `${payload.error.message} (request ${payload.error.requestId})`
            : payload.error.message,
        );
      }
    } catch {
      setError(
        "The status change could not be confirmed. Confirm again to retry the same change safely.",
      );
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span
        className={cn(
          adminStatusPillClassName,
          "gap-2",
          active ? "fm-admin-status-success" : "fm-admin-status-neutral",
        )}
      >
        <PopoverTrigger asChild>
          <Switch
            aria-label={`${promotion.name} status`}
            checked={active}
            disabled={command.pending}
            size="sm"
          />
        </PopoverTrigger>
        {command.pending ? (
          <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
        ) : null}
        {statusLabels[promotion.status]}
      </span>
      <PopoverContent align="start" className="w-80 p-3">
        <p className="text-sm font-semibold">
          {active ? `Deactivate ${promotion.name}?` : `Activate ${promotion.name}?`}
        </p>
        <p className="mt-1 text-xs text-[var(--fm-text-muted)]">
          {active
            ? "Deactivating stops this promotion or sale for customers immediately."
            : "Activating applies this promotion or sale to customers immediately."}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-[var(--fm-destructive)]">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={command.pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={command.pending} onClick={() => void confirm()}>
            {command.pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            {active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
