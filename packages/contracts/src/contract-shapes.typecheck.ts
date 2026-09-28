import type { CoreServiceBinding } from "./core-service";
import type { CheckoutQuoteView } from "./checkout";
import type { AddressSearchCandidate, AddressSearchRequest } from "./geography";
import type {
  CancelCustomerOrderRequest,
  OrderCancellationView,
  ProvisionalTransactionSummaryRequest,
  ProvisionalTransactionSummaryView,
} from "./orders";
import type { RpcResult } from "./common";
import type { CustomerOrderView, ReceivingCommandResult } from "./index";
import type { OrderState, PaymentState, RefundState, SubscriptionState } from "./states";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Type extends true> = Type;

// These contracts are enforced by the package typecheck, not by runtime Vitest assertions.
export type CancelCustomerOrderSignature = Expect<
  Equal<
    CoreServiceBinding["cancelCustomerOrder"],
    (request: CancelCustomerOrderRequest) => Promise<RpcResult<OrderCancellationView>>
  >
>;

export type ProvisionalTransactionSummarySignature = Expect<
  Equal<
    CoreServiceBinding["getProvisionalTransactionSummary"],
    (
      request: ProvisionalTransactionSummaryRequest,
    ) => Promise<RpcResult<ProvisionalTransactionSummaryView>>
  >
>;

export type AddressSearchSignature = Expect<
  Equal<
    CoreServiceBinding["searchAddressCandidates"],
    (request: AddressSearchRequest) => Promise<RpcResult<ReadonlyArray<AddressSearchCandidate>>>
  >
>;

export type CheckoutFinancialComponents = Expect<
  Equal<
    Pick<
      CheckoutQuoteView,
      | "merchandiseSubtotalMinor"
      | "itemDiscountMinor"
      | "orderDiscountMinor"
      | "deliverySubtotalMinor"
      | "deliveryFeeMinor"
      | "deliveryDiscountMinor"
      | "taxMinor"
      | "totalMinor"
    >,
    {
      merchandiseSubtotalMinor: number;
      itemDiscountMinor: number;
      orderDiscountMinor: number;
      deliverySubtotalMinor: number;
      deliveryFeeMinor: number;
      deliveryDiscountMinor: number;
      taxMinor: number;
      totalMinor: number;
    }
  >
>;

export type SubscriptionTrialingState = Expect<
  Equal<Extract<SubscriptionState, "TRIALING">, "TRIALING">
>;
export type PaymentSucceededState = Expect<Equal<Extract<PaymentState, "SUCCEEDED">, "SUCCEEDED">>;
export type RefundSucceededState = Expect<Equal<Extract<RefundState, "SUCCEEDED">, "SUCCEEDED">>;
export type OrderCommittedState = Expect<Equal<Extract<OrderState, "COMMITTED">, "COMMITTED">>;

export type CustomerOrderFixture = Expect<
  {
    id: "order-1";
    orderNumber: "FM-2026-ORDER1";
    status: "COMMITTED";
    fulfillmentMode: "SCHEDULED";
    deliveryDate: "2026-09-01T00:00:00.000Z";
    promisedAt: null;
    committedAt: "2026-08-30T00:00:00.000Z";
    totalMinor: 19900;
    currency: "PHP";
    itemCount: 2;
  } extends CustomerOrderView
    ? true
    : false
>;

export type ReceivingCommandFixture = Expect<
  {
    receivingRecordId: "rec-1";
    status: "IN_PROGRESS";
    acceptedBase: 4;
    rejectedBase: 0;
    remainingBase: 6;
    version: 2;
  } extends ReceivingCommandResult
    ? true
    : false
>;
