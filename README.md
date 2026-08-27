# FreshMarkets

FreshMarkets is a pnpm monorepo targeting Cloudflare Workers.

> **Non-authoritative README.** This file is setup guidance and contains historical phase summaries that may lag implementation. Architecture and scope are defined only by the canonical set named in `AGENTS.md`; current implementation state is described in `docs/product/IMPLEMENTATION_STATUS.md`.

## Phase 0 deployments

- `apps/web`: vinext presentation Worker.
- `apps/core`: authoritative modular-monolith Worker.
- `packages/contracts`: typed Web/Core application boundary.

This Phase 0 summary is historical and must not be read as current implementation status.

## Setup and validation

```sh
pnpm install
pnpm check
```

Generate binding types after changing Wrangler configuration:

```sh
pnpm --filter @freshmarkets/core types
pnpm --filter @freshmarkets/web types
```

## Local development

For normal framework development, run Core and Web in separate terminals:

```sh
pnpm dev:core
pnpm dev:web
```

Web is available at `http://localhost:3000`. The standalone Core Worker listens
on Wrangler's default `http://127.0.0.1:8787`, while browser-facing Better Auth
routes remain under Web at `http://localhost:3000/api/auth/*`.

For the production-built Web Worker plus Core in one Cloudflare local runtime, first build Web, then run the multi-config Wrangler smoke stack:

```sh
pnpm --filter @freshmarkets/web build
pnpm dev:stack
```

The combined stack also uses `http://localhost:3000` as its public origin.

Open `http://localhost:3000/api/core-health` to verify
`Web -> CORE Service Binding -> Core`.

The Core D1 `database_id` is an explicit development placeholder. Replace it with environment-specific provisioned IDs before remote deployment; do not commit secrets to Wrangler configuration.

The Phase 0 compatibility date is pinned to `2026-08-22`, the newest date supported by the installed local `workerd` runtime. Update it deliberately when the Workers/Vitest runtime is upgraded and rerun the full validation suite.
