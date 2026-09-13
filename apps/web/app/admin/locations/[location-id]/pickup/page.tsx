import { LocationPickupStep } from "@/components/admin/location-setup-steps";

export default async function LocationPickupPage({
  params,
}: {
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  return <LocationPickupStep key={locationId} locationId={locationId} reuseLocationAddress />;
}
