import { LocationReviewStep } from "@/components/admin/location-review-step";
export default async function LocationFulfillmentPage({
  params,
}: {
  params: Promise<{ "location-id": string }>;
}) {
  const { "location-id": locationId } = await params;
  return <LocationReviewStep key={locationId} locationId={locationId} />;
}
