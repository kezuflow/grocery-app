import type { FulfillmentOptionView } from "@freshmarkets/contracts";
import { Truck } from "lucide-react";

type DeliveryPartnerCode = NonNullable<FulfillmentOptionView["deliveryPartner"]>["code"];

export function DeliveryPartnerIcon({ code }: { code?: DeliveryPartnerCode }) {
  if (code === "lalamove") {
    return (
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#fff1e8] text-[#ff6422]"
        data-provider-icon="lalamove"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none">
          <path d="M4 12.2 19.5 5l-5.1 6.2 5.6 2.2-10.7 5.7 2.1-5.4L4 12.2Z" fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (code === "grab-express") {
    return (
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#eaf8ef] text-[var(--fm-storefront-accent)]"
        data-provider-icon="grab-express"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none">
          <path
            d="M5.4 8.1c-2.1 0-3.8 1.7-3.8 3.9s1.7 3.9 3.8 3.9c1.4 0 2.5-.5 3.3-1.3v-2.9H5.1v1.5h1.8v.7c-.4.3-.9.5-1.5.5-1.3 0-2.3-1.1-2.3-2.4s1-2.4 2.3-2.4c.8 0 1.4.3 1.9.8l1-1.1a4 4 0 0 0-2.9-1.2Zm6.1 2.3c-.7 0-1.3.3-1.7.9v-.7H8.3v5.1h1.6v-2.5c0-.8.5-1.3 1.3-1.3h.4v-1.5h-.1Zm3.4 0a2.7 2.7 0 1 0 0 5.4c.7 0 1.3-.2 1.7-.7v.6h1.5v-5.1h-1.5v.6c-.4-.5-1-.8-1.7-.8Zm.3 1.4c.8 0 1.4.5 1.4 1.3s-.6 1.3-1.4 1.3-1.4-.5-1.4-1.3.6-1.3 1.4-1.3Zm5-3.9h-1.6v7.8h1.6v-.6c.4.5 1 .7 1.7.7a2.7 2.7 0 0 0 0-5.4c-.7 0-1.3.3-1.7.8V7.9Zm1.4 3.9c.8 0 1.4.5 1.4 1.3s-.6 1.3-1.4 1.3-1.4-.5-1.4-1.3.6-1.3 1.4-1.3Z"
            fill="currentColor"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[var(--fm-surface-soft)] text-[var(--fm-text-muted)]"
      data-provider-icon="delivery"
    >
      <Truck className="size-4" />
    </span>
  );
}
