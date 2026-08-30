# Commerce Pricing, Payments, and Cancellation Design

**Date:** 2026-08-31
**Status:** Approved design awaiting implementation planning
**Scope:** Storefront commerce, Membership, Checkout, Payments, Orders, Notifications, provisional transaction documents, and product terminology

## Objective

Support two distinct FreshMarkets commercial paths without coupling canonical commerce behavior to PayMongo:

- `INSTANT` is pay-as-you-go, requires an authenticated Customer but no membership, and charges a globally configured FreshMarkets Service Fee.
- `SCHEDULED` requires an eligible membership whose globally configured price is snapshotted when the Customer subscribes. Scheduled grocery orders do not charge the FreshMarkets Service Fee.

The design also adds mode-aware customer cancellation, coordinated refunds for Scheduled order additions, staff-only exception refunds, a production-safe mock-payment experience, a provisional printable transaction summary, and a repository-wide replacement of the obsolete product-stage label with current product terminology.

## Design Principles

- Core remains the authoritative Cloudflare Worker and modular monolith.
- Web remains a thin vinext Worker over typed Service Bindings.
- Provider-specific payment behavior stays behind the Payments provider port.
- Browser redirects and client state never prove payment success.
- All authoritative money values use integer minor units.
- Every accepted quote and committed financial record preserves the configuration and calculation used at that time.
- Financial, commercial, and operational states remain separate and reconcile through explicit commands and observations.
- Existing Admin Dashboard and Maps implementations remain outside this program's UI ownership. Core may publish the capability-protected contracts they need.

## Commercial Model

### Instant commerce

An authenticated Customer may check out with `INSTANT` fulfillment without a subscription. Core still validates address, serviceability, fulfillment location, inventory, hold, price, promotions, delivery promise, payment readiness, and every other checkout invariant unrelated to membership.

Instant checkout applies the active global FreshMarkets Service Fee configuration. The customer sees and accepts the fee as its own financial component before payment.

### Scheduled commerce

An authenticated Customer may check out with `SCHEDULED` fulfillment only while a subscription is `TRIALING`, `ACTIVE`, or `PAST_DUE` within its grace period. Scheduled grocery purchases remain separate payments and are not included in the membership charge.

Scheduled checkout does not apply a FreshMarkets Service Fee. Membership revenue commercially covers access to Scheduled ordering and its associated application costs.

### Membership price

Membership has one global, effective-dated price and currency configuration. It is not hard-coded to PHP 299.00.

When a Customer subscribes, the Subscription snapshots the accepted price configuration, amount, and currency. A later price configuration applies only to new subscriptions. Existing subscriptions retain their agreed price until an explicit, separately scheduled price-migration command is introduced and executed with the required customer notice. Automatic repricing of existing subscriptions is forbidden.

The introductory trial remains a Promotions-owned fee waiver over the paid membership and continues to require a recurring-capable payment authorization. The waiver applies to the snapshotted membership price and does not synthesize a zero-value payment.

## FreshMarkets Service Fee

### Configuration

The Service Fee is one global, versioned, effective-dated configuration with three supported shapes:

- `FLAT`: an integer fixed amount in minor units.
- `PERCENTAGE`: an integer basis-point rate.
- `MIXED`: the basis-point result plus the fixed amount.

Only one configuration may be effective at an instant. Overlapping effective ranges are rejected. Admin commands require the appropriate capability, a stable idempotency key, an expected aggregate version, an effective instant, a reason, and audit evidence.

### Calculation

The percentage base is the complete payable order amount before the FreshMarkets Service Fee:

`merchandise after discounts + delivery after discounts + other service charges + tax`

The fee is calculated as:

`fixedMinor + ceil(preServiceFeeTotalMinor * basisPoints / 10_000)`

`FLAT` uses zero basis points, `PERCENTAGE` uses zero fixed amount, and `MIXED` uses both. Core performs the calculation using integer arithmetic and fails closed for missing, overlapping, invalid, or currency-incompatible configuration.

The accepted quote and committed Order snapshot:

- configuration identifier and version;
- fee shape;
- currency;
- fixed amount;
- basis points;
- percentage base;
- calculated Service Fee;
- pre-fee and final totals.

Later configuration changes never mutate an existing quote or committed Order. Payment-time revalidation resolves the currently effective configuration; if it differs from the accepted quote, Core produces a replacement quote and requires explicit customer acceptance before creating payment.

## PayMongo Processing Cost

The FreshMarkets Service Fee and PayMongo processing cost are distinct:

- The FreshMarkets Service Fee is a customer-facing application charge controlled by FreshMarkets.
- PayMongo processing cost is a provider-determined merchant expense that varies by payment method, contract, tax treatment, and settlement behavior.

Payments records provider-neutral gross payment, provider processing cost when observed, withholding or other settlement adjustments when observed, and net settlement. Provider observations are authoritative for actual settlement values. A configured estimate may support local simulation and financial forecasting but must never be represented as an actual PayMongo fee.

Production PayMongo integration is deferred until account approval, credentials, enabled payment methods, webhook configuration, refund capabilities, and staging acceptance are available.

PayMongo pass-on fees remain disabled unless the owner separately approves them. Enabling PayMongo's own customer pass-on mechanism alongside the FreshMarkets Service Fee would create a second customer charge and is outside this design.

## Mock Payment Experience

The existing deterministic mock provider remains the development/test provider and stays forbidden in production-like environments. It will support an end-to-end local experience for:

- recurring authorization approval or rejection;
- payment approval, rejection, expiration, and required action;
- signed provider events;
- reconciliation reads;
- full and partial refunds;
- refund rejection and recovery;
- simulated gross, processing-cost, and net-settlement observations.

The mock experience may offer local approve/decline controls, but those controls must create the same verified provider observation consumed by the normal Payments inbox. A browser return alone never transitions a Payment to `SUCCEEDED` or commits an Order.

Runtime configuration continues to fail closed when no approved provider is available. Production code must not silently fall back to the mock provider.

## Cancellation Policy

### Customer-initiated Instant cancellation

A Customer may request cancellation only before the Order enters `FULFILLMENT_PENDING`. Entering `FULFILLMENT_PENDING` means picking or fulfillment has begun and permanently closes customer cancellation.

For an eligible cancellation:

- the refund equals the gross amount paid minus the snapshotted FreshMarkets Service Fee;
- PayMongo processing cost is not deducted a second time from the customer refund;
- operational reservations are released when cancellation is accepted;
- the Order remains `CANCELLATION_REQUESTED` until the required refund succeeds;
- successful refund observation transitions the Order to `CANCELED`.

### Customer-initiated Scheduled cancellation

A Customer may request cancellation only before the snapshotted admin-configured delivery-cycle cutoff. The cancellation coordinates the original grocery payment and every committed paid addition.

Additions cannot be canceled independently. A parent cancellation before cutoff:

- requests full refunds for the original payment and all committed amendment payments;
- cancels or closes non-committed additions without a financial refund;
- releases planned demand, capacity, and other operational effects when cancellation is accepted;
- keeps the Order in `CANCELLATION_REQUESTED` until every required refund succeeds;
- transitions the Order to `CANCELED` only after the complete refund set succeeds.

Canceling a Scheduled grocery Order does not cancel its membership.

### FreshMarkets-caused cancellation

When FreshMarkets cancels because of unavailable stock, operational failure, failed delivery, or another business-side cause, the Customer receives a full refund of every applicable payment. For Instant Orders, the refund includes the FreshMarkets Service Fee.

### Post-lock staff exceptions

Customer cancellation is unavailable at or after the applicable lock. Authorized staff with `refunds.manage` may issue an exception refund for cases such as duplicate charges, damaged goods, or failed delivery.

Every exception requires a reason and immutable audit evidence. An exception refund does not reopen customer cancellation or pretend that the ordinary cancellation policy was satisfied. Operational remediation and financial remediation remain separately visible.

## Coordinated Refund Model

Cancellation creates an explicit refund set containing every payment that must be unwound. Each member records its source payment, required refund amount, provider request, canonical refund state, attempts, and terminal observation.

Refund requests are individually idempotent. A partial provider success cannot duplicate a successful refund, omit another payment, or prematurely cancel the Order. Failed or indeterminate members enter the existing retry and reconciliation path and surface as operational exceptions when intervention is required.

Order completion rules are:

- no required refunds: transition directly when operational cancellation succeeds;
- all required refunds succeeded: transition `CANCELLATION_REQUESTED -> CANCELED`;
- any refund processing: remain `CANCELLATION_REQUESTED`;
- any refund rejected or indeterminate after retry policy: remain `CANCELLATION_REQUESTED` and raise an exception.

Production checkout may expose only payment methods whose refund capabilities can satisfy the advertised cancellation policy, or it must provide an explicitly approved alternative refund rail. Unsupported payment methods fail eligibility closed.

## Contracts and Read Models

Shared provider-neutral contracts will expose:

- current membership price and version;
- subscription agreed price and currency;
- Service Fee configuration commands/read models;
- quote and Order financial breakdowns containing `serviceFeeMinor` as a distinct component;
- Service Fee calculation evidence in internal authoritative snapshots;
- mode-aware eligibility failures;
- cancellation availability and disabled reason;
- coordinated refund progress without leaking vendor state;
- provisional transaction-summary readiness.

Raw provider payloads, D1 rows, PayMongo terms, and infrastructure types remain outside RPC and UI DTOs.

## Provisional Transaction Summary

Until the business approves its BIR and accounting policy, the customer Order detail provides a printable transaction summary rather than an official tax invoice. It is clearly marked `NOT AN OFFICIAL BIR INVOICE` and must not allocate official serial numbers or claim regulatory compliance.

The summary uses immutable Order snapshots and shows:

- FreshMarkets placeholder issuer identity;
- order number and commitment time;
- customer and delivery snapshot data appropriate for display;
- line items, discounts, delivery, tax placeholder where applicable, FreshMarkets Service Fee, and total;
- payment and refund status;
- amendment totals where applicable;
- the provisional-document disclaimer.

Final invoice issuance remains blocked on approved taxpayer facts, classification, numbering, retention, and electronic-invoice integration policy.

## Notifications and Sender Identity

The intended production sender is `notifications@freshmarkets.ph`. Production sending requires domain ownership, Cloudflare Email onboarding, authentication records, the Email binding, and `AUTH_EMAIL_FROM` configuration.

Cancellation requested, refund progressing, refund completed, cancellation completed, and refund-exception notifications use the durable outbox. Delivery failure never rolls back financial or operational state and remains retryable/observable.

## Admin Ownership Boundary

Core owns Service Fee and membership-price commands, validation, storage, audit evidence, and read models. The commands require explicit capabilities and scopes; raw configuration-table access is forbidden.

This program will publish the contracts required by the separately owned Admin Dashboard workstream. It will not modify that workstream's protected UI or the Maps implementation. Until the Admin UI consumes the contracts, configuration may be exercised through tests or approved internal tooling only.

## Data and Migration Strategy

All schema changes are additive and use new migrations. Existing protected migrations remain byte-for-byte unchanged.

The implementation is expected to add or extend records for:

- global membership price versions;
- Subscription agreed-price snapshots;
- global Service Fee configuration versions;
- quote and Order Service Fee snapshots;
- provider-neutral settlement observations;
- cancellation refund-set membership and progress;
- cancellation/refund audit evidence;
- provisional transaction-summary readiness where persistence is required.

Fresh and upgrade migration paths must both be verified. Existing committed Orders and Subscriptions require an explicit compatibility backfill derived from their historical accepted values; they must not be silently repriced.

## Error Handling and Concurrency

- Missing or ambiguous active pricing fails closed.
- Stale configuration or aggregate versions return a refreshable conflict.
- Reused idempotency keys with different payloads return an idempotency conflict.
- Payment, refund, and provider-event handlers use provider event identity and compare-and-swap guards rather than client versions.
- Cancellation releases operational effects exactly once.
- Refund completion is observation-driven and replay-safe.
- Notification delivery is asynchronous and never changes canonical financial truth.
- Provider timeouts remain processing/indeterminate until reconciliation proves an outcome.

## Product Terminology Migration

The repository no longer describes the product as an early minimum release. The canonical product-scope document becomes `docs/product/PRODUCT_SCOPE.md`, and all active routers, canonical documents, READMEs, status records, comments, and test descriptions use context-appropriate terms such as `product scope`, `initial launch`, or `current release`.

Historical reports retain the old stage label only when it is necessary to describe an explicitly historical phase. Database migration identifiers and Git history are not rewritten.

## Verification Strategy

### Domain and unit tests

- `FLAT`, `PERCENTAGE`, and `MIXED` calculations;
- integer ceiling behavior and overflow boundaries;
- global effective-date overlap rejection;
- membership price snapshot and grandfathering;
- Instant and Scheduled eligibility branching;
- cancellation-policy matrix by actor, mode, cause, state, and cutoff;
- coordinated refund-set completion and failure states.

### Integration tests

- fresh and upgrade migrations;
- quote and Order fee snapshots;
- subscription enrollment at the active global price;
- price changes affecting only new subscriptions;
- mock authorization, payment, event, reconciliation, and refund paths;
- Instant customer cancellation before and after fulfillment begins;
- Scheduled cancellation before and after cutoff;
- original plus multiple amendment refunds;
- partial refund success, retry, reconciliation, and replay;
- FreshMarkets-caused full refunds;
- staff capability, scope, reason, and audit enforcement;
- outbox projection and redelivery.

### Web and end-to-end tests

- Instant checkout without membership;
- Scheduled checkout blocked without eligible membership;
- visible and accepted FreshMarkets Service Fee;
- local mock-payment approval and rejection;
- customer cancellation availability and disabled reasons;
- coordinated cancellation progress;
- provisional printable transaction summary and disclaimer;
- responsive, accessible loading, error, and retry states.

### Repository gates

- formatting and naming;
- architecture and readiness/security checks;
- migration fresh/upgrade verification;
- lint and typecheck;
- full Vitest suite;
- vinext compatibility and production builds;
- managed Playwright suite;
- protected migration and Maps-sensitive hash checks;
- repository search proving the terminology migration is complete under the approved historical exception rule.

## Deferred External Dependencies

- PayMongo account approval, commercial terms, credentials, enabled methods, webhook secret, refund behavior acceptance, and production staging.
- Ownership and Cloudflare onboarding of `freshmarkets.ph` for transactional email.
- Approved BIR/accounting invoice policy and business registration facts.
- Admin Dashboard UI consumption of the new Core configuration contracts.

None of these dependencies permits production to fall back to mock payments, send from an unverified domain, or issue a provisional summary as an official invoice.

## Acceptance Criteria

The implementation is complete when:

1. Instant checkout succeeds for an authenticated Customer without membership and applies the accepted global FreshMarkets Service Fee.
2. Scheduled checkout requires eligible membership and never applies the FreshMarkets Service Fee.
3. Membership prices are global, effective-dated, snapshotted, and grandfathered.
4. Mock payment and refund flows prove the full provider-neutral lifecycle without production fallback.
5. Cancellation and refund behavior matches the approved policy for every actor, mode, cause, state, cutoff, and amendment combination.
6. Staff exceptions are capability-protected and auditable.
7. Provisional transaction summaries cannot be mistaken for official BIR invoices.
8. Canonical documents and repository terminology match the approved product model.
9. Admin Dashboard and Maps implementation ownership remains intact.
10. All risk-proportionate repository gates pass.
