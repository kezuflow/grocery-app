# FreshMarkets Agent Instructions

This file is the enforcement and documentation router for this repository. The detailed documents under `docs/` are the source of truth. Read the relevant documents before changing a domain or product surface.

## Mandatory Architecture

- Maintain one monorepo with `apps/web` and `apps/core` as the initial deployments.
- `apps/web` uses vinext and runs on Cloudflare Workers. Validate every relied-on Next.js feature against vinext before adoption.
- `apps/core` is the authoritative Cloudflare Worker and an internal modular monolith.
- Web calls Core through Cloudflare Service Bindings using shared typed contracts. Web must not directly access authoritative D1 data or duplicate Core business logic.
- Core owns application commands, queries, authorization, checkout eligibility, pricing, inventory, procurement, fulfillment, delivery, subscriptions, payments, audit behavior, and business storage.
- Do not introduce public HTTP APIs, CORS, microservices, Durable Objects, Workflows, KV, or Queues without a documented need. Provider webhooks are a narrow exception.
- Preserve the layer direction: UI -> application command/query -> domain policy/service -> repository -> storage/integration.
- Use purpose-built DTOs and read models. Raw database/ORM rows are not public RPC or UI contracts.
- Model meaningful writes as explicit commands with legal transitions, never arbitrary field updates.

## Authentication and Authorization

- Better Auth runs authoritatively in `apps/core` using Cloudflare D1.
- Better Auth owns only users/authentication identities, linked accounts, sessions, and verification/authentication records.
- Customer profiles, addresses, subscriptions, staff identities, roles, permissions, and location scopes are application-owned domains linked to the Better Auth user ID.
- Authentication answers who the user is. Core authorization answers what the user may do.
- Web provides the browser auth experience and proxies auth routes/callbacks to Core while preserving cookies, `Set-Cookie`, callback URLs, host/origin, OAuth redirects, and CSRF protections. Web must not become a second auth authority.
- Verify Better Auth, vinext, Cloudflare Workers, Google OAuth, persistent cookies, and Service Binding behavior with integration tests before relying on them.

## Locked Business Invariants

- A customer must have an active or trialing subscription to successfully checkout, pay, or place an order.
- Payment success is the customer commitment boundary. Paid orders are locked and cannot be freely mutated.
- Delivery-cycle cutoff is the operational/procurement commitment boundary.
- Post-payment additions use an additive amendment/supplemental transaction with independent price and payment history.
- Catalog is global. Availability, sourcing behavior, and physical inventory are location-specific.
- Sellable variants consume a shared product inventory pool expressed in a base unit; variants do not own independent physical stock.
- Stocked inventory reservation and planned-procurement committed demand are separate concepts.
- Historical orders snapshot product, SKU/unit, prices, discounts, address, schedule, and fulfillment context.
- Core authoritatively validates coordinates, serviceability polygons, delivery zone, fulfillment eligibility, cycle/cutoff/capacity, cart, prices, promotions, minimum order, subscription, and payment readiness.
- Customers buy from FreshMarkets and never select a fulfillment hub.
- Preserve multi-market and multi-location support even while MVP operates one Cebu location.
- Maintain independent state machines for subscription, cycle, order, payment, refund, procurement, receiving, fulfillment, and delivery.

## Design Rules

- Admin generic primitives come from shadcn/ui. Build custom components only for meaningful operational compositions.
- Admin screens optimize scanning, decisions, queues, exceptions, and repeated actions; do not expose raw CRUD tables as the information architecture.
- Marketplace UX follows `docs/design/marketplace/DESIGN.md`: mature grocery-commerce patterns inspired by DoorDash, without copying branding or restaurant assumptions.
- Keep interfaces responsive, accessible, and explicit about loading, empty, error, unavailable, cutoff, and permission states.

## Documentation Router

- Any architecture or Cloudflare change: read `docs/architecture/ARCHITECTURE.md` and `docs/architecture/API_CONTRACTS.md`.
- Authentication/session change: read `docs/architecture/ARCHITECTURE.md`, the identity sections of `docs/architecture/DOMAIN_MODEL.md`, `docs/architecture/API_CONTRACTS.md`, and `docs/architecture/DATA_MODEL.md`.
- Checkout, orders, payments, subscriptions, or delivery cycles: read `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `API_CONTRACTS.md`, and `DATA_MODEL.md`.
- Inventory, procurement, receiving, fulfillment, or delivery: read `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, and `DATA_MODEL.md`.
- MVP or sequencing change: read `docs/product/MVP_SCOPE.md` and `docs/product/IMPLEMENTATION_PLAN.md`.
- Admin UI change: read `docs/design/admin/DESIGN.md` and `docs/design/admin/COMPONENTS.md`.
- Marketplace UI change: read `docs/design/marketplace/DESIGN.md` and `docs/design/marketplace/REFERENCES.md`.

## Repository and Testing Conventions

- Follow `docs/architecture/NAMING_CONVENTIONS.md`; run `pnpm naming:check` before committing repository structure, packages, migrations, routes, or source files.
- Keep domain code in `apps/core` unless code is genuinely shared across deployments. Do not fragment packages by noun.
- Shared contracts must not depend on D1 schemas or infrastructure types.
- Store money as integer minor units, quantities as integer base units, timestamps as UTC instants, and operational timezone as explicit market data (`Asia/Manila` initially).
- Use migrations for every schema change once implementation begins; never edit production data manually as part of application behavior.
- Tests must scale with risk and cover domain invariants, legal/illegal transitions, authorization and location scopes, snapshots, idempotency/replay, webhook verification, and concurrent capacity/inventory mutations.
- Run type checks, focused unit/integration tests, Worker-local integration tests, and relevant Playwright flows before considering a phase complete.
- Update canonical documentation in the same change when an approved architecture, contract, state, data, scope, or design decision changes.

## Phase Execution Rules

- Before every implementation phase, read this file, `docs/product/IMPLEMENTATION_PLAN.md`, and every relevant canonical architecture/product/design document named by this router.
- Implement only the authorized phase. Do not silently begin a later phase or change locked business rules because another implementation is easier.
- If implementation exposes a documentation gap, update the canonical document. Report any material business-rule change instead of assuming it.
- Before completion, compare work against that phase's acceptance criteria and fix relevant type, lint, test, build, and runtime-validation failures.
- The final report must state implemented work, important files/modules, database/schema changes, RPC/contracts, tests and validation, documentation updates, deviations/risks, and what the next phase can rely on.
