"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { AdminPromotionSummary } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { useCatalogCommand } from "./catalog-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Badge } from "./shadcn/badge";
import { Switch } from "@/components/admin/shadcn/switch";
import { cn } from "@/lib/utils";

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

export function PromotionStatusText({ status }: { status: AdminPromotionSummary["status"] }) {
  return (
    <span data-promotion-status-text className="cursor-default text-sm text-foreground">
      {statusLabels[status]}
    </span>
  );
}

/**
 * Promotion/sale status control. The switch sends the status command; its
 * displayed state follows Core confirmation, never an optimistic status.
 */
export function PromotionStatusSwitch({
  promotion,
  onApplied,
  showStatusText = false,
}: {
  promotion: Pick<AdminPromotionSummary, "promotionId" | "name" | "status" | "version">;
  onApplied?(summary: AdminPromotionSummary): void;
  showStatusText?: boolean;
}) {
  const command = useCatalogCommand(adminPromotionSummarySchema);
  const [error, setError] = useState<string | null>(null);

  if (promotion.status === "ARCHIVED") {
    return showStatusText ? (
      <PromotionStatusText status="ARCHIVED" />
    ) : (
      <PromotionStatusPill status="ARCHIVED" />
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
    <div className="flex flex-col gap-1">
      <span
        data-pending={command.pending}
        aria-busy={showStatusText && command.pending}
        className={cn(
          "relative inline-flex items-center justify-center",
          !showStatusText && "fm-status-switch size-6",
        )}
      >
        <span
          className={cn(
            !showStatusText && "fm-status-switch-control",
            showStatusText && "inline-flex items-center gap-2",
          )}
          aria-hidden={!showStatusText && command.pending}
          inert={!showStatusText && command.pending}
        >
          {showStatusText ? <PromotionStatusText status={promotion.status} /> : null}
          <Switch
            data-promotion-status-switch={showStatusText || undefined}
            data-status={showStatusText ? promotion.status : undefined}
            aria-label={`${promotion.name} ${active ? "on" : "off"}`}
            checked={active}
            disabled={command.pending}
            onCheckedChange={() => void commit()}
            size={showStatusText ? "default" : "sm"}
          />
        </span>
        {!showStatusText ? (
          <span
            role={command.pending ? "status" : undefined}
            aria-label={command.pending ? "Updating promotion status" : undefined}
            aria-hidden={!command.pending}
            className="fm-status-switch-spinner pointer-events-none absolute inset-0 inline-flex items-center justify-center text-muted-foreground"
          >
            <LoaderCircle
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          </span>
        ) : null}
      </span>
      {error ? (
        <p role="alert" className="max-w-48 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
