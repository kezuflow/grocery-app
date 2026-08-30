# FreshMarkets Agent Instructions

This file is the enforcement and documentation router for this repository. The canonical set is `AGENTS.md`, `docs/architecture/ARCHITECTURE.md`, `docs/architecture/DOMAIN_MODEL.md`, `docs/architecture/STATE_MACHINES.md`, `docs/architecture/DATA_MODEL.md`, `docs/architecture/API_CONTRACTS.md`, `docs/product/PRODUCT_SCOPE.md`, and `docs/product/IMPLEMENTATION_PLAN.md`. `IMPLEMENTATION_STATUS.md`, phase reviews, remediation notes, READMEs, code, and migration history describe implementation or historical compatibility; they do not override the canonical set. Read the relevant canonical documents before changing a domain or product surface.

## Mandatory Architecture

- Maintain one monorepo with `apps/web` and `apps/core` as the initial deployments.
- `apps/web` uses vinext and runs on Cloudflare Workers. Validate every relied-on Next.js feature against vinext before adoption.
- `apps/core` is the authoritative Cloudflare Worker and an internal modular monolith.
- Web calls Core through Cloudflare Service Bindings using shared typed contracts. Web must not directly access authoritative D1 data or duplicate Core business logic.
- Core owns the application bounded contexts, commands, queries, authorization, business storage, and provider adapters enumerated in `ARCHITECTURE.md`. Each state has exactly one owning bounded context even though all contexts deploy together in Core.
- Do not introduce public HTTP APIs, CORS, microservices, Durable Objects, Workflows, KV, or Queues without a documented need. Provider webhooks are a narrow exception.
- Preserve the layer direction: UI -> application command/query -> domain policy/service -> repository -> storage/integration.
- Use purpose-built DTOs and read models. Raw database/ORM rows are not public RPC or UI contracts.
- Model meaningful writes as explicit commands with legal transitions, never arbitrary field updates.

## Authentication and Authorization

- Better Auth runs authoritatively in `apps/core` using Cloudflare D1.
- Better Auth owns only authentication users/identities, credentials and linked accounts, sessions, email verification, password reset, OAuth, and other authentication infrastructure required by its configured plugins.
- Customer profiles, addresses, subscriptions, staff identities, roles, permissions, and location scopes are application-owned domains linked to the Better Auth user ID.
- Authentication answers who the user is. Core authorization answers what the user may do.
- Web provides the browser auth experience and proxies auth routes/callbacks to Core while preserving cookies, `Set-Cookie`, callback URLs, host/origin, OAuth redirects, and CSRF protections. Web must not become a second auth authority.
- Verify Better Auth, vinext, Cloudflare Workers, Google OAuth, persistent cookies, and Service Binding behavior with integration tests before relying on them.

## Locked Business Invariants

- `INSTANT` is authenticated pay-as-you-go commerce and does not require membership. `SCHEDULED` requires an active, trialing, or past-due-within-grace subscription at quote, payment revalidation, and commitment. The introductory trial and paid renewal require a recurring-capable payment authorization; establishing authorization is never payment success, and no zero-value payment is synthesized.
- Membership has one global effective-dated paid price and currency. A Subscription snapshots the price version, amount, and currency agreed at enrollment and retains that price until a separately authorized migration; ordinary price changes apply only to new Subscriptions. The introductory free trial is a Promotion grant over that paid membership for exactly one calendar billing month; it is not a zero-price offer or plan.
- The FreshMarkets Service Fee is one global effective-dated `FLAT`, `PERCENTAGE`, or `MIXED` configuration applied only to `INSTANT`. Percentage applies to the complete payable total before the Service Fee; `MIXED` is flat plus percentage. Quotes and Orders snapshot the configuration and calculation, and payment revalidation rejects stale fee evidence with `PRICE_CHANGED`. It is a FreshMarkets charge, not a payment-provider processing fee.
- Membership owns subscription state; Promotions owns trial eligibility/grant/redemption; Payments owns all provider interactions and canonical financial state. Better Auth owns none of these concepts.
- `CANCELED` and `EXPIRED` are distinct terminal subscription states. Scheduled cancellation is intent metadata while the subscription remains in its entitled state until an explicit transition at the effective instant.
- Paid membership activation and paid order commitment require a provider-confirmed canonical Payments outcome sufficient under the configured payment commitment policy. For the current release, provider captured/success states map to canonical `SUCCEEDED`; browser return state or payment initiation is never sufficient.
- Paid orders are locked and cannot be freely mutated after commitment.
- Customer fulfillment mode is exactly `INSTANT` or `SCHEDULED`. Each active fulfillment location has one active mode configuration; `WEEKLY` is the initial Scheduled cadence, never a fulfillment mode. A later configuration change never rewrites a committed Order's fulfillment snapshot.
- Fulfillment mode and sourcing mode are separate. Canonical sourcing values are `STOCKED`, `PLANNED`, `ON_DEMAND`, and `MIXED`; valid combinations include `INSTANT + STOCKED` and `SCHEDULED + PLANNED`.
- Scheduled delivery-cycle cutoff is the operational/procurement commitment boundary for `SCHEDULED`. `INSTANT` checkout must not be forced through delivery-cycle semantics and instead uses current location inventory, an expiring checkout hold/reservation, and mode-specific fulfillment promises.
- Post-payment additions use an additive amendment/supplemental transaction with independent price and payment history.
- Catalog is global. Availability, sourcing behavior, and physical inventory are location-specific.
- Inventory balances and demand use integer canonical base units `GRAM`, `MILLILITER`, or `PIECE`. Controlled sell units are data-driven within `MASS`, `VOLUME`, or `COUNT`; cross-dimension conversion and floating-point authoritative quantities are forbidden.
- Sellable variants are persisted configuration and consume a SKU-specific integer quantity from a shared product inventory pool; variants do not own independent physical stock. Pack, bunch, tray, and similar labels never define global conversions.
- Authoritative price belongs to a sellable SKU in its applicable market/location price context. Missing or invalid price is unavailable, never silently zero.
- Stocked inventory reservation and planned-procurement committed demand are separate concepts.
- Historical orders snapshot product, SKU/unit and base consumption, prices and explicit monetary components, discounts/promotions, address, fulfillment mode/location/zone/promise, and Scheduled cycle/window identifiers where applicable.
- Promotions owns one controlled benefit/rule system for membership fee waivers, order discounts, and delivery discounts. Current-release stacking permits at most one merchandise/order benefit plus one delivery benefit; Membership benefits remain separate. Arbitrary executable promotion scripting is forbidden.
- Core authoritatively validates coordinates, serviceability polygons, delivery zone, fulfillment mode/location/promise, mode-specific inventory or cycle/cutoff/capacity, cart, SKU prices, promotions/stacking, minimum order, mode-specific membership entitlement, Service Fee evidence where applicable, and payment readiness.
- Customers buy from FreshMarkets and never select a fulfillment hub.
- Preserve multi-market and multi-location support even while the the current release operates one Cebu location.
- Maintain independent state machines for subscription, cycle, order, payment, refund, procurement, receiving, fulfillment, and delivery.
- Client/application/admin lifecycle commands require stable idempotency keys and expected aggregate versions where concurrent mutation is possible. Provider events never invent or accept client `expectedVersion` values; they use unique `(provider, providerEventId)` inbox identity, handler-side compare-and-swap protection, and safe retry/reconciliation.
- Admin uses purpose-built Core commands/read models and capability-based IAM, never raw tables, Better Auth user rows as Customer records, or a global `isAdmin` authority.
- Analytics is a derived read-side concern inside the Core modular monolith for the current release. Every published named metric requires one versioned canonical definition; Analytics never owns Customer, Order, Payment, Membership, Promotion, Inventory, Fulfillment, or Delivery state.

## Design Rules

- Admin generic primitives come from shadcn/ui. Build custom components only for meaningful operational compositions.
- Admin screens optimize scanning, decisions, queues, exceptions, and repeated actions; do not expose raw CRUD tables as the information architecture.
- Marketplace UX follows `docs/design/marketplace/DESIGN.md`: mature grocery-commerce patterns inspired by DoorDash, without copying branding or restaurant assumptions.
- Keep interfaces responsive, accessible, and explicit about loading, empty, error, unavailable, cutoff, and permission states.

## Documentation Router

- Any architecture or Cloudflare change: read `docs/architecture/ARCHITECTURE.md` and `docs/architecture/API_CONTRACTS.md`.
- Authentication/session change: read `docs/architecture/ARCHITECTURE.md`, the identity sections of `docs/architecture/DOMAIN_MODEL.md`, `docs/architecture/API_CONTRACTS.md`, and `docs/architecture/DATA_MODEL.md`.
- Checkout, orders, payments, subscriptions, or delivery cycles: read `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `API_CONTRACTS.md`, and `DATA_MODEL.md`.
- Catalog, units, SKUs, pricing, fulfillment modes, or promotions: read `DOMAIN_MODEL.md`, `API_CONTRACTS.md`, and `DATA_MODEL.md`; read `STATE_MACHINES.md` when lifecycle or commitment behavior changes.
- Inventory, procurement, receiving, fulfillment, or delivery: read `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, and `DATA_MODEL.md`.
- Product scope or sequencing change: read `docs/product/PRODUCT_SCOPE.md` and `docs/product/IMPLEMENTATION_PLAN.md`.
- Admin or Analytics change: read the Admin/Analytics sections of `DOMAIN_MODEL.md`, `API_CONTRACTS.md`, and `DATA_MODEL.md`, plus `docs/design/admin/DESIGN.md` and `docs/design/admin/COMPONENTS.md` for Admin UI.
- Marketplace UI change: read `docs/design/marketplace/DESIGN.md` and `docs/design/marketplace/REFERENCES.md`.

## Repository Workflow

- Trunk-based development: this is a single-developer repository; commit directly to `main` and push with `git push origin main`. Full policy: `TRUNK.md`.
- Do not create feature branches, push branches, or open PRs unless the owner explicitly requests an exception.
- The `.githooks/pre-push` guard rejects pushes of any branch other than `main`; bypass only with `--no-verify` for an owner-approved exception.
- Convention checks run locally on every commit (`commit-msg` message convention, `pre-commit` naming) and every push (`pre-push` naming plus commit-message range). There are no GitHub Actions checks.
- Use separate git worktrees only to protect uncommitted local state, never as a parallel branch strategy; land their commits on `main` promptly.

## Repository and Testing Conventions

- Follow `docs/architecture/NAMING_CONVENTIONS.md`; run `pnpm naming:check` before committing repository structure, packages, migrations, routes, or source files.
- Keep domain code in `apps/core` unless code is genuinely shared across deployments. Do not fragment packages by noun.
- Shared contracts must not depend on D1 schemas or infrastructure types.
- Store money as integer minor units, quantities as integer base units, timestamps as UTC instants, and operational timezone as explicit market data (`Asia/Manila` initially).
- Use migrations for every schema change once implementation begins; never edit production data manually as part of application behavior.
- Tests must scale with risk and cover domain invariants, legal/illegal transitions, authorization and location scopes, snapshots, idempotency/replay, webhook verification, and concurrent capacity/inventory mutations.
- Run type checks, focused unit/integration tests, Worker-local integration tests, and relevant Playwright flows before considering a phase complete.
- Update canonical documentation in the same change when an approved architecture, contract, state, data, scope, or design decision changes.
- Update `IMPLEMENTATION_STATUS.md` and READMEs only as descriptive, non-authoritative records after the canonical documents agree.

## Phase Execution Rules

- Before every implementation phase, read this file, `docs/product/IMPLEMENTATION_PLAN.md`, and every relevant canonical architecture/product/design document named by this router.
- Implement only the authorized phase. Do not silently begin a later phase or change locked business rules because another implementation is easier.
- If implementation exposes a documentation gap, update the canonical document. Report any material business-rule change instead of assuming it.
- Before completion, compare work against that phase's acceptance criteria and fix relevant type, lint, test, build, and runtime-validation failures.
- The final report must state implemented work, important files/modules, database/schema changes, RPC/contracts, tests and validation, documentation updates, deviations/risks, and what the next phase can rely on.
