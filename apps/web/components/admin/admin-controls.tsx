"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../ui/alert-dialog";

/** Compact view tabs shared by real Admin index pages. */
export function AdminIndexViews<T extends string>({
  label,
  views,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  views: ReadonlyArray<{ label: string; status: T }>;
  value: T;
  onChange(status: T): void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      className="flex min-h-14 items-end gap-1 overflow-x-auto border-b border-[var(--fm-border)] px-3 pt-2"
      aria-label={label}
    >
      {views.map((view) => (
        <button
          type="button"
          key={view.label}
          aria-pressed={value === view.status}
          disabled={disabled}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors disabled:opacity-50",
            value === view.status
              ? "border-[var(--fm-text)] text-[var(--fm-text)]"
              : "border-transparent text-[var(--fm-text-muted)] hover:text-[var(--fm-text)]",
          )}
          onClick={() => onChange(view.status)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

export function AdminCursorPagination({
  pageNumber,
  nextCursor,
  pending = false,
  onPrevious,
  onNext,
  onPage,
}: {
  pageNumber: number;
  nextCursor: string | null;
  pending?: boolean;
  onPrevious(): void;
  onNext(cursor: string): void;
  onPage?(pageNumber: number): void;
}) {
  const lastKnownPage = pageNumber + (nextCursor === null ? 0 : 1);
  const numberedPages =
    lastKnownPage <= 7
      ? Array.from({ length: lastKnownPage }, (_, index) => index + 1)
      : [...new Set([1, pageNumber - 1, pageNumber, pageNumber + 1, lastKnownPage])]
          .filter((page) => page >= 1 && page <= lastKnownPage)
          .sort((a, b) => a - b);
  return (
    <nav
      aria-label="Results pagination"
      className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--fm-border)] p-3"
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
      {onPage ? (
        <div className="flex items-center gap-1" aria-label="Page numbers">
          {numberedPages.map((page, index) => (
            <div key={page} className="flex items-center gap-1">
              {index > 0 && page - numberedPages[index - 1]! > 1 ? (
                <span aria-hidden="true" className="px-1 text-[var(--fm-text-muted)]">
                  …
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant={page === pageNumber ? "default" : "outline"}
                className="min-w-9"
                aria-label={`Page ${page}`}
                aria-current={page === pageNumber ? "page" : undefined}
                disabled={pending}
                onClick={() => {
                  if (page === pageNumber) return;
                  if (page === pageNumber + 1) {
                    if (nextCursor) onNext(nextCursor);
                  } else {
                    onPage(page);
                  }
                }}
              >
                {page}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <span className="text-xs text-[var(--fm-text-muted)]">Page {pageNumber}</span>
      )}
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
    previousCursor: cursors.length > 1 ? (cursors.at(-2) ?? null) : null,
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

/** URL-owned cursor history for SPA lists; Back/Forward restores the exact page. */
export function useAdminUrlPagination(pathname: string) {
  const searchParams = useSearchParams();
  const cursor = searchParams.get("cursor");
  const history = searchParams.getAll("cursorHistory");
  const navigate = (params: URLSearchParams) => {
    window.history.pushState(null, "", `${pathname}${params.size ? `?${params}` : ""}`);
  };
  return {
    cursor,
    pageNumber: history.length + 1,
    previousCursor: history.length > 0 ? history.at(-1) || null : null,
    next(nextCursor: string) {
      const next = new URLSearchParams(searchParams.toString());
      next.append("cursorHistory", cursor ?? "");
      next.set("cursor", nextCursor);
      navigate(next);
    },
    goToPage(pageNumber: number) {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > history.length + 1)
        return;
      if (pageNumber === history.length + 1) return;
      const next = new URLSearchParams(searchParams.toString());
      next.delete("cursorHistory");
      for (const prior of history.slice(0, pageNumber - 1)) next.append("cursorHistory", prior);
      const pageCursor = pageNumber === 1 ? null : history[pageNumber - 1];
      if (pageCursor) next.set("cursor", pageCursor);
      else next.delete("cursor");
      navigate(next);
    },
    previous() {
      if (history.length === 0) return;
      const next = new URLSearchParams(searchParams.toString());
      next.delete("cursorHistory");
      for (const prior of history.slice(0, -1)) next.append("cursorHistory", prior);
      const previousCursor = history.at(-1);
      if (previousCursor) next.set("cursor", previousCursor);
      else next.delete("cursor");
      navigate(next);
    },
    reset(params: URLSearchParams) {
      params.delete("cursor");
      params.delete("cursorHistory");
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
  maxReasonLength,
  reasonLocked = false,
  error,
  destructive = true,
  confirmLabel = "Confirm",
  cancelLabel = "Keep unchanged",
  restoreFocusRef,
  pending,
  cancelDisabled = false,
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
  maxReasonLength?: number;
  reasonLocked?: boolean;
  error?: string;
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  pending?: boolean;
  cancelDisabled?: boolean;
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
        {error && (
          <p role="alert" className="text-sm text-[var(--fm-destructive)]">
            {error}
          </p>
        )}
        {reasonRequired ? (
          <label className="grid gap-1 text-sm font-medium">
            Reason
            <Input
              aria-label="Confirmation reason"
              autoFocus
              disabled={pending || reasonLocked}
              maxLength={maxReasonLength}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={pending || cancelDisabled}>
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

/**
 * The one admin filter toolbar. `section` attaches under a ListPageSection
 * header; `card` renders the standalone bordered toolbar used above sections.
 */
export function FilterBar({
  children,
  onSubmit,
  label = "Filters",
  variant = "section",
}: {
  children: ReactNode;
  onSubmit?: () => void;
  label?: string;
  variant?: "section" | "card";
}) {
  return (
    <form
      aria-label={label}
      className={cn(
        variant === "card" &&
          "flex flex-col gap-3 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-3 sm:flex-row sm:flex-wrap sm:items-center",
        variant === "section" && "flex flex-wrap items-end gap-2 border-b p-4",
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      {children}
    </form>
  );
}
