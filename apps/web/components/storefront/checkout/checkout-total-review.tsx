import type { CheckoutQuoteView } from "@freshmarkets/contracts";

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function DiscountRow({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div className="flex justify-between gap-4 text-[var(--fm-success)]">
      <span>{label}</span>
      <span className="tabular-nums">−{money(value, currency)}</span>
    </div>
  );
}

export function CheckoutTotalReview({
  quote,
  onAccept,
  accepting = false,
}: {
  quote: CheckoutQuoteView;
  onAccept: () => void;
  accepting?: boolean;
}) {
  const merchandisePromotion = quote.promotionApplications.find(
    (application) => application.component === "MERCHANDISE",
  );
  const deliveryPromotion = quote.promotionApplications.find(
    (application) => application.component === "DELIVERY",
  );

  return (
    <section
      className="mt-5 rounded-[var(--fm-radius-surface)] border border-[var(--fm-success-border)] bg-[var(--fm-success-soft)] p-5 sm:p-6"
      aria-label="Order total review"
    >
      <h2 className="text-lg font-bold">Payment review</h2>
      <p className="mt-1 text-sm text-[var(--fm-text-muted)]">
        This Core-authoritative price is valid until {new Date(quote.expiresAt).toLocaleString()}.
      </p>
      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt>Merchandise subtotal</dt>
          <dd className="tabular-nums">{money(quote.merchandiseSubtotalMinor, quote.currency)}</dd>
        </div>
        {quote.itemDiscountMinor > 0 ? (
          <DiscountRow
            label="Item discounts"
            value={quote.itemDiscountMinor}
            currency={quote.currency}
          />
        ) : null}
        <DiscountRow
          label="Merchandise promotion"
          value={quote.orderDiscountMinor}
          currency={quote.currency}
        />
        {merchandisePromotion ? (
          <p className="text-xs text-[var(--fm-text-muted)]">
            {merchandisePromotion.name}
            {merchandisePromotion.automatic
              ? " (automatically applied)"
              : ` (${merchandisePromotion.code})`}
          </p>
        ) : (
          <p className="text-xs text-[var(--fm-text-muted)]">No merchandise promotion applied.</p>
        )}
        <div className="flex justify-between gap-4">
          <dt>Delivery subtotal</dt>
          <dd className="tabular-nums">{money(quote.deliverySubtotalMinor, quote.currency)}</dd>
        </div>
        <DiscountRow
          label="Delivery promotion"
          value={quote.deliveryDiscountMinor}
          currency={quote.currency}
        />
        {deliveryPromotion ? (
          <p className="text-xs text-[var(--fm-text-muted)]">
            {deliveryPromotion.name}
            {deliveryPromotion.automatic
              ? " (automatically applied)"
              : ` (${deliveryPromotion.code})`}
          </p>
        ) : (
          <p className="text-xs text-[var(--fm-text-muted)]">No delivery promotion applied.</p>
        )}
        <div className="flex justify-between gap-4">
          <dt>Service fee</dt>
          <dd className="tabular-nums">{money(quote.serviceFeeMinor, quote.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt>Tax</dt>
          <dd className="tabular-nums">{money(quote.taxMinor, quote.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-[var(--fm-success-border)] pt-3 text-lg font-bold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(quote.totalMinor, quote.currency)}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={onAccept}
        disabled={accepting}
        className="mt-5 inline-flex min-h-12 items-center justify-center rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-lime)] px-5 text-sm font-bold text-[var(--fm-primary-dark)] hover:bg-[#c4fa69] disabled:cursor-wait disabled:opacity-60"
      >
        {accepting ? "Starting payment…" : "Accept total and continue to payment"}
      </button>
    </section>
  );
}
