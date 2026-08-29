"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

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

export function useAdminPagination() {
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const cursor = cursors.at(-1) ?? null;
  return {
    cursor,
    pageNumber: cursors.length,
    next(nextCursor: string) {
      setCursors((current) => [...current, nextCursor]);
    },
    previous() {
      setCursors((current) => (current.length > 1 ? current.slice(0, -1) : current));
    },
    reset() {
      setCursors([null]);
    },
  };
}

export function AdminConfirmationDialog({
  open,
  title,
  resource,
  scope,
  consequence,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  resource: string;
  scope: string;
  consequence: string;
  pending?: boolean;
  onCancel(): void;
  onConfirm(reason: string): void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <section
        aria-describedby="admin-confirmation-impact"
        aria-labelledby="admin-confirmation-title"
        aria-modal="true"
        role="alertdialog"
        className="w-full max-w-lg space-y-4 rounded-[var(--fm-radius-surface)] bg-white p-5 shadow-xl"
      >
        <h2 id="admin-confirmation-title" className="text-lg font-semibold">
          {title}
        </h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-[7rem_1fr]">
          <dt className="font-medium">Resource</dt>
          <dd>{resource}</dd>
          <dt className="font-medium">Scope</dt>
          <dd>{scope}</dd>
        </dl>
        <p id="admin-confirmation-impact" className="text-sm text-[var(--fm-destructive)]">
          {consequence}
        </p>
        <label className="grid gap-1 text-sm font-medium">
          Reason
          <Input
            aria-label="Confirmation reason"
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            Keep unchanged
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || reason.trim() === ""}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? "Submitting…" : "Confirm"}
          </Button>
        </div>
      </section>
    </div>
  );
}
