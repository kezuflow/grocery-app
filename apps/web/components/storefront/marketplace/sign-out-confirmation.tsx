"use client";

import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "../../../lib/auth/auth-client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "../../ui/alert-dialog";

export function SignOutConfirmation({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign out failed");
      window.location.assign("/");
    } catch {
      setError("Couldn’t sign out. Please try again.");
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) {
          setError("");
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent
        className="fm-storefront max-w-sm rounded-xl bg-white"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <LogOut aria-hidden="true" className="size-6" />
        <AlertDialogTitle>Sign out?</AlertDialogTitle>
        <AlertDialogDescription>You can sign back in anytime.</AlertDialogDescription>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={() => {
              setError("");
              onOpenChange(false);
            }}
            className="min-h-11 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="min-h-11 rounded-lg bg-[var(--fm-primary-lime)] px-4 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <LogOut aria-hidden="true" className="size-5" />
        <span>Sign out</span>
      </button>
      <SignOutConfirmation open={open} onOpenChange={setOpen} />
    </>
  );
}
