import type { DeliveryTrackingView } from "@freshmarkets/contracts";
import { Button } from "@/components/admin/shadcn/button";
import { Separator } from "@/components/admin/shadcn/separator";

export function RiderContact({
  contact,
  recipient,
}: {
  contact: DeliveryTrackingView["riderContact"];
  recipient?: { name: string | null; phone: string | null };
}) {
  const phone = contact?.phone && /^\+?\d{7,15}$/.test(contact.phone) ? contact.phone : null;
  const recipientPhone =
    recipient?.phone && /^\+?\d{7,15}$/.test(recipient.phone) ? recipient.phone : null;
  return (
    <div className="flex flex-col gap-4">
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Lalamove rider</p>
          <p className="text-sm text-muted-foreground">
            {contact?.name || "Rider contact is not available yet."}
          </p>
          <p className="text-xs text-muted-foreground">
            Pickup issues go to the store contact on the booking.
          </p>
          <p className="text-xs text-muted-foreground">
            {recipientPhone
              ? `Delivery contact: ${recipient?.name || "Recipient"} · ${recipientPhone}`
              : "The saved recipient number is unavailable."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {phone ? (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${phone}`}>Call rider</a>
            </Button>
          ) : null}
          {recipientPhone ? (
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${recipientPhone}`}>
                Call {recipient?.name ? "recipient" : "delivery contact"}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
