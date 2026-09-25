"use client";

import Link from "next/link";
import { PageHeader } from "../../../components/admin/admin-shell";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { adminNavigationItemsForScope } from "../../../components/admin/admin-navigation";
import { useAdminContext } from "../admin-context-provider";

const descriptions: Record<string, string> = {
  locations: "Manage fulfillment sites, pickup pins, operating hours, and readiness.",
  "locations-service-areas": "Draw the global areas where customers can request fulfillment.",
  "fulfillment-mode": "Choose the active selling mode and review readiness.",
  "scheduled-cycles": "Plan ordering periods and customer delivery ranges.",
};

export default function FulfillmentSetupPage() {
  const { state } = useAdminContext();
  if (state.phase !== "ready") return null;
  const destinations = adminNavigationItemsForScope(
    state.context.navigation,
    state.selectedScope,
  ).filter((item) => item.parentCode === "fulfillment-setup");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fulfillment setup"
        description="Configure where FreshMarkets serves customers, which locations fulfill orders, and when each mode is available."
      />
      {destinations.length === 0 ? (
        <AdminPageState
          state="permission-empty"
          title="Fulfillment setup is unavailable"
          message="Select an authorized scope or ask an administrator for access."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {destinations.map((item) => (
            <Link
              key={item.code}
              href={item.href}
              className="rounded-lg border border-[var(--fm-border)] bg-[var(--fm-admin-surface)] p-5 hover:bg-[var(--fm-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fm-focus)]"
            >
              <h2 className="font-medium">{item.label}</h2>
              <p className="mt-2 text-sm text-[var(--fm-text-muted)]">{descriptions[item.code]}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
