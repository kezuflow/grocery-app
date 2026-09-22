import type { ReactNode } from "react";
import { AdminContextProvider } from "./admin-context-provider";
import { AdminOverviewProvider } from "./admin-overview-provider";
import { AdminShellBoundary } from "../../components/admin/admin-shell";
import { AdminThemeProvider } from "../../components/admin/admin-theme-provider";
import { AdminToaster } from "../../components/admin/admin-toaster";
import { AdminOperationalRefreshProvider } from "./admin-operational-refresh-provider";

/**
 * The admin layout owns the capability-aware shell. Navigation and scope
 * context come from Core through the context provider; individual workspace
 * pages render inside the shell without owning it.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminThemeProvider>
      <div className="fm-admin min-h-screen">
        <AdminContextProvider>
          <AdminOverviewProvider>
            <AdminOperationalRefreshProvider>
              <AdminShellBoundary>{children}</AdminShellBoundary>
            </AdminOperationalRefreshProvider>
          </AdminOverviewProvider>
        </AdminContextProvider>
        <AdminToaster />
      </div>
    </AdminThemeProvider>
  );
}
