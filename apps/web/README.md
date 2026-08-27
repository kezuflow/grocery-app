# FreshMarkets Web

> **Non-authoritative README.** This file is operational/setup guidance and includes historical phase notes. It does not define architecture, domain ownership, lifecycle, or current implementation status; use the canonical set named in `AGENTS.md` and `docs/product/IMPLEMENTATION_STATUS.md`.

vinext presentation Worker. Phase 1 contains browser auth screens and a thin Web -> Core auth proxy. Web does not own auth storage or interpret Better Auth identity.

## Scripts

- `pnpm run dev` starts the vinext dev server at `http://localhost:3000`.
- `pnpm run build` builds the Cloudflare Worker output.
- `pnpm run start` starts the built Worker locally with Wrangler.
- `pnpm run deploy` deploys the Cloudflare Worker.
- `pnpm run check:vinext` runs the vinext compatibility scan.

The Web Worker has no D1 binding. Its `CORE` Service Binding targets `freshmarkets-core`.

Browser auth requests use `http://localhost:3000/api/auth/*` in local development;
the proxy forwards the configured public URL/origin/host and reproduces all Core
response headers, including repeated `Set-Cookie` headers. `/api/auth-context`
exposes the Core application context DTO for capability-aware shells.

Phase 2 adds `/serviceability` and `/api/serviceability` as thin coordinate-evaluation surfaces. Web forwards coordinates to Core and does not evaluate polygons or select fulfillment locations.

## Marketplace storefront

The `/` marketplace home is a server component that reads the catalog and category navigation
directly from Core through the Service Binding (`coreClient(env.CORE)`); it does not go through
`/api/catalog`. Interactivity hydrates on top of the server-rendered output:

- `lib/storefront/catalog-presentation.ts` maps contract DTOs to presentation view-models
  (deterministic default variant selected from Core's merchandising metadata, Core-provided
  media paths plus alt text, ordered details, approximate pack contents notes, money formatting).
  Web owns no catalog data: images come from D1 through the Service Binding, invalid media falls
  back to an accessible placeholder, and missing prices render as unavailable, never zero.
- `lib/storefront/storefront-pagination.ts` merges cursor pages without duplicate products;
  `components/storefront/marketplace/catalog-results.tsx` loads them progressively over
  `/api/catalog` with live announcements while the server renders only the first page.
- `lib/storefront/cart-client.ts` wraps `/api/commerce/cart` with a cart-change broadcast
  (`fm:cart-changed`) and a toast channel (`fm:storefront-toast`). Cart mutations require an
  authenticated customer; anonymous add-to-cart shows a sign-in affordance instead of
  redirecting. Pre-auth add-to-cart needs a Core anonymous-cart capability and is future work.
- `components/storefront/marketplace/` holds the marketplace surface pieces (hero, promo
  banners, add-to-cart stepper, cart indicator, toast announcer, quick-view provider/dialog).
- `tests/storefront-home.spec.ts` covers anonymous browse, server-side filtering, the quick-view
  dialog, and the sign-in boundary against a provisioned local stack.
