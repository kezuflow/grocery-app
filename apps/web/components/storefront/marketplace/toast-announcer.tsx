"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleAlert } from "lucide-react";
import { STOREFRONT_TOAST_EVENT } from "../../../lib/storefront/cart-client";
import type { StorefrontToast } from "../../../lib/storefront/cart-client";

/**
 * Single visible toast plus an polite live region for storefront feedback.
 * Announcements originate from commerce components via STOREFRONT_TOAST_EVENT;
 * authentication prompts keep browsing context instead of redirecting away.
 */
export function ToastAnnouncer() {
  const [toast, setToast] = useState<StorefrontToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<StorefrontToast>).detail;
      setToast(detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 4200);
    };
    window.addEventListener(STOREFRONT_TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(STOREFRONT_TOAST_EVENT, onToast);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6"
    >
      {toast ? (
        <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] bg-white px-4 py-3 text-sm shadow-[var(--fm-shadow-popover)]">
          {toast.tone === "success" ? (
            <CircleCheck className="size-5 shrink-0 text-[var(--fm-success)]" aria-hidden="true" />
          ) : (
            <CircleAlert
              className="size-5 shrink-0 text-[var(--fm-destructive)]"
              aria-hidden="true"
            />
          )}
          <span>{toast.message}</span>
          {toast.signInHref ? (
            <Link
              href={toast.signInHref}
              className="shrink-0 font-semibold text-[var(--fm-primary-dark)] underline underline-offset-4"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
