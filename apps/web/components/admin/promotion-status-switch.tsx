"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AdminPromotionSummary } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { cn } from "../../lib/utils";
import { useCatalogCommand } from "./catalog-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { adminStatusPillClassName } from "./admin-status-pill";
import { Switch } from "../ui/switch";

const statusLabels: Record<AdminPromotionSummary["status"], string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

/**
 * Switch control for promotion/sale rows. The switch sends the status command
 * directly; its checked position only follows Core-confirmed status, so it
 * never optimistically shows a state that has not been accepted by Core.
 */
export function PromotionStatusSwitch({
  promotion,
  onApplied,
}: {
  promotion: Pick<AdminPromotionSummary, "promotionId" | "name" | "status" | "version">;
  onApplied?(summary: AdminPromotionSummary): void;
}) {
  const command = useCatalogCommand(adminPromotionSummarySchema);
  const [error, setError] = useState<string | null>(null);

  if (promotion.status === "ARCHIVED") {
    return (
      <span className={cn(adminStatusPillClassName, "fm-admin-status-neutral")}>Archived</span>
    );
  }

  const active = promotion.status === "ACTIVE";
  const action = active ? "DEACTIVATE" : "ACTIVATE";

  async function commit() {
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
        setError(null);
        notifyCommandSuccess(
          active ? `${promotion.name} turned off` : `${promotion.name} turned on`,
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
    <div className="space-y-1">
      {command.pending ? (
        <span
          role="status"
          aria-label="Updating promotion status"
          className="inline-flex size-6 items-center justify-center text-[var(--fm-text-muted)]"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        </span>
      ) : (
        <Switch
          aria-label={`${promotion.name} ${active ? "on" : "off"}`}
          checked={active}
          onCheckedChange={() => void commit()}
          size="sm"
        />
      )}
      {error ? (
        <p role="alert" className="max-w-48 text-xs text-[var(--fm-destructive)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
