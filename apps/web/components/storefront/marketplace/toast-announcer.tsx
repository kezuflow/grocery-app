"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { STOREFRONT_TOAST_EVENT } from "../../../lib/storefront/cart-client";
import type { StorefrontToast } from "../../../lib/storefront/cart-client";
import { Toaster } from "../../ui/sonner";

/**
 * Single visible toast plus a polite live region for storefront feedback.
 * Announcements originate from commerce components via STOREFRONT_TOAST_EVENT;
 * authentication prompts keep browsing context instead of redirecting away.
 */
export function ToastAnnouncer() {
  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<StorefrontToast>).detail;
      const options = {
        duration: 4_200,
        action: detail.signInHref
          ? {
              label: "Sign in",
              onClick: () => window.location.assign(detail.signInHref!),
            }
          : undefined,
      };
      if (detail.tone === "success") toast.success(detail.message, options);
      else toast.error(detail.message, options);
    };
    window.addEventListener(STOREFRONT_TOAST_EVENT, onToast);
    return () => window.removeEventListener(STOREFRONT_TOAST_EVENT, onToast);
  }, []);

  return (
    <Toaster
      position="bottom-center"
      closeButton={false}
      visibleToasts={1}
      mobileOffset={{ bottom: 80 }}
    />
  );
}
