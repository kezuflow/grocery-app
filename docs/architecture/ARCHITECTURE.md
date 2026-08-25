# FreshMarkets System Architecture

## Status and Authority

This document describes the approved runtime, repository, ownership, and layering architecture. It distinguishes the MVP deployment from possible future scaling options. Product behavior is further defined in `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, and the product scope documents.

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
- checkout eligibility and orchestration;
- pricing, subscriptions, promotions, payments, orders, inventory, procurement, receiving, fulfillment, delivery, and audit behavior;
- D1 repositories and external-provider integrations;
- purpose-built read models returned to Web.

Core is a modular monolith. Modules have explicit application/domain/repository boundaries but deploy together. A domain is not extracted into a separate Worker merely because it has a name.

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

## Web to Core Boundary

Web communicates with Core through a Cloudflare Service Binding and typed RPC methods. Shared source types live in `packages/contracts`; contracts are application DTOs, not database models.

Rules:

- Do not add CORS or public API authentication between Web and Core.
- Do not create one HTTP endpoint per internal operation.
- Do not return untyped `fetch()` payloads or `any`.
- Commands return stable results or domain error codes.
- Queries return purpose-built read models.
- Context passed to Core includes correlation metadata and the authenticated session/principal where applicable.
- Public Core HTTP surface is narrow: provider webhooks, health/operational endpoints where needed, and no general customer REST API.

## Authentication Architecture

Better Auth runs in `apps/core` and persists its tables in D1. It owns authentication identity, accounts, sessions, verification records, Google OAuth, email/password credentials, email verification, password reset, and persistent secure sessions.

Application tables link to the Better Auth user identifier but remain independently owned:

- `customers` and customer addresses;
- `staff_principals`;
- subscriptions;
- roles, capabilities, and location scopes;
- all commerce and operational data.

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

## Read and Write Architecture

Use pragmatic CQRS-lite:

- Queries are named for a customer or operational decision, such as `MarketplaceProductView`, `AdminOrderList`, `DeliveryCycleSummary`, and `ProcurementRequirement`.
- Writes are explicit commands such as `ConfirmOrder`, `CreateOrderAmendment`, `ReceiveProcurement`, `AdjustInventory`, `MarkPacked`, and `MarkDelivered`.
- Read and write paths share one D1 database and one deployment. There is no event-sourced command bus or separate read database in MVP.
- Read models may use optimized SQL joins/projections but must retain authorization and scope checks.

## Cloudflare Resource Ownership

### D1

D1 is the MVP relational transactional source of truth and is bound only to Core. Use constraints, unique indexes, optimistic versions, conditional updates, and transactional `batch()` operations. Use D1 Sessions only where sequential consistency/read replication requirements justify them.

### R2

R2 stores durable blobs such as product media, future proof-of-delivery files, and generated exports. D1 stores metadata and ownership. A blob upload is not considered attached to a business record until Core validates and commits its metadata.

### Queues

Queues handle non-critical asynchronous work: notification delivery, analytics/event ingestion, retryable webhook follow-up, and reconciliation jobs. Critical order commitment, capacity, inventory, and payment state changes remain synchronous and transactionally guarded. Consumers must tolerate duplicate delivery.

### KV

KV is optional for cache/config-like workloads with acceptable staleness. It is never the source of truth for authentication, authorization, inventory, capacity, price, subscription eligibility, or checkout.

### Durable Objects

Durable Objects are not part of the MVP architecture. D1 atomic conditional allocation coordinates cycle/zone capacity. A Durable Object per cycle/zone may be introduced only after measured hot-key contention or live coordination requirements show that D1 is insufficient.

### Workflows

Workflows are deferred. They may later orchestrate genuinely long-running procurement, exception, or retry processes. Simple request/response operations and critical synchronous transitions do not use Workflows.

## vinext Compatibility Policy

The MVP may rely on App Router, React Server Components, client components, route handlers, server actions used as thin adapters, middleware for coarse presentation behavior, navigation/headers APIs, metadata, request-time images, and selected static/ISR output.

Before implementation, run a compatibility spike and `vinext check`. Explicitly test nested layouts, loading/error boundaries, cookies, headers, redirects, streaming, Service Binding access, auth route proxying, OAuth redirects, and production Worker builds.

Do not rely on Cache Components, complete PPR semantics, cache profiles/tags, route-level `runtime`/`preferredRegion`, undocumented Next.js behavior, or native Node modules without an explicit passing compatibility test. OpenNext is not the default and may be considered only if a concrete required feature is demonstrably incompatible.

## Observability and Production Basics

- Emit structured JSON logs with correlation/request IDs, actor/principal IDs where safe, command/query name, aggregate identifiers, duration, result, and stable error code.
- Enable Cloudflare Worker observability with an intentional sampling policy.
- Trace checkout attempts, provider payment references, webhook event IDs, order commitment, refunds, queue jobs, and reconciliation outcomes.
- Keep audit events separate from diagnostic logs. Audit events are durable business records.
- Every externally replayable command requires an idempotency key or provider event identity.
- Secrets live in Cloudflare secret bindings, never source/config.
- Define migration, backup/export, restoration, failed-job, webhook-replay, and reconciliation runbooks before production launch.
- Apply rate limits at abuse-sensitive public boundaries such as login, registration, reset, checkout attempts, and webhook ingress where justified.

## MVP Versus Future Scaling

MVP uses two Workers, one D1 database, D1 capacity coordination, one active Cebu fulfillment location, and a provider-neutral payment integration boundary. The schema and domain remain multi-location.

Future scaling options include additional locations and markets, D1 read replication sessions for read-heavy operations, Durable Objects for proven hot coordination, stock transfers, central/local procurement routing, Workflows for long-running orchestration, richer analytics stores, and selective module extraction. Extraction requires a demonstrated independent scaling, security, deployment, or ownership need and must preserve typed contracts and business invariants.

