import { LocationDeliveryProfilePanel } from "@/components/admin/delivery/location-delivery-profile-panel";

export default async function LocationPickupPage({
  params,
}: {
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  return <LocationDeliveryProfilePanel key={locationId} locationId={locationId} />;
}
