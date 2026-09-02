"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export function AdminCursorPagination({
  pageNumber,
  nextCursor,
  pending = false,
  onPrevious,
  onNext,
}: {
  pageNumber: number;
  nextCursor: string | null;
  pending?: boolean;
  onPrevious(): void;
  onNext(cursor: string): void;
}) {
  return (
    <nav
      aria-label="Results pagination"
      className="flex items-center justify-end gap-2 border-t p-3"
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || pageNumber <= 1}
        onClick={onPrevious}
      >
        Previous
      </Button>
      <span className="text-xs text-[var(--fm-text-muted)]">Page {pageNumber}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || nextCursor === null}
        onClick={() => nextCursor && onNext(nextCursor)}
      >
        Next
      </Button>
    </nav>
  );
}

export function useAdminPagination(resetKey: string | null = null) {
  const [pagination, setPagination] = useState<{
    key: string | null;
    cursors: ReadonlyArray<string | null>;
  }>({ key: resetKey, cursors: [null] });
  const cursors = pagination.key === resetKey ? pagination.cursors : [null];
  const cursor = cursors.at(-1) ?? null;
  useEffect(() => {
    setPagination((current) =>
      current.key === resetKey ? current : { key: resetKey, cursors: [null] },
    );
  }, [resetKey]);
  return {
    cursor,
    pageNumber: cursors.length,
    next(nextCursor: string) {
      setPagination((current) => ({
        key: resetKey,
        cursors: current.key === resetKey ? [...current.cursors, nextCursor] : [null, nextCursor],
      }));
    },
    previous() {
      setPagination((current) => {
        const currentCursors = current.key === resetKey ? current.cursors : [null];
        return {
          key: resetKey,
          cursors: currentCursors.length > 1 ? currentCursors.slice(0, -1) : currentCursors,
        };
      });
    },
    reset() {
      setPagination({ key: resetKey, cursors: [null] });
    },
  };
}

export function AdminConfirmationDialog({
  open,
  title,
  resource,
  scope,
  consequence,
  initialReason = "",
  reasonRequired = true,
  destructive = true,
  confirmLabel = "Confirm",
  cancelLabel = "Keep unchanged",
  restoreFocusRef,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  resource: string;
  scope: string;
  consequence: string;
  initialReason?: string;
  reasonRequired?: boolean;
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  pending?: boolean;
  onCancel(): void;
  onConfirm(reason: string): void;
}) {
  const [reason, setReason] = useState(initialReason);
  useEffect(() => {
    setReason(open ? initialReason : "");
  }, [initialReason, open]);
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent
        role="alertdialog"
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current) return;
          event.preventDefault();
          restoreFocusRef.current.focus();
        }}
      >
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <dl className="grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="font-medium">Resource</dt>
          <dd>{resource}</dd>
          <dt className="font-medium">Scope</dt>
          <dd>{scope}</dd>
        </dl>
        <AlertDialogDescription
          className={destructive ? "text-[var(--fm-destructive)]" : undefined}
        >
          {consequence}
        </AlertDialogDescription>
        {reasonRequired ? (
          <label className="grid gap-1 text-sm font-medium">
            Reason
            <Input
              aria-label="Confirmation reason"
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending}>
              {cancelLabel}
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending || (reasonRequired && reason.trim() === "")}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "Submitting…" : confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const ConfirmCommandDialog = AdminConfirmationDialog;

export function FilterBar({
  children,
  onSubmit,
  label = "Filters",
}: {
  children: ReactNode;
  onSubmit?: () => void;
  label?: string;
}) {
  return (
    <form
      aria-label={label}
      className="flex flex-wrap items-end gap-2 border-b p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      {children}
    </form>
  );
}
