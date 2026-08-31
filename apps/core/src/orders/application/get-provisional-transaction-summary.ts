import type {
  CustomerOrderDetailView,
  ProvisionalTransactionSummaryView,
  RpcResult,
} from "@freshmarkets/contracts";
import { getCustomerOrderDetail } from "./get-customer-order-detail";

type SummaryQuery = { customerId: string; orderId: string; requestId: string };

export function toProvisionalTransactionSummary(
  detail: CustomerOrderDetailView,
): ProvisionalTransactionSummaryView {
  const address = detail.fulfillment.address;
  const addressLines = [
    address.addressLine1,
    address.addressLine2,
    address.barangay,
    address.city,
    address.region,
    address.postalCode,
    address.countryCode,
  ].filter((value): value is string => Boolean(value));
  return {
    documentKind: "PROVISIONAL_TRANSACTION_SUMMARY",
    disclaimer: "NOT AN OFFICIAL BIR INVOICE",
    orderNumber: detail.orderNumber,
    committedAt: detail.committedAt,
    currency: detail.financial.currency,
    buyer: { recipient: address.recipient, addressLines },
    lines: detail.items,
    financial: detail.financial,
    payments: detail.payments,
    refunds: detail.refunds,
    amendments: detail.amendments,
    officialInvoice: {
      status:
        detail.invoice.status === "ISSUED"
          ? "ISSUED"
          : detail.invoice.status === "READY"
            ? "READY"
            : "NOT_READY",
      identifier: detail.invoice.status === "ISSUED" ? detail.invoice.invoiceIdentifier : null,
    },
  };
}

export async function getProvisionalTransactionSummary(
  database: D1Database,
  query: SummaryQuery,
): Promise<RpcResult<ProvisionalTransactionSummaryView>> {
  const detail = await getCustomerOrderDetail(database, query);
  return detail.ok
    ? {
        ok: true,
        value: toProvisionalTransactionSummary(detail.value),
        requestId: query.requestId,
      }
    : detail;
}
