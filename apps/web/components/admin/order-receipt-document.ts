import type { AdminOrderDetail, AdminOrderItemView } from "@freshmarkets/contracts";

const escapeHtml = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

export function orderReceiptDocument(
  orders: readonly AdminOrderDetail[],
  location: string,
  timezone: string,
): string {
  const receipts = orders.map((order) => {
    const money = (amount: number | null, currency = order.currency) =>
      amount === null
        ? "Unavailable"
        : escapeHtml(
            new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount / 100),
          );
    const lines = (items: readonly AdminOrderItemView[], currency: string) =>
      `<table><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.productName)}<br><small>${escapeHtml(item.variantName)}</small></td><td data-label="Quantity">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td><td data-label="Unit price">${money(item.unitPriceMinor, currency)}</td><td data-label="Amount">${money(item.lineTotalMinor, currency)}</td></tr>`).join("")}</tbody></table>`;
    const financial = order.financial;
    const totals: [string, number | null][] = [
      ["Merchandise subtotal", financial.subtotalMinor],
      ["Discounts", financial.discountMinor],
      ["Delivery fee", financial.deliveryFeeMinor],
      ...(financial.serviceFeeMinor
        ? [["Historical service fee", financial.serviceFeeMinor] as [string, number]]
        : []),
      ["Tax", financial.taxMinor],
      ["Original order total", financial.totalMinor],
    ];
    const date = order.committedAt
      ? new Intl.DateTimeFormat("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: timezone,
        }).format(new Date(order.committedAt))
      : "Unavailable";
    return `<article class="receipt"><header><p class="brand">FreshMarkets</p><h1>Order receipt</h1><h2>${escapeHtml(order.orderNumber ?? order.orderId)}</h2><p>${escapeHtml(location)} · ${escapeHtml(order.fulfillmentMode === "SCHEDULED" ? "Scheduled" : "Instant")}</p><p>Ordered ${escapeHtml(date)} ${escapeHtml(timezone)}</p></header><section><h3>Deliver to</h3><p>${escapeHtml(order.customer.name ?? "Recipient unavailable")}</p><p>${escapeHtml(order.customer.phone ?? "Phone unavailable")}</p>${order.customer.addressLines.length ? order.customer.addressLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") : "<p>Address unavailable</p>"}</section><section><h3>Order items</h3>${lines(order.items, order.currency)}</section><dl>${totals.map(([label, amount]) => `<div><dt>${escapeHtml(label)}</dt><dd>${money(amount, financial.currency)}</dd></div>`).join("")}</dl>${order.amendments
      .filter((addition) => addition.status === "COMMITTED")
      .map(
        (addition, index) =>
          `<section><h3>Paid addition ${index + 1}</h3>${lines(addition.lines, addition.currency)}<dl><div><dt>Paid addition total</dt><dd>${money(addition.totalMinor, addition.currency)}</dd></div></dl></section>`,
      )
      .join("")}<footer>NOT AN OFFICIAL BIR INVOICE</footer></article>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FreshMarkets order receipts</title><style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; background: white; font: 12px/1.5 Arial, sans-serif; }
    .receipt { padding: 24px; max-width: 800px; margin: 0 auto; overflow-wrap: anywhere; }
    .receipt + .receipt { break-before: page; }
    header { border-bottom: 2px solid #111; padding-bottom: 12px; }
    .brand { font-weight: bold; font-size: 18px; }
    h1 { font-size: 24px; margin: 6px 0; } h2 { font-size: 18px; margin: 6px 0; }
    h3 { font-size: 14px; margin: 0 0 8px; } p { margin: 3px 0; }
    section { margin-top: 20px; } table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { padding: 8px 5px; border-bottom: 1px solid #ddd; vertical-align: top; text-align: left; }
    th:first-child { width: 43%; } th:nth-child(2) { width: 19%; }
    th:nth-child(n+3), td:nth-child(n+3) { text-align: right; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    dl { margin: 16px 0 0 auto; width: min(100%, 360px); }
    dl div { display: flex; justify-content: space-between; gap: 16px; padding: 4px 0; }
    dl div:last-child { border-top: 1px solid #111; font-weight: bold; } dd { margin: 0; text-align: right; }
    footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 12px; font-size: 10px; }
    @media screen and (max-width: 480px) {
      table, tbody { display: block; } thead { display: none; }
      tr { display: grid; gap: 4px; padding: 8px 0; border-bottom: 1px solid #ddd; }
      td { display: block; padding: 2px 0; border: 0; }
      td:nth-child(n+2) { display: flex; justify-content: space-between; gap: 12px; text-align: right; }
      td:nth-child(n+2)::before { content: attr(data-label); font-weight: bold; text-align: left; }
    }
    @media print { .receipt { max-width: none; padding: 0; } }
  </style></head><body>${receipts.join("")}</body></html>`;
}
