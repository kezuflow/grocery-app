# FreshMarkets Web

> **Non-authoritative README.** This file is operational/setup guidance and includes historical phase notes. It does not define architecture, domain ownership, lifecycle, or current implementation status; use the canonical set named in `AGENTS.md` and `docs/product/IMPLEMENTATION_STATUS.md`.

vinext presentation Worker. Phase 1 contains browser auth screens and a thin Web -> Core auth proxy. Web does not own auth storage or interpret Better Auth identity.

## Scripts

- `pnpm run dev` starts the vinext dev server.
- `pnpm run build` builds the Cloudflare Worker output.
- `pnpm run start` starts the built Worker locally with Wrangler.
- `pnpm run deploy` deploys the Cloudflare Worker.
- `pnpm run check:vinext` runs the vinext compatibility scan.

The Web Worker has no D1 binding. Its `CORE` Service Binding targets `freshmarkets-core`.

Browser auth requests use `/api/auth/*`; the proxy forwards the original URL/origin/host and reproduces all Core response headers, including repeated `Set-Cookie` headers. `/api/auth-context` exposes the Core application context DTO for capability-aware shells.

Phase 2 adds `/serviceability` and `/api/serviceability` as thin coordinate-evaluation surfaces. Web forwards coordinates to Core and does not evaluate polygons or select fulfillment locations.
