"use client";

import type { ProvisionalTransactionSummaryView } from "@freshmarkets/contracts";

function money(value: number | null, currency: string): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value / 100);
}

export function TransactionSummary({ summary }: { summary: ProvisionalTransactionSummaryView }) {
  const rows: Array<[string, number | null]> = [
    ["Merchandise subtotal", summary.financial.merchandiseSubtotalMinor],
    ["Item discounts", summary.financial.itemDiscountMinor],
    ["Order promotion", summary.financial.orderDiscountMinor],
    ["Delivery fee", summary.financial.deliveryFeeMinor],
    ["Delivery promotion", summary.financial.deliveryDiscountMinor],
    ["FreshMarkets Service Fee", summary.financial.serviceFeeMinor],
    ["Tax", summary.financial.taxMinor],
  ];
  return (
    <article className="transaction-summary mx-auto max-w-4xl bg-white p-5 sm:p-8">
      <style>{`@media print { .transaction-summary-actions { display: none !important; } .transaction-summary { max-width: none; padding: 0; } .transaction-summary-disclaimer { position: running(summary-header); } @page { margin: 18mm; @top-center { content: element(summary-header); } } }`}</style>
      <header className="border-b-2 border-[var(--fm-text)] pb-5">
        <p className="transaction-summary-disclaimer text-sm font-black tracking-wide text-red-800">
          {summary.disclaimer}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Transaction summary</h1>
        <p className="mt-2">Order {summary.orderNumber}</p>
        <p className="text-sm text-[var(--fm-text-muted)]">
          Confirmed {new Date(summary.committedAt).toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="transaction-summary-actions mt-4 min-h-11 rounded-[var(--fm-radius-control)] bg-[var(--fm-primary-dark)] px-4 font-bold text-white"
        >
          Print transaction summary
        </button>
      </header>

      <section className="mt-6" aria-labelledby="summary-buyer">
        <h2 id="summary-buyer" className="text-lg font-bold">
          Customer
        </h2>
        <p>{summary.buyer.recipient ?? "Recipient unavailable"}</p>
        {summary.buyer.addressLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>

      <section className="mt-6" aria-labelledby="summary-items">
        <h2 id="summary-items" className="text-lg font-bold">
          Items
        </h2>
        {summary.lines.length ? (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {summary.lines.map((line) => (
                <tr key={line.orderItemId} className="border-t border-[var(--fm-border)]">
                  <td className="py-2">
                    {line.productName} · {line.variantName}
                  </td>
                  <td>
                    {line.quantity} {line.unit}
                  </td>
                  <td className="text-right tabular-nums">
                    {money(line.lineTotalMinor, summary.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2">Item detail is unavailable for this historical order.</p>
        )}
      </section>

      <section className="mt-6" aria-labelledby="summary-totals">
        <h2 id="summary-totals" className="text-lg font-bold">
          Totals
        </h2>
        {summary.financial.source === "ORDER_TOTAL_ONLY" ? (
          <p className="mt-2 text-sm text-[var(--fm-text-muted)]">
            Component totals are unavailable for this historical order.
          </p>
        ) : null}
        <dl className="mt-3 space-y-2 text-sm">
          {rows.map(([name, value]) => (
            <div key={name} className="flex justify-between gap-4">
              <dt>{name}</dt>
              <dd className="tabular-nums">{money(value, summary.currency)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-[var(--fm-border)] pt-3 text-base font-bold">
            <dt>Total paid</dt>
            <dd>{money(summary.financial.totalMinor, summary.currency)}</dd>
          </div>
        </dl>
      </section>

      {summary.amendments.length ? (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Order additions</h2>
          <ul>
            {summary.amendments.map((amendment) => (
              <li key={amendment.amendmentId}>
                {money(amendment.financial.totalMinor, amendment.financial.currency)} ·{" "}
                {amendment.status}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {summary.refunds.length ? (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Refunds</h2>
          <ul>
            {summary.refunds.map((refund) => (
              <li key={refund.refundId}>
                {money(refund.amountMinor, refund.currency)} · {refund.status}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-[var(--fm-border)] pt-4 text-sm">
        <p>Official invoice status: {summary.officialInvoice.status.replaceAll("_", " ")}</p>
        {summary.officialInvoice.identifier ? (
          <p>Invoice {summary.officialInvoice.identifier}</p>
        ) : null}
        <p className="mt-3 font-bold text-red-800">{summary.disclaimer}</p>
      </footer>
    </article>
  );
}
