"use client";

import type { AuthView } from "@better-auth-ui/core";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Auth } from "../../auth/auth";
import { FreshMarketsAuthProvider } from "../../auth/freshmarkets-auth-provider";

export function CheckoutAuthDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<AuthView>("signIn");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Checkout authentication"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm overflow-visible bg-transparent p-0 shadow-none backdrop:bg-black/45"
    >
      <div className="relative max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close authentication"
          className="absolute top-3 right-3 z-10 inline-flex size-9 items-center justify-center rounded-full hover:bg-[var(--fm-hover)]"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        <FreshMarketsAuthProvider redirectTo="/checkout" onAuthViewChange={setView}>
          <Auth
            view={view}
            socialLayout="vertical"
            socialPosition="bottom"
            className="max-w-none"
          />
        </FreshMarketsAuthProvider>
      </div>
    </dialog>
  );
}
