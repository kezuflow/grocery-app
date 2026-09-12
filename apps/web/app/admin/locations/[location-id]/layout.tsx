import type { ReactNode } from "react";
import { LocationSetupNavigation } from "@/components/admin/location-setup-navigation";

export default async function LocationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  return (
    <div className="space-y-4">
      <LocationSetupNavigation locationId={locationId} />
      {children}
    </div>
  );
}
