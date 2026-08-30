# FreshMarkets System Architecture

## Status and Authority

This document is authoritative for the approved runtime, repository, bounded-context ownership, integration boundaries, and layering architecture. `DOMAIN_MODEL.md` owns business meaning and invariants, `STATE_MACHINES.md` owns lifecycle vocabulary and transitions, `DATA_MODEL.md` owns conceptual persistence, and `API_CONTRACTS.md` owns application boundary semantics. Product scope and sequencing are authoritative only in `PRODUCT_SCOPE.md` and `IMPLEMENTATION_PLAN.md`. Status reports, remediation notes, READMEs, code, and migrations do not override these decisions.

## System Shape

FreshMarkets is a single monorepo with two initial Cloudflare Worker deployments:

```text
Browser
  -> apps/web (vinext Worker)
       -> typed Cloudflare Service Binding
            -> apps/core (authoritative Worker)
                 -> D1
                 -> R2
                 -> Queue
                 -> optional KV
                 -> external providers
```

### `apps/web`

Web owns presentation and browser interaction for:

- marketing and public marketplace;
- customer account, subscription, cart, checkout, and order views;
- admin operations;
- dispatch/delivery operations;
- rider tasks;
- the browser-facing authentication experience.

Web uses vinext's Next.js-compatible App Router surface on Cloudflare Workers. Server components, route handlers, and server actions are presentation adapters, not domain authorities. They may call Core but must not implement parallel business rules or access business D1 tables directly.

### `apps/core`

Core owns:

- Better Auth and authentication persistence;
- application authorization and staff/customer context;
- commands, queries, policies, domain services, and legal transitions;
- provider-neutral geocoding ports, permanent provider finalization, and authoritative polygon-based serviceability;
- checkout eligibility and orchestration;
- pricing, subscriptions, promotions, payments, orders, inventory, procurement, receiving, fulfillment, delivery, and audit behavior;
- D1 repositories and external-provider integrations;
- purpose-built read models returned to Web.

Core is a modular monolith. Modules have explicit application/domain/repository boundaries but deploy together. A domain is not extracted into a separate Worker merely because it has a name.

## Bounded Context Ownership

All application bounded contexts below are authoritative modules inside `apps/core`; a context boundary does not imply a separate deployment. A record or transition has one owner. Other contexts react through explicit application commands or consume purpose-built read models rather than mutating the owner's storage.

| Bounded context                    | Authoritative responsibility                                                                                                                                                                                                  | Explicit exclusions                                                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/Auth                      | Better Auth users, credentials/accounts, sessions, email verification, password reset, OAuth, and configured authentication infrastructure                                                                                    | Customer profiles, authorization, membership, promotions, payments, orders, or operations                                                                  |
| Application IAM                    | Customer principals, staff/rider identities, roles, capabilities, market/location scopes, and authorization decisions                                                                                                         | Authentication credentials/sessions and business aggregate state                                                                                           |
| Customers                          | Customer profile and saved-address ownership                                                                                                                                                                                  | Authentication identity and serviceability policy                                                                                                          |
| Geography and Assignment           | Markets, service areas, delivery zones, location capabilities, the single active `INSTANT`/`SCHEDULED` mode configuration per fulfillment location, serviceability, and fulfillment-location assignment                       | Customer-selected hubs, fulfillment execution, and catalog availability                                                                                    |
| Catalog, Availability, and Pricing | Global products, controlled unit registry, persisted sellable SKUs and SKU-specific base consumption, canonical Product media metadata plus validated R2 image storage, and market/location SKU price and availability policy | Physical stock, universal pack/bunch/tray conversions, committed order snapshots, arbitrary caller-controlled object keys, and public asset-serving policy |
| Membership                         | Global effective-dated paid membership prices, per-Subscription agreed-price snapshots, subscriptions, Scheduled-commerce eligibility, billing periods, and subscription lifecycle                                             | Trial eligibility/grants, provider interactions, payment state, and Instant checkout fees                                                                  |
| Promotions                         | Controlled benefit/rule definitions, eligibility, grants, redemptions, deterministic component-level stacking, and the introductory membership trial authority                                                                | Subscription state, arbitrary executable rules, and payment-provider operations                                                                            |
| Cart and Checkout                  | Versioned cart, mode-aware eligibility orchestration, global effective-dated Instant Service Fee policy, immutable quote/fee evidence and financial breakdown, checkout attempt, and pre-payment recovery state                 | Canonical payment state and committed orders                                                                                                               |
| Payments and Refunds               | Provider-neutral payment intents/attempts, commitment policy, provider adapters/mappings, event inbox, refunds, and reconciliation                                                                                            | Membership and order lifecycle ownership                                                                                                                   |
| Orders and Amendments              | Immutable paid order commitment, snapshots, cancellation policy, and additive amendments                                                                                                                                      | Provider financial state and physical fulfillment execution                                                                                                |
| Delivery Cycles and Capacity       | `SCHEDULED` cadence/window/cutoff lifecycle and cycle-zone-location capacity allocation                                                                                                                                       | `INSTANT` fulfillment, order, procurement, and delivery execution states                                                                                   |
| Inventory                          | Integer location inventory positions, expiring Instant checkout holds, committed stocked reservations, planned-demand distinction, and append-only movements                                                                  | Unit/SKU definitions, procurement approval, and fulfillment workflow state                                                                                 |
| Procurement and Receiving          | Demand aggregation, requirements, purchasing, receipt/discrepancy state, and supply exceptions                                                                                                                                | Direct unexplained inventory mutation                                                                                                                      |
| Fulfillment                        | Explicit `INSTANT`/`SCHEDULED` policies after location resolution plus picking, shortage, packing, and handoff state                                                                                                          | Location mode configuration, Order financial truth, and delivery execution                                                                                 |
| Delivery and Rider Work            | Delivery jobs/batches/stops, assignments, rider events, retries, and delivery exceptions                                                                                                                                      | Raw order-state mutation and payment/refund policy                                                                                                         |
| Notifications                      | Transactional message rendering (minimal launch set: email), delivery attempts with status, and notification scheduling metadata                                                                                              | Owning or mutating any business aggregate state; notifications communicate authoritative state and never decide it                                         |
| Audit and Reliability              | Durable audit history, command idempotency, outbox/inbox processing metadata, and operational exceptions                                                                                                                      | Owning another context's business state                                                                                                                    |
| Analytics and Reporting            | Derived operational/business projections, canonical versioned metric definitions, aggregation, and reporting read models                                                                                                      | Authoritative Customer, Order, Payment, Membership, Promotion, Inventory, Fulfillment, or Delivery state                                                   |

The canonical membership, introductory-trial, payment-commitment, and subscription-lifecycle semantics are defined in `DOMAIN_MODEL.md` and `STATE_MACHINES.md`; this table establishes ownership only.

### Product media storage and storefront compatibility

Core owns the `PRODUCT_MEDIA` R2 binding and canonical `product_media` attachment records. Admin uploads cross the typed Service Binding as bounded bytes; Core validates MIME, content signature, size, alt text, ordering, authorization, idempotency, and Product version before attaching D1 metadata. Core alone generates `products/{productId}/{mediaId}` object keys. D1 is authoritative: failed attachment removes the newly stored object, and removal deactivates the guarded D1 record before deleting its R2 object.

The launch produce storefront still reads validated version-1 compatibility metadata (`assetKey`, `altText`) from `product.image_metadata_json`, with binaries under Web's `/produce/*` public path. That compatibility read remains until a separately tested storefront-delivery migration consumes canonical R2 media; Admin authoring does not expose R2 credentials or invent a public asset URL.

## Recommended Repository Structure

```text
apps/
  web/
    app/
    components/
    lib/core-client/
    lib/auth/
    lib/ui/
    public/
    vite.config.ts
    wrangler.jsonc
  core/
    src/
      entrypoint/
      application/
        commands/
        queries/
        policies/
      domain/
      infrastructure/
        d1/
        r2/
        queues/
        integrations/
      read-models/
    migrations/
    wrangler.jsonc
packages/
  contracts/
  validation/
  domain-shared/
  config/
  test-utils/
docs/
```

Core domain modules remain under `apps/core` unless sharing provides a concrete deployment-independent benefit. Likely shared code is limited to RPC contracts, validation schemas, identifiers, money/units/time value objects, configuration, and test utilities.

Remediation decisions that preserve compatibility while aligning the current implementation with this architecture are recorded in `REMEDIATION_DECISIONS.md`. Existing RPC names and historical migrations remain compatibility surfaces until additive migrations and client migrations are complete.

## Web to Core Boundary

Web communicates with Core through a Cloudflare Service Binding and typed RPC methods. Shared source types live in `packages/contracts`; contracts are application DTOs, not database models.

Rules:

- Do not add CORS or public API authentication between Web and Core.
- Do not create one HTTP endpoint per internal operation.
- Do not return untyped `fetch()` payloads or `any`.
- Commands return stable results or domain error codes.
- Queries return purpose-built read models.
- Context passed to Core includes correlation metadata and the authenticated session/principal where applicable.
- Web accepts only a bounded UUID correlation header, replaces invalid values, and forwards one request ID in both the typed input and approved header set. The same ID is returned on success and safe error responses.
- Public JSON/auth/webhook bodies are byte-bounded before parsing or signature verification. Unsupported media types, oversized bodies, malformed JSON, and schema failures remain distinct transport outcomes; raw bodies are never logged.
- Address search returns provider-neutral, session-scoped candidates. Temporary provider responses are never persisted, cached across sessions, or logged; Core performs any provider-required permanent lookup before persisting provider-derived address data.
- Public Core HTTP surface is narrow: provider webhooks, health/operational endpoints where needed, and no general customer REST API.

## Authentication Architecture

Better Auth runs in `apps/core` and persists its tables in D1. It owns authentication identity, accounts, sessions, verification records, Google OAuth, email/password credentials, email verification, password reset, and persistent secure sessions.

Application tables link to the Better Auth user identifier but remain independently owned by their application context:

- `customer_principal` is the auth-linked application principal and commerce access gate;
- `customer` is the commerce aggregate linked 1:1 to that principal;
- customer addresses;
- `staff_principals` and rider identities;
- roles, capabilities, and location scopes;
- memberships, promotions, payments, orders, and every other business record;
- all commerce and operational data.

### Authenticated customer boundary

Every customer-scoped Core command/query derives identity from the Better Auth session
cookie and resolves:

```text
Better Auth user/session -> customer_principal -> customer -> commerce-owned domains
```

Core reconciles a missing principal or customer idempotently. Principal status is checked
on every resolution, including when a customer row already exists; a disabled principal
cannot regain commerce access. Client-provided customer, principal, or auth-user IDs are
not authorization inputs. Better Auth's user-create hook is eager/idempotent provisioning
only and is not treated as a transaction boundary.

The legacy `customer.auth_user_id` column remains populated for compatibility with the
historical schema, but it is not an authentication or authorization authority and no
additional Better Auth identity fields are copied into `customer`.

Web provides login, registration, verification, reset, and OAuth initiation/callback UX. Browser-facing auth routes proxy or route through Web to Core while preserving request URL semantics, origin/host, cookies, `Set-Cookie`, redirects, callback parameters, and CSRF protections. The adapter must stream/forward auth responses faithfully and must not parse and reconstruct cookie headers incorrectly.

Implementation must explicitly prove:

- secure session cookies persist through Web/Core Service Binding calls;
- Google OAuth callback URLs resolve through the public Web origin;
- host/origin validation works in local, preview, and production environments;
- email verification and password-reset links return to the correct public origin;
- logout and session revocation invalidate Core-owned sessions;
- Web cannot manufacture roles, permissions, subscription eligibility, or customer identity.

## Layering

The allowed dependency direction is:

```text
UI/presentation
  -> application queries and commands
      -> domain entities, policies, and services
          -> repository/integration ports
              -> D1, R2, queues, and providers
```

Application services establish transaction boundaries and orchestration. Domain code defines invariants and legal transitions. Repositories map domain concepts to persistence. Infrastructure adapters contain Cloudflare/provider details.

Forbidden paths include UI to arbitrary route to raw SQL, UI-owned payment rules, shared contracts importing D1 row types, and repositories deciding business eligibility.

These boundaries are executable. `pnpm architecture:check` scans every tracked TypeScript/TSX source file with the TypeScript compiler scanner and rejects Web-to-Core source imports, infrastructure-bearing contracts, outward domain/application dependencies, provider-adapter leakage, SQL in Core entrypoint adapters, and exported contract row types. The verifier owns its narrowly documented runtime-composition exceptions; a violation is repaired behind a port or DTO rather than allowlisted for historical convenience. Fixture tests pin each stable diagnostic code and line number.

Core RPC transport is composed from bounded adapters under `apps/core/src/entrypoint`. A shared
`CoreRpcContext` creates and caches the authoritative auth, database, runtime, Payments registry,
and route-distance dependencies; adapters validate transport input, resolve application context,
and delegate once to the owning command/query. `CoreEntrypoint` preserves the exact Service Binding
method surface and Worker lifecycle. The landed Admin and Maps transport groups remain pinned in
the composition root until their independent workstreams authorize a mechanical move; they may
not be used as precedent for adding new business logic there.

## Read and Write Architecture

Use pragmatic CQRS-lite:

- Queries are named for a customer or operational decision, such as `MarketplaceProductView`, `AdminOrderList`, `DeliveryCycleSummary`, and `ProcurementRequirement`.
- Writes are explicit commands such as `ConfirmOrder`, `CreateOrderAmendment`, `ReceiveProcurement`, `AdjustInventory`, `MarkPacked`, and `MarkDelivered`.
- Read and write paths share one D1 database and one deployment. There is no event-sourced command bus or separate read database in the current release.
- Read models may use optimized SQL joins/projections but must retain authorization and scope checks.
- Admin customer summaries, operational queues, and Analytics dashboards compose purpose-built projections over owning contexts. They never use Better Auth tables as the Customer database or mutate source state through projection storage.
- A named metric is publishable only through one versioned canonical definition specifying formula, source context/events, time basis/timezone, inclusion/exclusion rules, and unresolved accounting dependencies.

## Cloudflare Resource Ownership

### D1

D1 is the current-release relational transactional source of truth and is bound only to Core. Use constraints, unique indexes, optimistic versions, conditional updates, and transactional `batch()` operations. Use D1 Sessions only where sequential consistency/read replication requirements justify them.

### R2

R2 stores durable blobs such as product media, future proof-of-delivery files, and generated exports. D1 stores metadata and ownership. A blob upload is not considered attached to a business record until Core validates and commits its metadata.

### Queues

Critical order commitment, capacity, inventory, and payment state changes remain synchronous and transactionally guarded. Launch-scale transactional email uses a D1 outbox and the explicit Core scheduler: stable domain facts project deduplicated intents, bounded leases record every attempt, and adapter failure never rolls back business state or reports delivery. Queues remain deferred until a documented scale or isolation need; future consumers must tolerate duplicate delivery.

### KV

KV is optional for cache/config-like workloads with acceptable staleness. It is never the source of truth for authentication, authorization, inventory, capacity, price, subscription eligibility, or checkout.

### Durable Objects

Durable Objects are not part of the current release architecture. D1 atomic conditional allocation coordinates cycle/zone capacity. A Durable Object per cycle/zone may be introduced only after measured hot-key contention or live coordination requirements show that D1 is insufficient.

### Workflows

Workflows are deferred. They may later orchestrate genuinely long-running procurement, exception, or retry processes. Simple request/response operations and critical synchronous transitions do not use Workflows.

### Cron Triggers

Cloudflare Cron Triggers are the approved time-driven execution mechanism. They own no domain state and contain no business rules: a scheduled handler dispatches through an explicit job registry to existing idempotent Core commands such as checkout/hold expiration, subscription renewal orchestration where application-owned, scheduled-cancellation application, dunning/grace processing, provider-inbox/reconciliation redrive, provider-action expiry, delivery-cycle cutoff and advancement/closeout, and reminder scheduling. Every invoked command keeps its normal authorization, idempotency, expected-version, and concurrency semantics. Provider-inbox redrive uses the same conditional lease and normalized-observation application path as webhook delivery. Renewal initiation is controlled by one fail-closed runtime ownership gate; disabling initiation never disables application of confirmed outcomes or grace-window expiry.

## vinext Compatibility Policy

The The current release may rely on App Router, React Server Components, client components, route handlers, server actions used as thin adapters, middleware for coarse presentation behavior, navigation/headers APIs, metadata, request-time images, and selected static/ISR output.

Before implementation, run a compatibility spike and `vinext check`. Explicitly test nested layouts, loading/error boundaries, cookies, headers, redirects, streaming, Service Binding access, auth route proxying, OAuth redirects, and production Worker builds.

Do not rely on Cache Components, complete PPR semantics, cache profiles/tags, route-level `runtime`/`preferredRegion`, undocumented Next.js behavior, or native Node modules without an explicit passing compatibility test. OpenNext is not the default and may be considered only if a concrete required feature is demonstrably incompatible.

## Observability and Production Basics

- Emit structured JSON logs with correlation/request IDs, actor/principal IDs where safe, command/query name, aggregate identifiers, duration, result, and stable error code.
- All general Core telemetry crosses the redacting observability helper. Cookie, authorization,
  token, secret, password/reset, action URL, webhook/provider payload, and precise-address fields
  are forbidden by runtime redaction plus `pnpm readiness:check` static analysis.
- Enable Cloudflare Worker observability with an intentional sampling policy.
- Trace checkout attempts, provider payment references, webhook event IDs, order commitment, refunds, queue jobs, and reconciliation outcomes.
- Geocoding logs may include operation, duration, result category, and stable error code, but never address text, contact data, coordinates, provider payloads, or temporary candidate contents.
- Keep audit events separate from diagnostic logs. Audit events are durable business records.
- Every externally replayable command requires an idempotency key or provider event identity.
- External provider events are durably deduplicated by `(provider, providerEventId)`. They do not carry an application `expectedVersion`; handlers use current-state validation and conditional aggregate version updates, then safely retry or reconcile after concurrent changes.
- Payment providers are infrastructure adapters. They translate vendor payloads and states into canonical Payments outcomes. Membership and Orders react to those outcomes through explicit idempotent application commands and never infer commitment from browser redirects or payment initiation.
- Secrets live in Cloudflare secret bindings, never source/config.
- Define migration, backup/export, restoration, failed-job, webhook-replay, and reconciliation runbooks before production launch.
- Apply rate limits at abuse-sensitive public boundaries such as login, registration, reset, checkout attempts, and webhook ingress where justified.

Liveness and dependency readiness are different contracts. `/health` and `health()` perform no
dependency call and only prove that the Worker can execute. `/ready` and `readiness()` perform a
bounded D1 probe and report safe runtime/Payments capability state; unavailable configuration,
database, or payment-provider capability returns `not_ready` (HTTP 503 on the HTTP surface).
Readiness never returns secret values, provider payloads, database identifiers, or failure detail.
Traffic promotion requires readiness, not liveness.

Web emits a complete environment-safe security policy: CSP defaults and frame/object/base/form
restrictions, referrer policy, MIME sniffing prevention, least-privilege browser permissions, and
HSTS only for deployed HTTPS environments. The approved Mapbox worker/image/connect sources stay
exact. Production CSP never permits `unsafe-eval`.
Every rendered page receives a cryptographically random request nonce through vinext's supported
Next 16 proxy path. `script-src` permits self-hosted scripts and only inline scripts carrying that
nonce; it permits neither `unsafe-inline` nor `unsafe-eval` in any environment. Static Next headers
do not carry request-varying CSP. Live storefront-auth, Admin, and Maps/serviceability hydration
flows verify the nonce policy while deployed HTTPS environments alone receive HSTS.

## Current Release Versus Future Scaling

The current release uses two Workers, one D1 database, one active Cebu fulfillment location with exactly one configured active fulfillment mode, D1 coordination for the applicable Instant inventory hold or Scheduled cycle capacity, and a provider-neutral payment integration boundary. `SCHEDULED` initially supports `WEEKLY` cadence, but cadence is configuration rather than a platform-wide fulfillment mode. The schema and domain remain multi-location and mode-aware.

Future scaling options include additional locations and markets, D1 read replication sessions for read-heavy operations, Durable Objects for proven hot coordination, stock transfers, central/local procurement routing, Workflows for long-running orchestration, richer analytics stores, and selective module extraction. Extraction requires a demonstrated independent scaling, security, deployment, or ownership need and must preserve typed contracts and business invariants.

## Customer launch Runtime Completion

The launch customer flow remains one Core-owned transaction spine: Membership/Promotions eligibility -> confirmed address and opaque fulfillment option -> immutable Quote and explicit price acceptance -> provider-confirmed Payment outcome -> atomic Order commitment -> customer-safe Order follow-up. Web route handlers are thin same-origin adapters and never select a location, compute a discount, infer payment success, issue a refund, or mutate an Order directly.

Transactional customer messages use a D1 `notification_outbox` claimed by Core's scheduled handler with bounded leases, retry metadata, and immutable attempts. This is deliberately not a Queue/Workflow dependency for the current release. The infrastructure port uses Cloudflare's native Send Email binding with both text and HTML content and preserves stable provider failure codes for retry. Delivery failure cannot roll back or alter the source business transition; a configured, onboarded sender remains a deployment gate and missing configuration fails closed.

Order commitment atomically persists notification intent and invoice-readiness evidence with the Order. Invoice readiness is an internal tax/accounting seam, not issuance: Core records buyer and exact financial snapshots but neither computes unapproved tax nor invents an invoice identifier. Official issuance requires approved seller, tax, serial, and retention policy.
