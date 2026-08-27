import type { ReactNode } from "react";
import { AdminContextProvider } from "./admin-context-provider";
import { AdminShellBoundary } from "../../components/admin/admin-shell";

/**
 * The admin layout owns the capability-aware shell. Navigation and scope
 * context come from Core through the context provider; individual workspace
 * pages render inside the shell without owning it.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminContextProvider>
      <AdminShellBoundary>{children}</AdminShellBoundary>
    </AdminContextProvider>
  );
}
