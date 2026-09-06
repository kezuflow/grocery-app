import { ExternalDeliveryQueue } from "../../../components/admin/delivery/external-delivery-queue";
import { LocationDeliveryProfilePanel } from "../../../components/admin/delivery/location-delivery-profile-panel";

export default function DeliveryPage() {
  return (
    <div className="space-y-4">
      <LocationDeliveryProfilePanel />
      <ExternalDeliveryQueue />
    </div>
  );
}
