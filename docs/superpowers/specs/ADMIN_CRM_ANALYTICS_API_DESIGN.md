# Admin, CRM, Analytics, and Management API Design

**Status:** Approved in chat on 2026-08-27; awaiting final written-spec review
**Repository:** FreshMarkets
**Scope:** Complete admin application contract and delivery architecture

## 1. Goal

Build a complete, capability-aware FreshMarkets admin application covering Overview, Customer CRM,
Staff & Access, Orders, Payments, Memberships, Promotions, Catalog, Inventory, Procurement,
Receiving, Fulfillment, Delivery, Analytics, Audit, and Settings.

The admin is an operational decision system, not a raw-table CRUD console. Every read is a
purpose-built Core read model. Every write is an explicit Core command with authorization,
idempotency, legal-transition checks, optimistic concurrency where applicable, and audit.

## 2. Approved interpretation of CRUD

### Customer CRM

Customer administration includes search, detail, approved application-profile changes, commerce
access disable/restore, session revocation, support context, and privacy/account-closure workflows.
It never hard-deletes Better Auth identity, Orders, Payments, Refunds, Promotion redemptions,
Inventory ledgers, or Audit history. Closure and anonymization are controlled, auditable commands
that preserve legally and operationally required history.

### Staff & Access

Staff administration includes invitation/provisioning, application-owned staff metadata,
activation/suspension, role assignments, capability sets, market/location scopes, and session
revocation. Better Auth remains authoritative for credentials, accounts, verification, and
sessions. Admin never sets or reads password material.

### Promotions

Promotions support draft creation, versioned update, activation, deactivation, archival, preview,
targeted grants, and redemption inspection. Promotions with history are archived rather than
deleted. Definitions use only the closed benefit and rule vocabulary in `DOMAIN_MODEL.md`.

## 3. Architecture

```text
Admin browser
  -> same-origin apps/web /api/admin/* route handlers
      -> typed Cloudflare Service Binding
          -> apps/core query or command
              -> domain policy/service
                  -> repository/integration port
                      -> Core-owned D1/provider
```

- Core remains the only business and authorization authority.
- Web route handlers are thin browser transport adapters; they do not duplicate policy.
- The general Core HTTP surface remains narrow. This design does not add a public general-purpose
  REST API or CORS.
- Shared contracts live in `packages/contracts` and contain DTOs, validation-compatible inputs,
  and stable errors, never D1/ORM/provider rows.
- The browser-facing `/api/admin/*` paths are a proposed BFF mapping. The canonical application
  interface is the typed Core command/query catalog.

## 4. Rejected alternatives

1. A generic `/api/admin/rpc` dispatcher is rejected because it weakens contract discoverability,
   route-level observability, validation, and reviewability.
2. Direct Web access to D1 is rejected because it violates Core ownership.
3. A public REST API is deferred until a documented external integration requires it.
4. Generic `PATCH { status }` and arbitrary record deletion are rejected in favor of named legal
   commands.

## 5. Current implementation truth

The current Web admin surface exposes only:

- `GET /api/admin/operations`;
- `GET /api/admin/jobs`;
- `POST /api/admin/delivery`;
- `POST /api/admin/rider-assign`.

Core also implements inventory adjustment, procurement-requirement creation, receiving,
fulfillment advancement, delivery advancement, the operations board, rider assignment/jobs, and
scheduled-job run queries. No current completion claim exists for Customer CRM, Staff CRUD, Role
CRUD, generalized Promotions management, Analytics, Audit browsing, Catalog administration,
Membership operations, or the full Orders/Payments admin workspaces.

## 6. API catalog

Every route below maps to a namespaced Core operation with the same domain meaning, for example
`GET /api/admin/customers` maps to `admin.customers.list`, and
`POST /api/admin/promotions/:id/activate` maps to `admin.promotions.activate`.

### Context, Overview, and Exceptions — must have

- `GET /api/admin/context` — staff principal, capabilities, scopes, environment, and permitted
  navigation.
- `GET /api/admin/scopes` — permitted markets and fulfillment locations.
- `GET /api/admin/overview` — operational briefing, queue counts, exception counts, workload, and
  approved metric summaries.
- `GET /api/admin/exceptions` and `GET /api/admin/exceptions/:id` — scoped cross-domain exception
  queue and detail.
- `POST /api/admin/exceptions/:id/actions` — assign, acknowledge, resolve, or escalate using a
  closed action vocabulary.
- `GET /api/admin/search` — good-to-have permission-filtered global search.

### Customer CRM — must have unless marked good-to-have

- `GET /api/admin/customers` and `GET /api/admin/customers/:customerId` — paginated summaries and a
  composed Customer detail read model.
- `POST /api/admin/customers/invitations` — support-created invitation/provisioning workflow; no
  password input.
- `PATCH /api/admin/customers/:customerId` — approved application-owned profile/support fields.
- `POST /api/admin/customers/:customerId/access` — disable or restore commerce access.
- `POST /api/admin/customers/:customerId/sessions/revoke` — revoke Better Auth sessions through an
  authorized application operation.
- `GET /api/admin/customers/:customerId/orders`, `/payments`, `/promotions`, and `/audit` — scoped
  composed history.
- `POST /api/admin/customers/:customerId/closure-requests` — create an auditable privacy/closure
  request.
- `GET /api/admin/privacy-requests` and
  `POST /api/admin/privacy-requests/:requestId/actions` — work and resolve the privacy queue.
- `GET|POST /api/admin/customers/:customerId/notes` — good-to-have restricted support notes.
- `PATCH /api/admin/customers/:customerId/segments` — good-to-have controlled CRM segments.

### Staff, Roles, and Access — must have unless marked good-to-have

- `GET /api/admin/staff`, `GET /api/admin/staff/:staffId`,
  `POST /api/admin/staff/invitations`, and `PATCH /api/admin/staff/:staffId`.
- `POST /api/admin/staff/:staffId/access` — activate or suspend.
- `PUT /api/admin/staff/:staffId/roles` and `PUT /api/admin/staff/:staffId/scopes` — atomic
  replacement with expected version.
- `POST /api/admin/staff/:staffId/sessions/revoke`.
- `GET /api/admin/roles`, `GET /api/admin/roles/:roleId`, `POST /api/admin/roles`, and
  `PATCH /api/admin/roles/:roleId`.
- `PUT /api/admin/roles/:roleId/capabilities` and
  `POST /api/admin/roles/:roleId/archive`.
- `GET /api/admin/capabilities` — closed capability vocabulary.
- `GET /api/admin/access-review` — good-to-have report for broad, elevated, dormant, or orphaned
  access.

### Promotions — must have unless marked good-to-have

- `GET /api/admin/promotions`, `GET /api/admin/promotions/:promotionId`,
  `POST /api/admin/promotions`, and `PATCH /api/admin/promotions/:promotionId`.
- `POST /api/admin/promotions/:promotionId/activate`, `/deactivate`, and `/archive`.
- `POST /api/admin/promotions/:promotionId/preview` — read-only eligibility/benefit evaluation.
- `GET /api/admin/promotions/:promotionId/redemptions` and
  `POST /api/admin/promotions/:promotionId/grants`.
- `POST /api/admin/promotions/:promotionId/duplicate` and
  `GET /api/admin/promotions/:promotionId/performance` — good-to-have.

Supported benefits are `MEMBERSHIP_FEE_WAIVER`, `ORDER_PERCENT_DISCOUNT`,
`ORDER_FIXED_DISCOUNT`, `DELIVERY_FEE_WAIVER`, and `DELIVERY_FEE_DISCOUNT`. Supported rules are
`FIRST_ORDER`, `NEW_CUSTOMER`, `MEMBER`, `NON_MEMBER`, `MINIMUM_SUBTOTAL`, `CUSTOMER_SEGMENT`, and
`SPECIFIC_CUSTOMERS`. No executable expression or scripting field exists.

### Orders and customer issues — must have unless marked good-to-have

- `GET /api/admin/orders` and `GET /api/admin/orders/:orderId`.
- `POST /api/admin/orders/:orderId/cancel` and
  `POST /api/admin/orders/:orderId/exception-resolution`.
- `GET /api/admin/orders/:orderId/timeline`, `/amendments`, and `/issues`.
- `POST /api/admin/orders/:orderId/issues/:issueId/actions` — claim, investigate, resolve, or
  escalate; never implicitly refund.
- `GET /api/admin/orders/export` — good-to-have asynchronous audited export.

### Payments and Refunds — must have unless marked good-to-have

- `GET /api/admin/payments`, `GET /api/admin/payments/:paymentId`, and
  `POST /api/admin/payments/:paymentId/reconcile`.
- `POST /api/admin/payments/:paymentId/refunds`.
- `GET /api/admin/refunds` and `GET /api/admin/refunds/:refundId`.
- `GET /api/admin/payment-exceptions` and
  `POST /api/admin/payment-exceptions/:id/actions`.
- `GET /api/admin/provider-events` — good-to-have sanitized inbox telemetry; never raw secret data.

### Memberships — must have

- `GET /api/admin/memberships` and `GET /api/admin/memberships/:subscriptionId`.
- `POST /api/admin/memberships/:subscriptionId/pause`, `/resume`, `/cancel`, and `/recover`.
- `GET /api/admin/membership-exceptions` and
  `POST /api/admin/membership-exceptions/:id/actions`.

No API directly patches a Subscription state, asserts payment success, or manually fabricates a
trial. Promotions authorizes trials and canonical Payments outcomes authorize paid activation.

### Catalog and Pricing — must have unless marked good-to-have

- `GET|POST /api/admin/catalog/products` and
  `GET|PATCH /api/admin/catalog/products/:productId`.
- `POST /api/admin/catalog/products/:productId/status`.
- `GET|POST /api/admin/catalog/categories` and
  `PATCH /api/admin/catalog/categories/:categoryId`.
- `GET|POST /api/admin/catalog/units`.
- `GET|POST /api/admin/catalog/skus` and `GET|PATCH /api/admin/catalog/skus/:skuId`.
- `PUT /api/admin/catalog/skus/:skuId/availability`.
- `GET|POST /api/admin/catalog/skus/:skuId/prices`.
- `GET|POST /api/admin/catalog/products/:productId/media` and
  `PATCH /api/admin/catalog/media/:mediaId`.
- `POST /api/admin/catalog/imports` — good-to-have dry-run-first bulk import.

### Inventory — must have unless marked good-to-have

- `GET /api/admin/inventory` and `GET /api/admin/inventory/:inventoryPoolId`.
- `GET /api/admin/inventory/:inventoryPoolId/ledger`.
- `POST /api/admin/inventory/:inventoryPoolId/adjustments`.
- `GET /api/admin/inventory/holds`, `/reservations`, and `/stockouts` — good-to-have diagnostics.

### Procurement and Receiving — must have unless marked good-to-have

- `GET /api/admin/procurement/requirements`.
- `POST /api/admin/procurement/runs`, `GET /api/admin/procurement/runs/:runId`,
  `POST /api/admin/procurement/runs/:runId/approve`, and
  `POST /api/admin/procurement/runs/:runId/purchase-orders`.
- `POST /api/admin/receiving/sessions`,
  `POST /api/admin/receiving/sessions/:sessionId/lines`, and
  `POST /api/admin/receiving/sessions/:sessionId/complete`.
- `POST /api/admin/procurement/exceptions/:id/actions`.
- `GET|POST|PATCH /api/admin/suppliers` — good-to-have minimal supplier administration.

### Fulfillment, Delivery, and Mode Configuration — must have

- `GET /api/admin/fulfillment/queue`.
- `POST /api/admin/fulfillment/tasks/:id/start-picking`, `/picked`, `/shortages`, `/packed`, and
  `/hand-off`.
- `GET /api/admin/delivery/summary` and `GET /api/admin/delivery/exceptions`.
- `POST /api/admin/delivery/batches`,
  `POST /api/admin/delivery/batches/:id/assign-rider`, and
  `PUT /api/admin/delivery/batches/:id/stops`.
- `POST /api/admin/delivery/jobs/:id/reschedule` and
  `POST /api/admin/delivery/jobs/:id/failure-resolution`.
- `GET /api/admin/fulfillment-mode/:locationId` and
  `POST /api/admin/fulfillment-mode/:locationId/activate`.

### Analytics — must have unless marked good-to-have

- `GET /api/admin/analytics/definitions` — metric formula/version/availability/freshness.
- `GET /api/admin/analytics/overview` — approved metric overview by window, timezone, and scope.
- `GET /api/admin/analytics/metrics/:metricCode` — one approved metric series.
- `GET /api/admin/analytics/promotions` and `/operations` — good-to-have domain dashboards.
- `POST /api/admin/analytics/exports` and
  `GET /api/admin/analytics/exports/:exportId` — good-to-have audited exports.

Publishable initial metrics are those already approved in `DOMAIN_MODEL.md`. GMV, revenue/net
sales, AOV, refund rate, trial-to-paid conversion, MRR, churn, Promotion redemption rate, and
inventory turnover return `unavailable` with the canonical reason until their required definitions
are approved. They are never guessed.

### Audit, Jobs, and Settings — must have unless marked good-to-have

- `GET /api/admin/audit` and `GET /api/admin/audit/:auditEventId`.
- Existing `GET /api/admin/jobs`.
- `GET /api/admin/settings/locations`.
- `GET|POST /api/admin/settings/delivery-fees`.
- `GET|POST /api/admin/settings/cycles` and
  `POST /api/admin/settings/cycles/:cycleId/actions`.
- `GET /api/admin/notifications` and
  `POST /api/admin/notifications/:id/retry` — good-to-have after product notifications exist.

## 7. Contract and command rules

Every admin query:

- derives the staff principal from the forwarded session;
- checks a named capability and global/market/location scope;
- uses a purpose-built DTO and bounded cursor pagination for lists;
- returns only fields needed for the decision;
- returns `allowedActions` when lifecycle work is possible;
- exposes freshness/watermark and definition version for Analytics.

Every admin mutation:

- uses a caller-stable `Idempotency-Key`;
- requires `expectedVersion` where concurrent mutation is possible;
- validates a closed command schema;
- requires a reason for material/destructive actions;
- checks legal state transitions and resource scope in Core;
- writes a durable Audit event;
- returns the authoritative Core result, never optimistic invented state.

Provider events use their signed `(provider, providerEventId)` identity and handler-side
compare-and-swap. They never accept client `expectedVersion`.

## 8. Error and recovery model

The common result envelope uses stable error codes and a request ID. Admin UI has explicit handling
for unauthenticated, forbidden, validation, not found, stale version, idempotency conflict, illegal
transition, provider/payment failure, and internal failure. Conflict responses include safe recovery
metadata when available. The UI refreshes on stale version and never silently retries a materially
different command.

## 9. UI information architecture

The approved primary workspaces are Overview, Orders, Catalog, Inventory, Procurement, Fulfillment,
Delivery, Customers, Memberships, Payments, Promotions, Analytics, Staff & Access, Audit, and
Settings. Navigation and actions are capability-aware. Lists use URL-addressable filters and cursor
pagination. Detail pages show status, scope, legal next actions, timelines, exceptions, and audit.
Every workspace covers loading, empty, filtered-empty, scope-empty, error, stale/conflict, pending,
success, and terminal failure states.

## 10. Delivery decomposition

The full program must not be implemented as one unreviewed change. It is delivered in dependency
order:

1. Shared admin contracts, capability vocabulary, context/scopes, shell, table/filter/command
   infrastructure, and Audit query foundation.
2. Staff & Access and role/scope administration.
3. Customer CRM, access control, privacy/closure workflow, and Customer detail composition.
4. Promotions definitions, lifecycle, preview, grants, redemptions, and Promotion UI.
5. Catalog, SKU, units, availability, pricing, media, and Inventory workspaces.
6. Orders, customer issues, Payments, Refunds, Memberships, and finance/reconciliation exceptions.
7. Procurement, Receiving, Fulfillment, Delivery, mode configuration, and operational exception
   convergence.
8. Versioned metric definitions, Analytics read models, Overview composition, and approved exports.
9. Cross-workspace accessibility, security, performance, Playwright, Worker-local, and production
   readiness verification.

Each slice must leave working, tested software and must not silently begin the next slice.

## 11. Testing and acceptance

- Contract schema tests cover every input, DTO, stable error, and absence of infrastructure types.
- Each command covers unauthenticated, unauthorized, out-of-scope, validation, illegal transition,
  stale version, identical replay, and conflicting replay.
- Customer tests prove Better Auth rows are not Customer DTOs and closure does not erase retained
  commercial history.
- Staff tests prove roles/capabilities/scopes are application-owned and no `isAdmin` shortcut exists.
- Promotion tests cover every closed rule/benefit, limits, time windows, deterministic one-order plus
  one-delivery stacking, preview-without-redemption, and history preservation.
- Analytics tests reconcile each published metric to its versioned definition and return explicit
  unavailability for blocked metrics.
- Web component and Playwright tests cover permission/scope states, keyboard/accessibility,
  idempotent submission, stale recovery, and representative workflows.
- Worker-local tests validate Service Binding, D1 migration, Better Auth session, and vinext behavior.
- Verification includes naming, formatting, lint, typecheck, focused/full tests, builds, vinext check,
  and runnable authenticated Playwright flows. Skipped tests are not acceptance evidence.

## 12. Non-goals

- Public general-purpose REST or CORS.
- Direct Web-to-D1 access.
- Generic raw-table CRUD.
- Hard deletion of commercial/audit history.
- Arbitrary executable Promotion rules.
- Direct Subscription or Payment status setters.
- Unapproved production payment-provider or renewal policy.
- Publishing accounting metrics whose canonical definitions are blocked.
- New microservices, Durable Objects, Workflows, KV, or Queues without a documented measured need.

## 13. Success criteria

The design is complete when every approved workspace consumes typed scoped Core read models and
explicit commands; Customer and Staff management obey the approved CRUD semantics; Promotions are
fully manageable without history loss; Analytics publishes only versioned approved definitions;
and all material actions are authorized, idempotent, concurrency-safe, auditable, accessible, and
verified through the Worker/Web boundary.
