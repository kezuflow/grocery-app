"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocationSetup } from "./location-setup-state";

export function LocationSetupNavigation({ locationId }: { locationId: string }) {
  const pathname = usePathname();
  const base = `/admin/locations/${encodeURIComponent(locationId)}`;
  const { data, loading, navigationLocked } = useLocationSetup();
  const guardedLink = {
    "aria-disabled": navigationLocked,
    tabIndex: navigationLocked ? -1 : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (navigationLocked) event.preventDefault();
    },
  };
  const steps = [
    [
      "",
      "Location",
      data?.location ? (data.location.address ? "Saved" : "Incomplete") : "Unavailable",
    ],
    [
      "/pickup",
      "Pickup contact",
      data?.pickup ? (data.pickup.profile ? "Saved" : "Incomplete") : "Unavailable",
    ],
    [
      "/schedule",
      "Instant operating hours",
      data?.hours ? (data.hours.schedule?.weekly.length ? "Saved" : "Incomplete") : "Unavailable",
    ],
    [
      "/fulfillment",
      "Review and enable",
      data?.location && data.readiness
        ? data.location.status !== "active"
          ? "Activation needed"
          : data.readiness.dispatchReady
            ? "Ready"
            : "Dispatch not ready"
        : "Unavailable",
    ],
  ];
  const current = Math.max(
    0,
    steps.findIndex(([path]) => pathname === `${base}${path}`),
  );
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Link
          {...guardedLink}
          href="/admin/locations"
          className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
        >
          ← All locations
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xl font-semibold tracking-tight">
            {data?.location?.name ?? "Location setup"}
          </p>
          <span className="text-xs font-medium text-muted-foreground">Step {current + 1} of 4</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Save each step before continuing. Instant also requires operating hours; Scheduled uses
          its cycle timing. You can return to review saved settings.
        </p>
      </div>
      <nav aria-label="Location setup steps" className="grid gap-2 sm:grid-cols-4">
        {steps.map(([path, label, status], index) => (
          <Link
            {...guardedLink}
            key={path}
            href={`${base}${path}`}
            aria-current={pathname === `${base}${path}` ? "page" : undefined}
            className="rounded-xl border border-border bg-[var(--fm-admin-surface)] px-3 py-3 text-sm transition-colors hover:bg-muted aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
          >
            <span className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                {index + 1}
              </span>
              {label}
            </span>
            <span className="mt-2 block pl-8 text-xs text-muted-foreground">
              {loading ? "Checking…" : status}
            </span>
          </Link>
        ))}
      </nav>
      {current > 0 && (
        <Link
          {...guardedLink}
          className="inline-block text-sm font-medium underline-offset-4 hover:underline"
          href={`${base}${steps[current - 1][0]}`}
        >
          Back to {steps[current - 1][1]}
        </Link>
      )}
    </div>
  );
}
