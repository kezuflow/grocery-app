# FreshMarkets Core

> **Non-authoritative README.** This file is operational/setup guidance and includes historical phase notes. It does not define architecture, domain ownership, lifecycle, or current implementation status; use the canonical set named in `AGENTS.md` and `docs/product/IMPLEMENTATION_STATUS.md`.

Authoritative modular-monolith Worker. Phase 1 adds:

- `health()` typed Service Binding RPC;
- Better Auth request handling at `/api/auth/*`, backed only by Core D1;
- `getApplicationContext()` typed RPC for application-owned staff capabilities and scopes;
- `GET /health` for local/runtime smoke checks;
- structured 404 errors.

Better Auth owns authentication infrastructure only. Staff roles, permissions, scopes, and customer principals are Core-owned application records. The remainder of this paragraph's Phase 1 scope boundary is historical; later commerce work is described by the non-authoritative implementation status and governed by the canonical documents.

Phase 2 adds the authoritative `resolveServiceability()` RPC backed by versioned D1 service areas, delivery zones, fulfillment-location capabilities, and zone eligibility. Textual city labels are never authoritative, and the resolver does not allow customer location selection.

Catalog seed tooling lives in `src/catalog/seed/`: the typed 226-product produce manifest with its aggregate validator (`pnpm --filter @freshmarkets/core test`) and the deterministic SQL generator. `pnpm catalog:generate` rewrites `migrations/0025_complete_produce_catalog.sql`; `pnpm catalog:check` fails on drift. Generated migrations are committed artifacts and never hand-edited.

Configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` as Core secrets/vars per environment. Google routes are intentionally unavailable until both Google credentials are configured. Development email hooks log verification/reset URLs for test capture; production needs a configured transactional email binding/provider.

For local development, `BETTER_AUTH_URL` is the browser-facing Web origin
`http://localhost:3000`; it is not the standalone Core listener. `pnpm dev:core`
uses Wrangler's default `http://127.0.0.1:8787` listener.
