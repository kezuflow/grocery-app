# FreshMarkets Core

## Engineering guidance

Follow [AGENTS.md](../../AGENTS.md), [coding standards](../../docs/architecture/CODING_STANDARDS.md), and [testing guidance](../../docs/architecture/TESTING.md). Core owns commands, domain policy, authorization, persistence, and integration adapters. Guard entire write units, keep per-effect idempotency identities distinct, and test rejection/concurrency outcomes against Worker/D1 behavior.

Schema redesign and migration rebasing are allowed before launch under the [lifecycle policy](../../docs/architecture/CODING_STANDARDS.md#pre-launch-schema-and-interface-policy). Reconcile generators, fixtures, contracts, and consumers in the same change; do not preserve old schema only because a historical phase used it.

> **Non-authoritative README.** This file is operational/setup guidance and includes historical phase notes. It does not define architecture, domain ownership, lifecycle, or current implementation status; use the canonical set named in `AGENTS.md` and `docs/product/IMPLEMENTATION_STATUS.md`.

Authoritative modular-monolith Worker. Phase 1 adds:

- `health()` typed Service Binding RPC;
- Better Auth request handling at `/api/auth/*`, backed only by Core D1;
- `getApplicationContext()` typed RPC for application-owned staff capabilities and scopes;
- `GET /health` for local/runtime smoke checks;
- structured 404 errors.

Better Auth owns authentication infrastructure only. Staff roles, permissions, scopes, and customer principals are Core-owned application records. The remainder of this paragraph's Phase 1 scope boundary is historical; later commerce work is described by the non-authoritative implementation status and governed by the canonical documents.

Phase 2 adds the authoritative `resolveServiceability()` RPC backed by versioned D1 service areas, delivery zones, fulfillment-location capabilities, and zone eligibility. Textual city labels are never authoritative, and the resolver does not allow customer location selection.

Catalog seed tooling lives in `src/catalog/seed/`: the typed 226-product produce manifest with its aggregate validator (`pnpm --filter @freshmarkets/core test`) and the deterministic SQL generator. `pnpm catalog:generate` rewrites `migrations/0025_complete_produce_catalog.sql`; `pnpm catalog:check` fails on drift. Generated artifacts are regenerated from the maintained manifest/generator rather than hand-edited. A pre-launch schema rebaseline must update the generator and its verifier together; the current script path is implementation evidence, not an immutable schema requirement.

Configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` as Core secrets/vars per environment. Google routes are intentionally unavailable until both Google credentials are configured. Auth email uses the Core delivery port and configured transactional email binding. Isolated tests inject fakes; development and production never log reset/verification bearer URLs or recipients. See the auth-email setup runbook.

For local development, `BETTER_AUTH_URL` is the browser-facing Web origin
`http://localhost:3000`; it is not the standalone Core listener. `pnpm dev:core`
uses Wrangler's default `http://127.0.0.1:8787` listener.

## Customer launch runtime

Core exposes typed Membership, Promotion-aware checkout, opaque fulfillment-option, Payment/Order, customer Order detail/reorder/issue/amendment/cancellation, provisional transaction-summary, notification-outbox, and invoice-readiness application surfaces. Customer Web clients submit confirmed address/cart versions and an opaque fulfillment option; Core resolves the internal location/mode/cycle and repeats every authoritative check at Quote/payment/commitment boundaries.

The scheduled notification job uses the configured Cloudflare Send Email binding and `AUTH_EMAIL_FROM`; missing configuration or provider failures retry/fail safely and never change the source business outcome. The intended sender is `notifications@freshmarkets.ph`, but it must remain unset until `freshmarkets.ph` is owned, onboarded for Cloudflare Email Sending, and authenticated. Invoice readiness is evidence only until approved seller/tax/serial/retention policy enables official issuance.
