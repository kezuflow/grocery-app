import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RpcResult, OrderCancellationView } from "@freshmarkets/contracts";
import { CancelOrderAction, cancellationResultMessage } from "./cancel-order-action";

describe("CancelOrderAction", () => {
  it("renders the exact Core-provided refund and retained Service Fee", () => {
    const html = renderToStaticMarkup(
      <CancelOrderAction
        orderId="order-1"
        orderVersion={3}
        available
        disabledReason={null}
        cancellation={{
          status: null,
          requiredRefundMinor: 97_500,
          retainedServiceFeeMinor: 2_500,
          currency: "PHP",
        }}
      />,
    );
    expect(html).toContain("Refund if canceled now");
    expect(html).toContain("₱975.00");
    expect(html).toContain("FreshMarkets service fee retained");
    expect(html).toContain("₱25.00");
    expect(html).toContain('aria-live="polite"');
  });

  it("does not optimistically claim an order is canceled", () => {
    const processing = {
      ok: true,
      requestId: "request-1",
      value: {
        cancellationId: "cancellation-1",
        status: "REFUNDS_PROCESSING",
        requiredRefundMinor: 97_500,
        retainedServiceFeeMinor: 2_500,
        currency: "PHP",
        refunds: [],
      },
    } satisfies RpcResult<OrderCancellationView>;
    expect(cancellationResultMessage(processing)).toContain("not marked canceled yet");
  });

  it("tells the customer to refresh after a stale version", () => {
    const stale = {
      ok: false,
      error: { code: "STALE_VERSION", message: "stale", requestId: "request-1" },
    } satisfies RpcResult<OrderCancellationView>;
    expect(cancellationResultMessage(stale)).toContain("Refresh the page");
  });
});
