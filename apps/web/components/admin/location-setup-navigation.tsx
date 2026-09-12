"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function LocationSetupNavigation({ locationId }: { locationId: string }) {
  const pathname = usePathname();
  const base = `/admin/locations/${encodeURIComponent(locationId)}`;
  return (
    <div className="space-y-3">
      <Link href="/admin/locations" className="text-sm underline">
        All locations
      </Link>
      <nav aria-label="Location setup" className="flex flex-wrap gap-2 border-b pb-3">
        {[
          ["", "Address and pin"],
          ["/pickup", "Courier pickup"],
          ["/schedule", "Operating hours"],
          ["/fulfillment", "Dispatch readiness"],
        ].map(([path, label]) => (
          <Link
            key={path}
            href={`${base}${path}`}
            aria-current={pathname === `${base}${path}` ? "page" : undefined}
            className="rounded px-3 py-2 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
