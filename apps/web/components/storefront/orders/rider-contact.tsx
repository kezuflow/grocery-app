import Link from "next/link";
import type { DeliveryTrackingView } from "@freshmarkets/contracts";

export function RiderContact({
  contact,
  orderId,
}: {
  contact: DeliveryTrackingView["riderContact"];
  orderId: string;
}) {
  const phone = contact?.phone && /^\+?\d{7,15}$/.test(contact.phone) ? contact.phone : null;
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--fm-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-bold">Your Lalamove rider</p>
        <p className="text-sm text-[var(--fm-text-muted)]">
          {contact?.name || "Rider details are not available yet."}
        </p>
        {phone ? (
          <p className="text-xs text-[var(--fm-text-muted)]">
            Call about arrival or delivery access. The rider may also call the recipient number on
            this order.
          </p>
        ) : (
          <p className="text-xs text-[var(--fm-text-muted)]">
            For help now, message FreshMarkets about this order.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {phone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-4 text-sm font-bold"
          >
            Call rider
          </a>
        ) : null}
        {!phone ? (
          <Link
            href={`/account/messages/${encodeURIComponent(orderId)}`}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] px-4 text-sm font-bold text-white hover:bg-[var(--fm-storefront-action-hover)]"
          >
            Message FreshMarkets
          </Link>
        ) : null}
      </div>
    </div>
  );
}
