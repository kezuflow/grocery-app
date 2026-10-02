"use client";

import Link from "next/link";
import { lazy, Suspense, useEffect, useRef } from "react";
import type { CustomerOrderDetailView } from "@freshmarkets/contracts";
import { OrderTimeline } from "./order-timeline";
import { RiderContact } from "./rider-contact";

const DeliveryTrackingMap = lazy(() =>
  import("../../maps/delivery-tracking-map").then((module) => ({
    default: module.DeliveryTrackingMap,
  })),
);

export function OrderTrackingDialog({
  order,
  onClose,
}: {
  order: CustomerOrderDetailView;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const address = order.fulfillment.address;
  const addressLine = [
    address.addressLine1,
    address.addressLine2,
    address.barangay,
    address.city,
    address.region,
    address.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="delivery-tracking-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fm-storefront m-auto h-[min(94dvh,920px)] w-[min(96vw,1420px)] max-w-none overflow-hidden rounded-[var(--fm-radius-overlay)] border border-[var(--fm-border)] bg-white p-0 text-[var(--fm-text)] shadow-[var(--fm-shadow-overlay)] backdrop:bg-black/55"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-[var(--fm-border)] px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fm-text-muted)]">
              Order {order.orderNumber}
            </p>
            <h2 id="delivery-tracking-title" className="mt-1 text-xl font-bold">
              Track delivery
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-[var(--fm-radius-control)] border border-[var(--fm-border)] px-4 text-sm font-bold"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(340px,390px)] lg:overflow-hidden">
          <section
            className="flex min-w-0 flex-col gap-4 p-5 sm:p-6 lg:overflow-y-auto"
            aria-label="Delivery map and rider contact"
          >
            <Suspense
              fallback={
                <div
                  role="status"
                  className="flex h-[min(48dvh,420px)] min-h-64 items-center justify-center rounded-[var(--fm-radius-surface)] border border-[var(--fm-border)] text-sm text-[var(--fm-text-muted)] lg:h-[min(65dvh,620px)]"
                >
                  Loading delivery map…
                </div>
              }
            >
              <DeliveryTrackingMap
                endpoint={`/api/commerce/orders/${encodeURIComponent(order.orderId)}/tracking`}
                mapClassName="h-[min(48dvh,420px)] min-h-64 w-full overflow-hidden rounded-[var(--fm-radius-surface)] lg:h-[min(65dvh,620px)]"
                renderContact={(contact) => (
                  <RiderContact contact={contact} orderId={order.orderId} />
                )}
              />
            </Suspense>
          </section>
          <aside
            className="flex min-w-0 flex-col gap-6 border-t border-[var(--fm-border)] p-5 sm:p-6 lg:overflow-y-auto lg:border-t-0 lg:border-l"
            aria-label="Order details and progress"
          >
            <OrderTimeline
              progress={order.progress}
              orientation="vertical"
              headingId="tracking-order-timeline-heading"
            />
            <section
              className="border-t border-[var(--fm-border)] pt-5"
              aria-labelledby="tracking-delivery-details-heading"
            >
              <h3 id="tracking-delivery-details-heading" className="font-bold">
                Delivery details
              </h3>
              <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
                {addressLine || "Delivery address is unavailable."}
              </p>
              {address.recipient ? <p className="mt-1 text-sm">For {address.recipient}</p> : null}
            </section>
            <section
              className="border-t border-[var(--fm-border)] pt-5"
              aria-labelledby="tracking-items-heading"
            >
              <h3 id="tracking-items-heading" className="font-bold">
                Your items
              </h3>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {order.items.map((item) => (
                  <li key={item.orderItemId}>
                    {item.quantity} × {item.productName} · {item.variantName}
                  </li>
                ))}
              </ul>
            </section>
            <Link
              href={`/account/messages/${encodeURIComponent(order.orderId)}`}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-storefront-action)] px-4 text-sm font-bold !text-white hover:bg-[var(--fm-storefront-action-hover)]"
            >
              Message us about this Order
            </Link>
          </aside>
        </div>
      </div>
    </dialog>
  );
}
