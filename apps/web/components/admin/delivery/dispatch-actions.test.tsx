import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { DispatchActions } from "./dispatch-actions";

const canceledManualDelivery: AdminDeliveryOperationView = {
  jobId: "job-1",
  orderId: "order-1",
  recipient: { name: null, phone: null },
  cycleId: "cycle-1",
  locationId: "location-1",
  fulfillmentMode: "SCHEDULED",
  status: "UNASSIGNED",
  manualActions: [],
  canRevisePromise: true,
  canInspectReturnedGoods: false,
  courierPickup: {
    allowedKinds: [],
    unavailableReason: "The current delivery deadline is unavailable or has passed.",
  },
  manualDelivery: {
    dispatchId: "dispatch-1",
    personName: "Previous rider",
    phoneE164: "+639171234567",
    selectionReason: "Prior manual delivery",
    note: null,
    status: "CANCELED",
    handedOverAt: null,
    returnInspectedAt: null,
    actualCostMinor: null,
    currency: null,
    version: 2,
  },
  externalDispatch: null,
  deliveredAtIso: null,
  version: 7,
};

describe("DispatchActions", () => {
  it("explains why a packed order cannot request Lalamove after a canceled manual attempt", () => {
    const markup = renderToStaticMarkup(
      <DispatchActions
        item={canceledManualDelivery}
        onBooked={vi.fn()}
        onChanged={vi.fn()}
        onInteractionState={vi.fn()}
      />,
    );

    expect(markup).toContain("Lalamove pickup unavailable");
    expect(markup).toContain(canceledManualDelivery.courierPickup.unavailableReason);
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Review Lalamove booking");
  });
});
