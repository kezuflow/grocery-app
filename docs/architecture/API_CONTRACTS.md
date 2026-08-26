# Web to Core Application Contracts

## Contract Principles

This document is authoritative for target Web/Core and provider-ingress application boundary semantics. Contracts live in `packages/contracts` and are shared as source/types within the monorepo. They define RPC method names, input validation, purpose-built DTOs, stable error codes, and pagination. They never export D1 row types, Better Auth table records, provider payloads, or infrastructure handles.

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
  | "FULFILLMENT_MODE_UNAVAILABLE"
  | "CYCLE_CLOSED"
  | "CYCLE_FULL"
  | "INVENTORY_HOLD_EXPIRED"
  | "PRICE_CHANGED"
  | "ITEM_UNAVAILABLE"
  | "MINIMUM_ORDER_NOT_MET"
  | "PROMOTION_INELIGIBLE"
  | "PROMOTION_STACKING_CONFLICT"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "ILLEGAL_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";
```

Core derives authentication/session context from the forwarded browser request/session, not from a client-supplied user ID. Administrative scope is resolved in Core from application role assignments.

Error responses contain a code, safe user-facing message/key, request ID, field details when appropriate, and optional recovery metadata such as alternate cycles. They do not expose SQL/provider internals.

Client/application/admin lifecycle commands require a stable idempotency key and `expectedVersion` where concurrent mutation is possible. Provider webhook events are a different boundary: they require signed authenticity plus unique `(provider, providerEventId)` identity, and they never accept or invent `expectedVersion`. Core performs current-state validation and compare-and-swap internally and records retry/reconciliation state when a concurrent command wins.

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
- `fulfillment.getOptions({ addressId, cartId }) -> FulfillmentOptionView[]`

`MarketplaceProductView` includes customer display data and persisted fixed variants with `skuId`, display/packaging label, integer sell quantity, controlled sell-unit code/display, exact integer base-unit consumption, current SKU/market/location quoteable price, availability messaging, and fulfillment context. It does not expose inventory ledger quantities unless a deliberate customer-facing availability field is defined. Sellable sizes are returned from database configuration, not a hard-coded union.

`FulfillmentOptionView` exposes an opaque option ID, `fulfillmentMode: "INSTANT" | "SCHEDULED"`, customer-facing promise/window/ETA, fee context, and for Scheduled only its configured cadence and selectable cycle/window identity. `WEEKLY` may appear as Scheduled cadence but never as `fulfillmentMode`. It exposes no customer-selectable fulfillment location.

## Serviceability

- `serviceability.resolveCoordinates({ latitude, longitude, addressComponents? }) -> ServiceabilityResult`

`ServiceabilityResult` includes `serviceable`, stable failure reason, market/area/zone display context, active polygon versions, resolution-change detection, and a mode-aware fulfillment-eligibility summary. Internal polygon GeoJSON, location codes, active-mode configuration IDs, and ranking rules are never exposed. Customers do not select a location; Core resolves eligible operations context internally and always re-resolves at checkout.

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
- `subscriptions.startTrial({ idempotencyKey }) -> SubscriptionSummary`
- `subscriptions.beginPaidEnrollment({ offerId, idempotencyKey }) -> SubscriptionSummary`
- `subscriptions.pause({ reason?, idempotencyKey, expectedVersion }) -> SubscriptionSummary`
- `subscriptions.resume({ idempotencyKey, expectedVersion }) -> SubscriptionSummary`
- `subscriptions.cancel({ timing: "IMMEDIATE" | "PERIOD_END", reason?, idempotencyKey, expectedVersion }) -> SubscriptionSummary`

- `checkout.getSubscriptionEligibility() -> { eligible, state, reasonCode?, effectiveUntil? }`

`MembershipOfferView` describes the single paid PHP 299.00/calendar-month offer and contains no trial-entitlement field. `SubscriptionSummary` uses only `PENDING`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`, and `EXPIRED`, and exposes `cancelAtPeriodEnd`, `scheduledCancellationAt`, exact UTC `trialStartsAt`/`trialEndsAt`, and aggregate `version`.

`startTrial` resolves the current paid offer and introductory promotion server-side, then succeeds only after Promotions authorizes and atomically consumes the one-calendar-month grant/redemption. Calendar arithmetic follows `DOMAIN_MODEL.md`; an offer field such as `trial_days` is never accepted as authority. `beginPaidEnrollment` may create `PENDING` but cannot create `ACTIVE`; payment-method collection and provider interaction use Payments contracts. These contracts never imply grocery merchandise or delivery is free during a membership trial.

## Membership Payments

- `payments.createMembershipPayment({ subscriptionId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `payments.getMembershipPayment({ subscriptionId }) -> PaymentSummary`
- `payments.recoverMembershipActivation({ subscriptionId, idempotencyKey }) -> SubscriptionActivationResult`

These are Payments-owned operations. A provider-confirmed canonical outcome causes an internal idempotent `ActivateSubscriptionFromPayment`/`RecoverSubscriptionFromPayment` Membership command; the browser cannot request or assert an `ACTIVE` transition directly.

## Cart

- `cart.get() -> CartView`
- `cart.addItem({ skuId, quantity, expectedVersion }) -> CartView`
- `cart.updateQuantity({ itemId, quantity, expectedVersion }) -> CartView`
- `cart.removeItem({ itemId, expectedVersion }) -> CartView`
- `cart.clear({ expectedVersion }) -> CartView`

Cart `quantity` is an integer count of the configured SKU, never kilograms/liters or a floating requested weight. `CartView` repeats the SKU sell-unit and exact base-unit-consumption projection for clarity but remains non-authoritative until Quote. Cart version supports optimistic concurrency. Cart activity alone promises no inventory hold/reservation or capacity.

## Checkout Eligibility and Quote

- `checkout.evaluate({ cartId, addressId, fulfillmentOptionId, promotionCodes? }) -> CheckoutEligibilityView`
- `checkout.refreshQuote({ checkoutAttemptId }) -> CheckoutQuoteView`

The view reports each eligibility dimension, explicit financial components, price/availability changes, resolved serviceability, selected `INSTANT`/`SCHEDULED` option, delivery promise, Instant hold status or Scheduled cycle/capacity status, applied/rejected Promotions by price component, and available alternatives. Sensitive location-selection rules remain internal.

`CheckoutQuoteView` contains `merchandiseSubtotalMinor`, `itemDiscountMinor`, `orderDiscountMinor`, `deliveryFeeMinor`, `deliveryDiscountMinor`, `serviceFeeMinor`, `taxMinor`, `finalTotalMinor`, and currency. Item lines snapshot SKU quantity/unit/base consumption and allocated discount. Percentage/fixed Order benefits use only the approved merchandise basis; Delivery benefits use only delivery fee.

The authoritative service validates authenticated Customer, subscription, cart, SKU/market/location prices, minimum basket, address coordinates, service area, zone, resolved location and active mode, mode-specific inventory hold or cycle/cutoff/capacity, Promotions eligibility/limits/stacking, and payment readiness. For each Order quote it selects at most one merchandise benefit and one delivery benefit; a valid explicit selection wins its component, otherwise highest computed value then stable Promotion ID determines the winner.

## Checkout, Payment, and Order Commitment

- `checkout.createAttempt({ cartId, addressId, fulfillmentOptionId, promotionCodes?, idempotencyKey }) -> CheckoutAttemptView`
- `checkout.createPayment({ checkoutAttemptId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `checkout.getAttempt({ checkoutAttemptId }) -> CheckoutAttemptView`
- `checkout.recoverCommitment({ checkoutAttemptId }) -> OrderCommitmentResult`

Core receives payment provider webhooks through a signed public webhook handler rather than Web RPC:

- verify signature and timestamp;
- insert `(provider, providerEventId)` into the durable Payments inbox exactly once;
- translate the vendor state into canonical Payments state under the configured payment commitment policy;
- update Payments using handler-side legal-transition and compare-and-swap protection, safely retrying/reconciling concurrent aggregate changes;
- invoke an explicit idempotent Membership or Order application command when the canonical outcome is sufficient;
- commit/recover the Membership activation or Order exactly once;
- enqueue non-critical follow-up.

Provider webhook payloads never contain an application `expectedVersion`. Vendor captured/success states map to canonical Payments `SUCCEEDED` for MVP; browser return state and payment initiation do not. The payment provider remains an adapter and its vocabulary is not exposed in Membership or Order DTOs.

`OrderCommitmentResult` is either the existing/new committed order summary or a stable actionable exception. Duplicate requests return the same logical result. If mode-specific inventory/capacity is unavailable before charge, return valid fulfillment alternatives without exposing or asking the customer to select a location. If canonical payment commitment succeeds but the downstream Membership/Order command cannot complete, create a visible finance/reconciliation exception and execute the defined retry or refund recovery path.

For `INSTANT`, attempt creation/refresh atomically creates or replaces an expiring exact-base-unit inventory hold and commitment converts it into a committed reservation. For `SCHEDULED`, commitment uses the selected cycle/window, cutoff, capacity, and configured reservation/demand policy. The committed result snapshots fulfillment mode, resolved location/zone/service area, promise/window/ETA, optional Scheduled cycle identifiers, SKU conversion, Promotions, and all monetary components.

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

## Admin Customers, Catalog, Promotions, and Fulfillment Configuration

- `admin.customers.list(filters, page) -> AdminCustomerSummaryPage`
- `admin.customers.get({ customerId }) -> AdminCustomerDetail`
- `admin.catalog.listUnits({ dimension?, status? }) -> UnitDefinitionView[]`
- `admin.catalog.createUnit({ code, displayName, dimension, canonicalBaseCode, conversionNumerator, conversionDenominator, idempotencyKey }) -> UnitDefinitionView`
- `admin.catalog.createSku({ productId, code, displayName, merchandisingLabel?, sellQuantity, sellUnitId, inventoryQuantityBase, status, sortOrder, idempotencyKey }) -> SellableSkuView`
- `admin.catalog.updateSku({ skuId, expectedVersion, changed fields, idempotencyKey }) -> SellableSkuView`
- `admin.catalog.setPrice({ skuId, marketId, locationId?, amountMinor, currency, validFrom, expectedVersion?, idempotencyKey }) -> SkuPriceView`
- `admin.promotions.list(filters, page) -> PromotionPage`
- `admin.promotions.get({ promotionId }) -> PromotionDetail`
- `admin.promotions.create({ definition, idempotencyKey }) -> PromotionDetail`
- `admin.promotions.update({ promotionId, expectedVersion, definition, idempotencyKey }) -> PromotionDetail`
- `admin.fulfillment.getModeConfiguration({ locationId }) -> FulfillmentModeConfigurationView`
- `admin.fulfillment.activateMode({ locationId, fulfillmentMode, cadence?, configuration, expectedVersion, idempotencyKey }) -> FulfillmentModeConfigurationView`

`AdminCustomerSummary` contains only authorized Customer/profile display data plus location, Order count, last Order, lifetime-spend/AOV fields only when their canonical metric definitions are approved, Membership/trial state, and creation date. Detail composes scoped addresses, Orders, Membership, Promotion/redemption, Payments summary, delivery, support-visible, and audit read models. Better Auth rows are not the Customer contract.

Unit and SKU commands accept integer quantities only and validate dimension compatibility. `PACK`, `BUNCH`, and `TRAY` are labels, not universal conversion codes. Promotion definitions accept only the closed benefit/rule types and validated parameters from `DOMAIN_MODEL.md`; no code/expression payload exists. All Admin operations require the capability and resource scope named by Application IAM.

## Inventory

- `admin.inventory.list({ locationId, query?, availability?, cursor? }) -> InventoryAvailabilityPage`
- `admin.inventory.getLedger({ locationId, inventoryPoolId, cursor? }) -> InventoryLedgerPage`
- `admin.inventory.adjust({ locationId, inventoryPoolId, quantityBase, reason, expectedVersion, idempotencyKey }) -> InventoryAvailabilityView`

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

- `admin.fulfillment.getWorkQueue({ fulfillmentMode?, cycleId?, locationId, state?, cursor? }) -> FulfillmentQueueView`
- `admin.fulfillment.startPicking({ taskId, expectedVersion, idempotencyKey })`
- `admin.fulfillment.recordPicked(...)`
- `admin.fulfillment.recordShortage(...)`
- `admin.fulfillment.markPacked(...)`
- `admin.fulfillment.handOff(...)`

Every command validates location scope and legal transition.

## Delivery Operations

- `admin.delivery.getOperationsSummary({ fulfillmentMode?, cycleId?, locationId? }) -> DeliveryOperationsSummary`
- `admin.delivery.listExceptions(filters, page) -> DeliveryExceptionQueue`
- `admin.delivery.createBatch({ cycleId, zoneId, locationId, jobIds, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.assignRider({ batchId, riderId, expectedVersion, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.reorderStops(...) -> DeliveryBatchView`
- `admin.delivery.rescheduleJob(...) -> DeliveryJobView`
- `admin.delivery.resolveFailure(...) -> DeliveryJobView`

Cycle identity is required only for Scheduled operations. Instant delivery read models group by location/promise/deadline and rider assignment without inventing a cycle.

## Rider Operations

- `rider.listAssignments() -> RiderAssignmentList`
- `rider.getBatch({ batchId }) -> RiderBatchView`
- `rider.markEnRoute({ jobId, expectedVersion, idempotencyKey })`
- `rider.markArrived({ stopId, occurredAt, expectedVersion, idempotencyKey })`
- `rider.markDelivered({ stopId, occurredAt, proofMetadata?, expectedVersion, idempotencyKey })`
- `rider.markFailed({ stopId, reasonCode, notes?, occurredAt, expectedVersion, idempotencyKey })`

Core verifies that the rider is assigned to the job. Client-supplied timestamps are recorded as reported metadata where useful; Core records authoritative receipt time.

## Analytics Queries

- `admin.analytics.listMetricDefinitions({ category?, status? }) -> MetricDefinitionView[]`
- `admin.analytics.getOverview({ window, timezone, dimensions? }) -> AnalyticsOverviewView`
- `admin.analytics.getMetric({ metricCode, definitionVersion?, window, timezone, dimensions? }) -> MetricSeriesView`

Analytics contracts return definition code/version, formula description, source watermark/freshness, currency/base-unit dimensions, and null/unavailable reason when a required accounting or renewal policy is unresolved. They never expose a metric under an unapproved formula, mix currencies or quantity dimensions silently, or provide mutation methods for source context state. `analytics.read` is required.

## Contract Testing

- Compile both deployments against the shared contract package.
- Run schema/validation tests for every input and DTO.
- Test that no contract imports infrastructure/D1/provider types.
- Test authentication cookie and redirect preservation end to end.
- Test every command for unauthenticated, unauthorized, out-of-scope, invalid-transition, stale-version, and duplicate-idempotency behavior.
- Test provider ingress separately for signature failure, duplicate/out-of-order `(provider, providerEventId)`, canonical-state mapping, compare-and-swap conflict, safe retry, and reconciliation; do not fabricate webhook `expectedVersion` values.
- Test fulfillment-mode DTOs so `INSTANT` never requires a cycle and `SCHEDULED` never treats `WEEKLY` as its mode; verify committed snapshots survive configuration changes.
- Test controlled unit dimensions, integer SKU consumption, absence of universal packaging conversion, nonzero SKU/context pricing, deterministic Promotion component stacking, and complete Quote/Order financial components.
- Test every Admin/Analytics query for capability/scope enforcement, no Better Auth/raw-row Customer leakage, definition-version consistency, and read-only source ownership.
- During deployment, maintain compatibility for any interval in which Web and Core versions may differ.
