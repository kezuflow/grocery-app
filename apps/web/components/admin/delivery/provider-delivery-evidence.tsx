import type { AdminDeliveryOperationView } from "@freshmarkets/contracts";
import { Alert, AlertTitle, AlertDescription } from "@/components/admin/shadcn/alert";

/** Scoped staff evidence only; backend missing-proof flags are never rendered. */
export function ProviderDeliveryEvidence({
  dispatch,
}: {
  dispatch: NonNullable<AdminDeliveryOperationView["externalDispatch"]>;
}) {
  return (
    <div className="space-y-2">
      {dispatch.custodyReviewRequired ? (
        <Alert>
          <AlertTitle>Driver reassignment after pickup</AlertTitle>
          <AlertDescription>
            Confirm package custody with the courier. Handover remains recorded and delivery
            progress continues.
          </AlertDescription>
        </Alert>
      ) : null}
      {dispatch.replacementPending ? (
        <Alert>
          <AlertTitle>Courier replacement pending</AlertTitle>
          <AlertDescription>
            Waiting for Lalamove to confirm the replacement booking.
          </AlertDescription>
        </Alert>
      ) : null}
      {dispatch.routeReviewRequired ? (
        <Alert>
          <AlertTitle>Courier booking edited</AlertTitle>
          <AlertDescription>
            Check the provider booking against the saved delivery address and contact.
          </AlertDescription>
        </Alert>
      ) : null}
      {dispatch.proofs?.map((proof, index) => (
        <div key={index} className="text-xs text-muted-foreground">
          {proof.kind === "PICKUP" ? "Pickup proof" : "Delivery proof"}: {proof.status}
          {proof.imageUrls.map((url, imageIndex) => (
            <a
              key={url}
              className="ml-2 underline"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              View evidence {imageIndex + 1}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}
