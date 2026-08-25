# FreshMarkets MVP Scope

## MVP Business Outcome

MVP is complete only when one customer can complete this real business loop in the initial Cebu operation:

```text
Browse marketplace
 -> create/login account
 -> start trial or active subscription
 -> build cart
 -> choose a valid Cebu serviceable address
 -> choose a valid delivery cycle
 -> pay
 -> create a locked committed order
 -> aggregate planned demand or reserve stocked inventory
 -> procure/receive where required
 -> pick/pack
 -> dispatch
 -> rider delivery
 -> completed order
```

The MVP may operate one live fulfillment location, but its domain/data model must retain markets, zones, location capabilities, location availability, and location inventory from the beginning.

## MVP Included

### Platform and identity

- Monorepo with `apps/web` vinext Worker and `apps/core` authoritative Worker.
- Typed Web -> Core Service Binding.
- Better Auth in Core with D1 persistence.
- Google OAuth, email/password, email verification, password reset, persistent secure sessions.
- Customer/staff application records linked to Better Auth user IDs.
- Capability-based RBAC with global/market/location scopes.

### Customer commerce

- Public discovery, search, categories, product detail, fixed variants, cart, account, order history, upcoming delivery, and delivery status.
- Global catalog and categories.
- Fixed sellable units/variants consuming integer base inventory units.
- Global/market base pricing with historical snapshots.
- Customer saved addresses with geocode coordinates and map confirmation where supported.
- Cebu City polygon serviceability and delivery-zone resolution.
- Configurable delivery cycles/windows, fees, cutoff, and capacity.
- Subscription start, configurable free trial, active/trialing eligibility, and basic lifecycle management.
- Central checkout eligibility service.
- Payment adapter boundary with sandbox/mock provider and production-provider selection before launch.
- Committed order creation, immutable snapshots, and additive paid-order amendments before cutoff.

### Operations

- Location-specific inventory with stocked reservation and planned procurement committed-demand semantics.
- Hybrid sourcing calculation.
- Demand aggregation, procurement requirements, purchase/receiving records, shortages, rejections, and discrepancy handling.
- Picking, packing, fulfillment readiness, delivery batches/jobs/stops, rider assignment, delivery events, failure reasons, and retry/reschedule commands.
- Admin overview, orders, catalog, inventory, procurement, fulfillment, delivery, customers, subscriptions, payments, staff/roles, and audit workspaces.
- Structured logs, correlation IDs, audit events, idempotency, webhook replay handling, and basic reconciliation.

## MVP Exclusions

- Customer-directed substitution engine.
- Arbitrary/final-weight settlement.
- Customer-selectable hubs.
- Full multi-market rollout or multiple live locations, though schemas support them.
- Internal stock transfers UI/workflow.
- Complex route optimization or map-based fleet routing.
- Pickup-point operations.
- Giant promotion/rules engine.
- Advanced tax/invoicing workflows until local requirements are confirmed.
- Photo/signature/recipient identity proof beyond extensible metadata.
- Durable Object capacity coordinator or Workflow orchestration.
- Separate microservices, event sourcing, separate read database, or public general-purpose REST API.

## MVP Acceptance Criteria

1. An unauthenticated browser can browse but cannot place an order.
2. A customer can create/verify/login with Better Auth and maintain a secure session through Web/Core boundaries.
3. Trial membership waives membership fee only; merchandise and delivery remain charged.
4. Core rejects checkout for an ineligible subscription, non-serviceable coordinate, invalid cycle, closed/cutoff cycle, full capacity, invalid price, unavailable SKU, or below-minimum basket.
5. A successful payment and retried webhook produce exactly one committed order or a visible recoverable finance exception.
6. The committed order cannot be rewritten when catalog prices or saved addresses change.
7. Stocked items reserve location inventory; planned items create committed base-unit demand; hybrid items do both as calculated.
8. Procurement requirements reconcile demand, safety buffer, usable inventory, and incoming stock.
9. Receiving discrepancies and supply shortages create explicit operational exceptions and auditable resolutions.
10. Fulfillment and delivery state machines reject illegal transitions and enforce staff/rider scope.
11. A rider can complete a delivery or record a failure that enters an explicit retry/reschedule/escalation path.
12. Admin read models answer current-cycle operational questions without exposing raw persistence rows.

## Phase 1.5

- Select and integrate the production payment provider and local methods.
- Notifications and customer operational messaging.
- Supplier master data and richer procurement approval/reconciliation.
- Recurring subscription-generated orders.
- More complete refunds, credits, and finance reconciliation.
- Product media in R2 and stronger image workflows.
- MVP promotion subset: first-order, fixed/percentage, minimum spend, free delivery, code/automatic, basic stacking.

## Phase 2

- Multiple Metro Cebu locations with ranked fulfillment candidates.
- Zone-level capacities and more detailed location assignment.
- Central/local procurement routing and stock transfers.
- Rich delivery proof and improved dispatch tooling.
- Operational analytics, saved filters, and measured read-model projections.
- Durable Object escalation only if capacity/dispatch contention warrants it.

## Later

- Additional markets, pickup points, cross-dock and dispatch-only sites.
- Customer substitutions and substitution preferences.
- Variable-weight settlement.
- Route optimization and richer fleet capabilities.
- Workflows for long-running exception/procurement orchestration.
- Advanced promotions and experimentation.
- Dedicated analytics/data-lake infrastructure.

## Scope Governance

Any proposed MVP addition must identify the business loop step it completes, its domain/data dependencies, its operational owner, and its failure/reconciliation behavior. “The architecture supports it” is not sufficient justification for adding speculative functionality.

