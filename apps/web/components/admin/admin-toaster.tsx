"use client";

import { Toaster } from "../ui/sonner";
import { useAdminTheme } from "./admin-theme-provider";

/**
 * Renders inside the `.fm-admin` scope (sonner does not portal), so toast
 * colors follow the admin tokens including the persisted dark appearance.
 */
export function AdminToaster() {
  const { theme } = useAdminTheme();
  return <Toaster theme={theme} position="bottom-right" closeButton={false} />;
}
