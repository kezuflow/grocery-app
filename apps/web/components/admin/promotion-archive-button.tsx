"use client";

import { useState } from "react";
import type { AdminPromotionSummary } from "@freshmarkets/contracts";
import { adminPromotionSummarySchema } from "@freshmarkets/validation";
import { useCatalogCommand } from "./catalog-command-state";
import { notifyCommandSuccess } from "./admin-feedback";
import { Button } from "./shadcn/button";
import { Alert, AlertDescription, AlertTitle } from "./shadcn/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./shadcn/alert-dialog";

export function PromotionArchiveButton({
  promotion,
  onApplied,
}: {
  promotion: AdminPromotionSummary;
  onApplied(summary: AdminPromotionSummary): void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useCatalogCommand(adminPromotionSummarySchema);
  const allowed = promotion.status === "DRAFT" || promotion.status === "INACTIVE";
  const locked = command.pending || command.uncertain;

  async function archive() {
    if (command.pending || (!allowed && !command.uncertain)) return;
    setError(null);
    try {
      const result = await command
        .submit(`/api/admin/promotions/${encodeURIComponent(promotion.promotionId)}/status`, {
          action: "ARCHIVE",
          expectedVersion: promotion.version,
        })
        .catch(() => command.retry());
      if (!result) return;
      if (result.ok) {
        setOpen(false);
        notifyCommandSuccess(`${result.value.name} is archived`);
        onApplied(result.value);
      } else {
        setError(`${result.error.message} (request ${result.error.requestId})`);
      }
    } catch {
      setError("Archiving could not be confirmed. Retry to check the same archive request safely.");
    }
  }

  if (promotion.status === "ARCHIVED" && !open) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!locked) {
          setOpen(next);
          setError(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!allowed || locked}
          title={!allowed ? "Deactivate this code before archiving" : undefined}
          aria-label={`Archive ${promotion.code}`}
        >
          Archive
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive promotion code?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="break-all">{promotion.code}</span> will no longer be usable or
            editable. Archiving cannot be undone. Its usage and redemption history will be kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Archive not confirmed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={locked}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={command.pending || (!allowed && !command.uncertain)}
            onClick={(event) => {
              event.preventDefault();
              void archive();
            }}
          >
            {command.pending
              ? "Archiving…"
              : command.uncertain
                ? "Retry archive"
                : "Confirm archive"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
