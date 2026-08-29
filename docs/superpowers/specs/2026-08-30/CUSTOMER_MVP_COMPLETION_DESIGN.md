# Customer MVP Completion Design

**Program:** Full Codebase Remediation — Program 4  
**Priority:** MVP completion after financial/runtime safety  
**Scope:** Non-admin customer contracts, Core commands/read models, storefront flows, promotions, orders, notifications, invoices, and fulfillment-mode selection

## Objective

Complete the customer-facing MVP already required by canonical scope without duplicating Core authority in Web or inventing unapproved tax/provider policy.

## 1. Core-owned membership experience

Core implements the complete customer Membership target surface already defined by contracts:

- current paid offer;
- subscription summary;
- introductory-trial eligibility/status from Promotions;
- begin paid enrollment;
- pause/resume where product policy permits;
- immediate or period-end cancellation with expected version and idempotency; and
- payment-authorization readiness.

Web removes hardcoded offer price, offer code, trial benefit, and cancellation options. Account/membership pages render Core DTOs and preserve explicit loading, unauthenticated, unavailable, action-required, error, and version-conflict states.

## 2. Checkout Promotions integration

Promotions exposes a checkout evaluation port owned by Core:

```ts
type PromotionCheckoutContext = {
  customerId: string;
  marketId: string;
  locationId: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  merchandiseSubtotalMinor: number;
  deliverySubtotalMinor: number;
  lineFacts: ReadonlyArray<{
    skuId: string;
    productId: string;
    categoryId: string;
    quantity: number;
    lineSubtotalMinor: number;
  }>;
  requestedCodes: readonly string[];
  at: number;
};
```

The evaluator combines requested codes, targeted grants, and eligible automatic promotions. It applies the locked stacking rule: at most one merchandise/order benefit plus one delivery benefit; membership benefits remain separate. A valid explicitly selected benefit wins its price component; otherwise the highest-value eligible benefit wins, with stable promotion identifier as the final tie-breaker.

The quote snapshots selected definitions, rule versions, benefit types, component discounts, and redemption claims. Redemption is finalized exactly once with paid-order commitment; quote creation never consumes a grant. Requotes and expired quotes release no persisted redemption because none was committed. Invalid/expired/ineligible codes return controlled feedback and never silently become zero-value success.

Web allows code entry/removal, displays automatic benefits, separates merchandise and delivery discounts, and asks for explicit total acceptance after any price/promotion change.

## 3. Customer Order Detail and timeline

Orders exposes a purpose-built detail read model containing:

- immutable order identity, committed timestamp, state/version, totals, and financial components;
- immutable line/product/SKU/unit/base-consumption/price snapshots;
- address and fulfillment snapshot with provider-neutral promise;
- Scheduled cycle/window identifiers where applicable;
- amendments and their independent payment/status history;
- refund summaries without provider references;
- fulfillment and delivery states;
- a canonical chronological timeline derived from order, payment, fulfillment, delivery, amendment, and issue events; and
- policy-derived customer actions with disabled reasons.

Timeline entries use controlled event types and customer-safe copy. Raw audit rows, reconciliation JSON, staff identities, provider payloads, internal inventory/procurement data, and precise rider GPS are excluded.

Web adds `/orders/:order-id` with responsive summary, items, totals, address/promise, timeline, amendments, issues, and available actions. List-to-detail navigation is authenticated and ownership-scoped.

## 4. Reorder / buy again

`reorderOrder` is an explicit idempotent Orders command that reads historical line snapshots and attempts to add currently purchasable SKUs to the customer's ordinary active cart under current catalog, price, availability, location, and cart-version rules.

It never restores historical price, promotion, inventory, capacity, delivery cycle, or address. Results report:

- added SKU/quantity and new cart version;
- skipped discontinued/inactive/unavailable/price-missing lines with controlled reasons; and
- whether the customer must review fulfillment/address selection.

The command composes through the Cart application port rather than editing cart tables from Orders. Web clearly reports partial success and navigates to the current cart.

## 5. Customer order issues

Customer issue intake is an Orders-owned command backed by the existing issue lifecycle. Submission requires:

- authenticated order ownership;
- an order/delivery state eligible for issue intake;
- controlled category;
- bounded customer description;
- optional affected order-line identifiers owned by that order;
- idempotency key; and
- order expected version only when submission changes order aggregate metadata.

Submission creates an operational issue record but never authorizes or synthesizes a refund. Customers can list/view their own issues and see customer-safe status/resolution summaries; staff assignment and internal notes remain admin-only.

## 6. Cancellation availability and supported recovery

Core exposes only legally valid cancellation availability derived from canonical order state, fulfillment mode, cutoff/commitment boundary, payment state, and existing amendments.

- Pre-commit checkout/quote abandonment releases holds and does not create a refund.
- Customer cancellation of a committed grocery order remains unavailable because the canonical payment/refund policy is explicitly unapproved.
- Scheduled and Instant committed orders therefore return a controlled unavailable reason and the supported issue/support path; Web never repurposes an internal operations command.
- The customer detail model can advertise cancellation only after a future separately approved canonical contract and policy change.
- Any future required refund must be requested through Payments with its own canonical refund state; an order is never labeled refunded based on browser return or refund initiation.

The implemented pre-commit abandonment command requires expected quote version and idempotency key. Web displays only actions supplied by Core and clearly distinguishes abandonment from committed-order cancellation.

## 7. Additive paid-order amendments

Customers may add items through an additive amendment when Core reports that the order, fulfillment mode, time boundary, capacity/inventory, and payment configuration permit it.

The flow:

1. create an amendment draft with current SKU prices and independent immutable lines;
2. evaluate mode-specific incremental capacity/inventory/procurement impact;
3. create a dedicated amendment payment intent for the exact amendment total;
4. commit only after provider-confirmed payment success; and
5. append timeline/financial records without mutating original order lines or totals.

Failure after payment produces a finance exception and reconciliation; it never silently inserts lines. Web renders amendment totals/payment separately from the original order.

## 8. Transactional notifications

Notifications becomes a bounded context inside Core with an outbox and delivery-attempt history. Domain commands write notification intents in the same atomic batch as the authoritative event or through an idempotent projector keyed by domain event identity. Sending occurs later through scheduled jobs and never changes domain truth.

Launch email types:

- order confirmed;
- payment action required;
- payment failed;
- Scheduled cutoff reminder;
- out for delivery;
- delivered;
- failed delivery;
- renewal payment failed;
- renewal action required;
- introductory trial ending; and
- upcoming first paid renewal.

Each type has a versioned template, controlled subject, recipient user/customer reference, locale/timezone context, scheduled instant, dedupe key, attempt count, next-attempt instant, and terminal delivery state. Templates receive purpose-built DTOs, never raw rows or bearer URLs except the existing isolated auth-email flow.

Retry uses bounded backoff and escalates repeated failure operationally. A failed send cannot roll back or alter an order, payment, subscription, fulfillment, or delivery transition. Tests use a fake delivery port and prove dedupe, scheduling boundaries, retry, and domain-state independence.

## 9. Invoice-readiness persistence

At paid-order commitment, Orders creates an immutable invoice-readiness record linked one-to-one to the committed order and canonical successful payment. It stores nullable/gated fields needed for later approved issuance:

- internal invoice identity;
- external/electronic reference;
- serial/number when issued;
- issuance instant;
- seller/taxpayer snapshot version and controlled snapshot fields;
- buyer/customer snapshot fields allowed by privacy policy;
- currency;
- merchandise, discounts, delivery, service, tax, and total components;
- taxable/VAT classification and amounts only when supplied by an approved tax policy version;
- payment/order references; and
- immutable created/version metadata.

Until accounting policy is approved, invoice state remains `PENDING_TAX_CONFIGURATION` or `READY_FOR_ISSUANCE` only when all required configured facts exist. Core does not guess VAT, taxpayer identifiers, official serial format, retention, or issuance timing. Customer read models may say that an invoice is not yet available; they do not expose incomplete official documents.

## 10. Instant/Scheduled customer selection

After the Maps program lands its address editor and confirmed-coordinate contract, checkout adds a Core-provided fulfillment-options query for the selected confirmed address and current cart.

Each option includes:

- mode (`INSTANT` or `SCHEDULED`);
- eligibility and unavailable reason;
- routed market/location hidden from customer selection;
- provider-neutral promise/window;
- current fee preview currency/components;
- Scheduled cycle identifier/cutoff where applicable; and
- whether inventory/capacity is provisional until quote.

Customers select a mode/promise, never a hub. Instant quote requests carry no synthetic cycle. Scheduled requests carry the chosen open cycle/window. Changing address/cart requeries options and invalidates stale selection. This program consumes the Maps address contract but does not change geocoding, pin confirmation, polygons, route drawing, dispatch, or rider navigation.

## 11. Browser and contract design

- All mutations use Web route handlers as thin Service Binding proxies with bounded input validation, idempotency headers, and expected versions.
- Web never computes entitlement, promotion eligibility, cancellation legality, refundability, invoice totals, or fulfillment availability.
- Customer pages implement loading, empty, unauthenticated, unavailable, conflict, action-required, and recoverable error states.
- Accessibility includes keyboard operation, semantic headings/regions, explicit labels, focus restoration for dialogs/drawers, live status for mutation outcomes, and no color-only state indication.
- Responsive behavior follows the marketplace design documents and reuses existing primitives/compositions.

## Verification and acceptance

Each vertical slice has:

- Core domain/application tests for legal and illegal transitions;
- D1 integration tests for ownership, snapshots, idempotency, versions, and concurrency;
- contract tests proving no raw/provider/infrastructure fields escape;
- Web route/component tests for validation and error propagation; and
- authenticated Playwright coverage using provisioned customer identities.

The final browser journey proves: sign in → view membership/authorization state → manage an ordinary cart → choose confirmed address and eligible fulfillment mode → apply promotion → quote → initiate/replay payment action → observe provider-confirmed committed order → open order detail/timeline → reorder/submit issue/request legal action or amendment as permitted.

Notifications and invoice records are asserted from the committed domain outcome without making email delivery or official invoice issuance a prerequisite for order success.

The complete repository verification suite must pass with no skipped acceptance criterion being counted as complete. Canonical domain, state, data, API, scope, design, implementation plan, and implementation status documents are updated in the same program.
