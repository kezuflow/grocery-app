import type { ReactNode } from "react";
import { LocationSetupNavigation } from "@/components/admin/location-setup-navigation";
import { LocationSetupProvider } from "@/components/admin/location-setup-state";

export default async function LocationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  return (
    <LocationSetupProvider key={locationId} locationId={locationId}>
      <div className="space-y-4">
        <LocationSetupNavigation locationId={locationId} />
        {children}
      </div>
    </LocationSetupProvider>
  );
}
