"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AdminPromotionSummary } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { useCatalogCommand } from "./catalog-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Badge } from "./shadcn/badge";
import { Switch } from "@/components/admin/shadcn/switch";

const statusLabels: Record<AdminPromotionSummary["status"], string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ARCHIVED: "Archived",
};

export function PromotionStatusPill({ status }: { status: AdminPromotionSummary["status"] }) {
  return (
    <Badge variant="outline" data-promotion-status-pill data-status={status}>
      {statusLabels[status]}
    </Badge>
  );
}

/**
 * Promotion/sale status control. The switch or pill sends the same status
 * command; its displayed state follows Core confirmation, never an optimistic
 * status that Core has not accepted.
 */
export function PromotionStatusSwitch({
  promotion,
  onApplied,
  presentation = "switch",
}: {
  promotion: Pick<AdminPromotionSummary, "promotionId" | "name" | "status" | "version">;
  onApplied?(summary: AdminPromotionSummary): void;
  presentation?: "switch" | "pill";
}) {
  const command = useCatalogCommand(adminPromotionSummarySchema);
  const [error, setError] = useState<string | null>(null);

  if (promotion.status === "ARCHIVED") {
    return <PromotionStatusPill status="ARCHIVED" />;
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
      <span
        data-pending={command.pending}
        className={
          presentation === "pill"
            ? "fm-status-switch relative inline-flex items-center justify-center"
            : "fm-status-switch relative inline-flex size-6 items-center justify-center"
        }
      >
        <span
          className="fm-status-switch-control"
          aria-hidden={command.pending}
          inert={command.pending}
        >
          {presentation === "pill" ? (
            <Badge asChild variant="outline" className="min-h-8 min-w-20 cursor-pointer px-3 py-1">
              <button
                type="button"
                data-promotion-status-pill
                data-status={promotion.status}
                aria-label={`${active ? "Deactivate" : "Activate"} ${promotion.name} (${statusLabels[promotion.status]})`}
                disabled={command.pending}
                onClick={() => void commit()}
              >
                {statusLabels[promotion.status]}
              </button>
            </Badge>
          ) : (
            <Switch
              aria-label={`${promotion.name} ${active ? "on" : "off"}`}
              checked={active}
              disabled={command.pending}
              onCheckedChange={() => void commit()}
              size="sm"
            />
          )}
        </span>
        <span
          role={command.pending ? "status" : undefined}
          aria-label={command.pending ? "Updating promotion status" : undefined}
          aria-hidden={!command.pending}
          className="fm-status-switch-spinner absolute inset-0 inline-flex items-center justify-center text-muted-foreground"
        >
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        </span>
      </span>
      {error ? (
        <p role="alert" className="max-w-48 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
