# Web to Core Application Contracts

## Contract Principles

Contracts live in `packages/contracts` and are shared as source/types within the monorepo. They define RPC method names, input validation, purpose-built DTOs, stable error codes, and pagination. They never export D1 row types, Better Auth table records, provider payloads, or infrastructure handles.

During remediation, the domain-oriented commands in this document are the target contract. Existing MVP RPC methods such as `commitMockOrder` and `advanceDelivery` remain compatibility adapters until Web clients migrate; they must not become a second business implementation.

Core owns implementation and authorization. Web owns presentation adapters. Contract changes are reviewed as application-interface changes and should prefer additive evolution while both deployments may be temporarily version-skewed during rollout.

## Common Envelope and Context

Conceptual RPC inputs include:

```ts
type RequestMeta = {
  requestId: string;
  idempotencyKey?: string;
  locale?: string;
  timezone?: string;
};

type PageRequest = {
  cursor?: string;
  limit?: number;
};

type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_VERSION"
  | "SUBSCRIPTION_REQUIRED"
  | "ADDRESS_NOT_SERVICEABLE"
  | "CYCLE_CLOSED"
  | "CYCLE_FULL"
  | "PRICE_CHANGED"
  | "ITEM_UNAVAILABLE"
  | "MINIMUM_ORDER_NOT_MET"
  | "PROMOTION_INELIGIBLE"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "ILLEGAL_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";
```

Core derives authentication/session context from the forwarded browser request/session, not from a client-supplied user ID. Administrative scope is resolved in Core from application role assignments.

Error responses contain a code, safe user-facing message/key, request ID, field details when appropriate, and optional recovery metadata such as alternate cycles. They do not expose SQL/provider internals.

## Authentication Boundary

Browser auth endpoints are public Web routes that faithfully proxy to Core's Better Auth handler. This is an HTTP-response-preserving boundary rather than ordinary JSON RPC because redirects, multiple `Set-Cookie` headers, callback URL, host/origin, and CSRF semantics must survive.

Core also exposes typed session/application context methods such as:

```ts
auth.getSessionContext(): Promise<{
  authenticated: boolean;
  authUser?: { id: string; email: string; emailVerified: boolean };
  customer?: { id: string; status: string };
  staff?: {
    id: string;
    capabilities: string[];
    scopes: Array<{ marketId?: string; locationId?: string }>;
  };
}>;
```

The DTO intentionally excludes Better Auth session tokens and password/account internals. Auth-specific operations—Google sign-in, email/password registration/login, verification, reset, logout—are handled by Better Auth through the proxy path.

## Customer and Marketplace Queries

- `marketplace.getHome({ marketHint?, addressId? }) -> MarketplaceHomeView`
- `catalog.search({ query, categoryId?, cursor?, limit? }) -> ProductSearchPage`
- `catalog.getProduct({ slug, addressId? }) -> MarketplaceProductView`
- `catalog.listCategories({ parentId? }) -> CategoryNavigationView`
- `delivery.getAvailableCycles({ addressId, cartId }) -> AvailableCycleView[]`

`MarketplaceProductView` includes customer display data, fixed variants, current quoteable price, availability messaging, and delivery context. It does not expose inventory ledger quantities unless a deliberate customer-facing availability field is defined.

## Serviceability

- `serviceability.resolveCoordinates({ latitude, longitude, addressComponents? }) -> ServiceabilityResult`

`ServiceabilityResult` includes `serviceable`, stable failure reason, market/area/zone display context, active polygon versions, resolution-change detection, and a fulfillment-eligibility summary. Internal polygon GeoJSON, location codes, and ranking rules are never exposed. Customers do not select a location; Core resolves eligible operations context internally and always re-resolves at checkout.

Saved-address commands are customer-boundary operations:

- `addresses.listMine({ headers }) -> CustomerAddressView[]`
- `addresses.create({ label, recipient, phone, addressJson, latitude, longitude, notes? }) -> CustomerAddressView`
- `addresses.update({ addressId, expectedVersion, changed address fields }) -> CustomerAddressView`

Core derives the customer from the Better Auth session, verifies address ownership,
and never accepts a client-selected customer or principal ID. Address updates require
`expectedVersion`; stale writes return `STALE_VERSION`. Coordinate changes re-run
authoritative serviceability resolution, while service-area, delivery-zone, resolution
version, status, and other serviceability fields are server-derived. The address view
returns the persisted resolver `serviceable` outcome and failure reason. Both are null
only for legacy rows that have not yet been authoritatively re-resolved; code presence
is never treated as proof of serviceability.

## Subscription

- `subscriptions.getMine() -> SubscriptionSummary`
- `subscriptions.getOffer() -> MembershipOfferView`
- `subscriptions.startTrial({ offerId, idempotencyKey }) -> SubscriptionSummary`
- `subscriptions.start({ offerId, paymentMethodRef?, idempotencyKey }) -> SubscriptionSummary`
- `subscriptions.pause({ reason?, expectedVersion }) -> SubscriptionSummary`
- `subscriptions.resume({ idempotencyKey, expectedVersion }) -> SubscriptionSummary`
- `subscriptions.cancel({ timing, reason?, expectedVersion }) -> SubscriptionSummary`

- `checkout.getSubscriptionEligibility() -> { eligible, state, reasonCode?, effectiveUntil? }`

These contracts never imply grocery merchandise is free during a membership trial.

## Cart

- `cart.get() -> CartView`
- `cart.addItem({ skuId, quantity, expectedVersion }) -> CartView`
- `cart.updateQuantity({ itemId, quantity, expectedVersion }) -> CartView`
- `cart.removeItem({ itemId, expectedVersion }) -> CartView`
- `cart.clear({ expectedVersion }) -> CartView`

`CartView` uses current display projections but is not a guaranteed checkout quote. Cart version supports optimistic concurrency. No contract promises permanent inventory/capacity reservation.

## Checkout Eligibility and Quote

- `checkout.evaluate({ cartId, addressId, cycleId, promotionCodes? }) -> CheckoutEligibilityView`
- `checkout.refreshQuote({ checkoutAttemptId }) -> CheckoutQuoteView`

The view reports each eligibility dimension, totals, price/availability changes, resolved serviceability, selected cycle, capacity availability, applied/rejected promotions, and available alternatives. Sensitive location-selection rules remain internal.

The authoritative service validates authenticated Customer, subscription, cart, current prices, minimum basket, address coordinates, service area, zone, location, cycle, cutoff, capacity, availability, promotions, and payment readiness.

## Checkout, Payment, and Order Commitment

- `checkout.createAttempt({ cartId, addressId, cycleId, promotionCodes?, idempotencyKey }) -> CheckoutAttemptView`
- `checkout.createPayment({ checkoutAttemptId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `checkout.getAttempt({ checkoutAttemptId }) -> CheckoutAttemptView`
- `checkout.recoverCommitment({ checkoutAttemptId }) -> OrderCommitmentResult`

Core receives payment provider webhooks through a signed public webhook handler rather than Web RPC:

- verify signature and timestamp;
- insert provider event ID exactly once;
- map provider state;
- commit/recover the Order exactly once;
- enqueue non-critical follow-up.

`OrderCommitmentResult` is either the existing/new committed order summary or a stable actionable exception. Duplicate requests return the same logical result. If capacity is unavailable before charge, return alternate valid cycles. If the provider succeeds but commitment cannot complete, create a finance exception and initiate/queue the defined recovery or refund path.

## Customer Orders and Amendments

- `orders.listMine(page) -> CustomerOrderPage`
- `orders.getMine({ orderId }) -> CustomerOrderDetail`
- `orders.requestCancellation({ orderId, reason, expectedVersion, idempotencyKey }) -> CancellationResult`
- `orders.getAmendmentEligibility({ orderId }) -> AmendmentEligibilityView`
- `orders.createAmendmentDraft({ orderId, items, idempotencyKey }) -> AmendmentDraftView`
- `orders.payAmendment({ amendmentId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`

Customer order DTOs compose original and amendment timelines while preserving separate financial records.

## Admin Orders and Payments

- `admin.orders.list(filters, page) -> AdminOrderListPage`
- `admin.orders.get({ orderId }) -> AdminOrderDetail`
- `admin.orders.cancel({ orderId, reason, resolution, expectedVersion, idempotencyKey }) -> AdminOrderDetail`
- `admin.orders.recordExceptionResolution(...)`
- `admin.payments.list(filters, page) -> PaymentOperationsPage`
- `admin.payments.refund({ paymentId, amountMinor, reason, idempotencyKey }) -> RefundView`
- `admin.payments.reconcile({ paymentId, idempotencyKey }) -> ReconciliationResult`

Admin order detail is an operational read model combining order, payment, demand/reservation, fulfillment, delivery, and audit summaries; it is not a raw join response.

## Inventory

- `admin.inventory.list({ locationId, query?, availability?, cursor? }) -> InventoryAvailabilityPage`
- `admin.inventory.getLedger({ locationId, skuId, cursor? }) -> InventoryLedgerPage`
- `admin.inventory.adjust({ locationId, skuId, quantityBase, reason, expectedVersion, idempotencyKey }) -> InventoryAvailabilityView`

Adjustments require capability, location scope, exact base-unit quantity, reason, and audit. There is no generic `setStock` contract.

## Procurement and Receiving

- `admin.procurement.getRequirements({ cycleId, destinationLocationId }) -> ProcurementRequirementView`
- `admin.procurement.aggregateDemand({ cycleId, idempotencyKey }) -> ProcurementRunView`
- `admin.procurement.approveRequirement({ runId, expectedVersion, ... }) -> ProcurementRunView`
- `admin.procurement.placePurchaseOrder(...) -> PurchaseOrderView`
- `admin.receiving.start({ purchaseOrderId, idempotencyKey }) -> ReceivingSessionView`
- `admin.receiving.recordLine({ sessionId, skuId, acceptedBase, rejectedBase, reason?, expectedVersion, idempotencyKey }) -> ReceivingSessionView`
- `admin.receiving.complete({ sessionId, expectedVersion, idempotencyKey }) -> ReceivingSessionView`
- `admin.procurement.resolveException(...) -> ProcurementRunView`

## Fulfillment

- `admin.fulfillment.getWorkQueue({ cycleId, locationId, state?, cursor? }) -> FulfillmentQueueView`
- `admin.fulfillment.startPicking({ taskId, expectedVersion, idempotencyKey })`
- `admin.fulfillment.recordPicked(...)`
- `admin.fulfillment.recordShortage(...)`
- `admin.fulfillment.markPacked(...)`
- `admin.fulfillment.handOff(...)`

Every command validates location scope and legal transition.

## Delivery Operations

- `admin.delivery.getCycleSummary({ cycleId }) -> DeliveryCycleSummary`
- `admin.delivery.listExceptions(filters, page) -> DeliveryExceptionQueue`
- `admin.delivery.createBatch({ cycleId, zoneId, locationId, jobIds, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.assignRider({ batchId, riderId, expectedVersion, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.reorderStops(...) -> DeliveryBatchView`
- `admin.delivery.rescheduleJob(...) -> DeliveryJobView`
- `admin.delivery.resolveFailure(...) -> DeliveryJobView`

## Rider Operations

- `rider.listAssignments() -> RiderAssignmentList`
- `rider.getBatch({ batchId }) -> RiderBatchView`
- `rider.markEnRoute({ jobId, expectedVersion, idempotencyKey })`
- `rider.markArrived({ stopId, occurredAt, expectedVersion, idempotencyKey })`
- `rider.markDelivered({ stopId, occurredAt, proofMetadata?, expectedVersion, idempotencyKey })`
- `rider.markFailed({ stopId, reasonCode, notes?, occurredAt, expectedVersion, idempotencyKey })`

Core verifies that the rider is assigned to the job. Client-supplied timestamps are recorded as reported metadata where useful; Core records authoritative receipt time.

## Contract Testing

- Compile both deployments against the shared contract package.
- Run schema/validation tests for every input and DTO.
- Test that no contract imports infrastructure/D1/provider types.
- Test authentication cookie and redirect preservation end to end.
- Test every command for unauthenticated, unauthorized, out-of-scope, invalid-transition, stale-version, and duplicate-idempotency behavior.
- During deployment, maintain compatibility for any interval in which Web and Core versions may differ.
