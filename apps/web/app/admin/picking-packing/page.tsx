"use client";

import { useSearchParams } from "next/navigation";
import { FulfillmentWorkspace } from "../fulfillment/page";
import { useAdminContext } from "../admin-context-provider";
import { AdminPageState } from "../../../components/admin/admin-page-state";
import { PageHeader } from "../../../components/admin/admin-shell";
import { Button } from "@/components/admin/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/shadcn/card";

/** A location link is a scope request; Core still authorizes every queue read and command. */
export default function PickingPackingPage() {
  const requestedLocationId = useSearchParams().get("locationId");
  const { state, selectScope } = useAdminContext();
  if (state.phase !== "ready") return null;
  if (!requestedLocationId) return <FulfillmentWorkspace presentation="station" />;

  const location = state.scopes.find(
    (scope) => scope.kind === "location" && scope.locationId === requestedLocationId,
  );
  if (!state.context.capabilities.includes("fulfillment.read") || location?.kind !== "location")
    return (
      <AdminPageState
        state="permission-empty"
        title="Picking and packing is unavailable"
        message="This fulfillment location is not assigned to your staff account."
      />
    );

  if (
    state.selectedScope?.kind === "LOCATION" &&
    state.selectedScope.locationId === requestedLocationId
  )
    return <FulfillmentWorkspace presentation="station" />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Picking & packing"
        description="Open the paid-order preparation station for your assigned fulfillment location."
      />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{location.locationName}</CardTitle>
          <CardDescription>
            Switch to this location to view its paid orders and available preparation actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="lg"
            onClick={() =>
              selectScope({
                kind: "LOCATION",
                marketId: location.marketId,
                locationId: location.locationId,
              })
            }
          >
            Open picking & packing
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
