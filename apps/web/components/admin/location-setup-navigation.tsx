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
      "Operating hours",
      data?.hours ? (data.hours.schedule?.weekly.length ? "Saved" : "Incomplete") : "Unavailable",
    ],
    [
      "/fulfillment",
      "Review and enable",
      data?.readiness ? (data.readiness.dispatchReady ? "Ready" : "Not ready") : "Unavailable",
    ],
  ];
  const current = Math.max(
    0,
    steps.findIndex(([path]) => pathname === `${base}${path}`),
  );
  return (
    <div className="space-y-3">
      <Link {...guardedLink} href="/admin/locations" className="text-sm underline">
        All locations
      </Link>
      <p className="font-medium">
        {data?.location?.name ?? "Location setup"} · Step {current + 1} of 4
      </p>
      <p className="text-sm text-muted-foreground">
        Save each step to continue. You can return to any step to review its saved settings.
      </p>
      <nav aria-label="Location setup steps" className="grid gap-2 border-b pb-3 sm:grid-cols-4">
        {steps.map(([path, label, status], index) => (
          <Link
            {...guardedLink}
            key={path}
            href={`${base}${path}`}
            aria-current={pathname === `${base}${path}` ? "page" : undefined}
            className="rounded px-3 py-2 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
          >
            <span className="block">
              {index + 1}. {label}
            </span>
            <span className="block text-xs text-muted-foreground">
              {loading ? "Checking…" : status}
            </span>
          </Link>
        ))}
      </nav>
      {current > 0 && (
        <Link
          {...guardedLink}
          className="inline-block text-sm underline"
          href={`${base}${steps[current - 1][0]}`}
        >
          Back to {steps[current - 1][1]}
        </Link>
      )}
    </div>
  );
}
