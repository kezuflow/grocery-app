# Architecture and Security Hardening Final Report

**Repository:** FreshMarkets  
**Date:** 2026-08-30  
**Scope:** Whole-codebase remediation outside the separately owned Admin Dashboard and Maps behavior  
**Integrated base:** `98c23789c2a2bf245fbdc18c1d461941718acd94`

## Outcome

The architecture and security hardening program is implemented for the authorized non-Admin,
non-Maps scope. FreshMarkets remains a two-Worker Cloudflare modular monolith: Web is a thin vinext
BFF and Core remains the sole application, authorization, D1, provider, and lifecycle authority.
No microservice, public business HTTP API, Durable Object, Workflow, KV, or Queue was introduced.

The work made the intended boundaries executable, bounded public request bodies in the authorized
non-Admin/non-Maps route families, unified request correlation, completed Web security headers,
separated liveness from dependency readiness, added safe observability checks, regenerated Worker
binding types, and reduced the Core entrypoint by moving non-excluded RPC transport groups into
bounded adapters.

## Implemented work

- Added a TypeScript-AST architecture verifier and repository gate covering Web-to-Core source
  imports, contract infrastructure leakage, inward layer direction, provider leakage, entrypoint
  SQL, and public row exports.
- Split production contracts into bounded modules and added an exhaustive 136-method runtime
  manifest plus compile/runtime Core Service Binding conformance tests.
- Added cached `CoreRpcContext` construction and bounded auth, catalog, membership, checkout,
  payment, order, inventory, procurement, fulfillment, and delivery-operation RPC adapters.
- Kept the remaining Admin and Maps transports in `apps/core/src/index.ts` by explicit user scope;
  a structural test makes that exception visible and prevents extracted adapters from acquiring SQL
  or schema ownership.
- Added incremental byte-bounded request readers with early `Content-Length`, media-type, malformed
  body, multibyte, streaming overflow, and exact webhook-body coverage.
- Migrated the authorized non-Admin/non-Maps public command routes to bounded parsing and a single
  validated UUID request context that is forwarded to Core and returned in safe success/error
  responses. Admin and Maps routes retain their handed-off transport behavior by explicit scope.
- Added environment-safe CSP, referrer, MIME-sniffing, framing, permissions, and deployed-only HSTS
  policy. Production contains no `unsafe-eval`.
- Added separate Core liveness and readiness contracts. Liveness performs no dependency work;
  readiness uses bounded D1/config/provider capability checks and exposes no secrets.
- Added redacted structured-observability enforcement, explicit Wrangler log/trace sampling, current
  generated Worker types, and a deployment runbook for Cloudflare WAF/rate-limit ownership.
- Eliminated actionable lint warnings and documented all implemented boundaries in the canonical
  architecture, API, implementation-plan, and implementation-status documents.

## Important modules

- `scripts/verify-architecture-boundaries.mjs`
- `scripts/verify-readiness-security.mjs`
- `packages/contracts/src/core-service.ts`
- `apps/core/src/entrypoint/`
- `apps/core/src/runtime/readiness.ts`
- `apps/core/src/http/bounded-body.ts`
- `apps/web/lib/http/bounded-body.ts`
- `apps/web/lib/http/request-context.ts`
- `apps/web/lib/security/headers.ts`
- `docs/operations/DEPLOYMENT_RUNBOOK.md`

## Data and migration impact

Architecture hardening itself adds no migration. Earlier remediation programs in the same integrated
range add `0044_financial_safety.sql`, `0045_finance_exception_taxonomy.sql`, and
`0046_cart_and_inbox_reliability.sql` for financial commitment, exception taxonomy, cart concurrency,
and provider-inbox reliability.

The separately owned migration blobs remain byte-identical by Git blob identity:

- Admin `0041_admin_catalog_authoring.sql`:
  `9b18c5788eec5a0954097cd564712f15966bcd61`
- Maps `0042_mapbox_address_confirmation.sql`:
  `e9651fc4f4778eac1cc78c8863b24b7e4ebb8ab3`
- Maps `0043_delivery_batches_and_map_stops.sql`:
  `1f7a1df387f8ff634e6b36a44f042b9081b931f0`

## Contracts and RPC

`CoreServiceBinding` now advertises exactly the runtime surface through a 136-method manifest. The
only additive transport behavior in this hardening slice is typed readiness; existing Admin and Maps
method names, DTOs, route behavior, capability checks, pagination/revision bounds, and Rider authority
are preserved. Web continues to call Core only through the Service Binding.

## Acceptance evidence

- Formatting, naming, migration, catalog, architecture, readiness/security, lint, typecheck, and
  diff checks pass.
- The complete unit/integration run passes 1,246 tests across 177 files: Contracts 58, validation 2,
  shared domain 2, Web 445 across 52 files, and Core 737 across 125 files, plus two configuration
  tests.
- Core and Web production dry-run builds pass.
- vinext reports 100% compatibility: 12 supported, zero partial, zero issues.
- `pnpm audit --audit-level moderate` reports no known vulnerabilities.
- The deterministic Web/Core/D1 Playwright stack passes 78 browser tests. One Rider empty-state test
  is an established explicit skip because its auth-email fixture is not configured; the other Rider
  flows and all Maps, storefront, and Admin transport acceptance in the suite pass.
- The Web build emits a non-failing chunk-size advisory. This is a performance optimization target,
  not a correctness or compatibility failure.

## Maps and Admin preservation

No Maps or Admin product behavior was redesigned. The exact Mapbox CSP fragments remain:
`worker-src 'self' blob:`, `img-src 'self' data: blob:`, and
`connect-src 'self' https://api.mapbox.com https://events.mapbox.com`. The implementation does not
reintroduce `preferred_location_id` as Rider assignment authority. Admin/Maps code encountered by
the hardening was limited to mechanical transport/header compatibility and unused-import cleanup.

## Deviations and remaining risks

- The original decomposition plan proposed extracting Admin and Maps RPC transports too. The user
  explicitly excluded those simultaneous programs, so their methods remain in the Core entrypoint.
  `apps/core/src/index.ts` is therefore 2,355 lines rather than a fully forwarding-only shell.
- Admin and Maps route families still contain handed-off direct `request.json()` calls. They were not
  rewritten in this program because doing so would edit the explicitly excluded surfaces; they remain
  a bounded-body follow-up for their respective owners.
- The complete Customer MVP program remains separate and unimplemented. Membership customer UX,
  checkout promotion redemption, customer order detail/timeline/reorder/issues, abandonment and
  cancellation availability, additive amendments, durable notifications, invoice readiness, and
  explicit mode selection remain tracked by
  `docs/superpowers/plans/2026-08-30/CUSTOMER_MVP_COMPLETION_IMPLEMENTATION.md`.
- Production payment/email providers, credentials, tax/invoice policy, committed-order cancellation
  policy, Cloudflare WAF/rate limits, secrets/origins/OAuth callbacks, and operational alerting require
  owner/provider decisions. Deployed readiness intentionally fails closed until configured.
- Cloudflare edge controls are deployment configuration; repository checks and the runbook cannot
  prove they are enabled in a production account.
- The Web bundle-size advisory should be profiled before launch, particularly the Mapbox-dependent
  client surface, without changing Maps behavior during this program.

## What the next program can rely on

Program 4 can build against authoritative bounded contracts, exact runtime conformance, safe request
parsing/correlation, complete security headers, typed readiness, durable financial/cart/provider
foundations, and preserved Admin/Maps behavior. It must not claim production launch readiness until
the external owner decisions above are resolved and the one gated Rider browser scenario is run with
its approved email fixture.
