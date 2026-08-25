# FreshMarkets

FreshMarkets is a pnpm monorepo targeting Cloudflare Workers.

## Phase 0 deployments

- `apps/web`: vinext presentation Worker.
- `apps/core`: authoritative modular-monolith Worker.
- `packages/contracts`: typed Web/Core application boundary.

No authentication or product/business domains are implemented yet.

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

For the production-built Web Worker plus Core in one Cloudflare local runtime, first build Web, then run the multi-config Wrangler smoke stack:

```sh
pnpm --filter @freshmarkets/web build
pnpm dev:stack
```

Open `/api/core-health` on the primary local Worker to verify `Web -> CORE Service Binding -> Core`.

The Core D1 `database_id` is an explicit development placeholder. Replace it with environment-specific provisioned IDs before remote deployment; do not commit secrets to Wrangler configuration.

The Phase 0 compatibility date is pinned to `2026-08-22`, the newest date supported by the installed local `workerd` runtime. Update it deliberately when the Workers/Vitest runtime is upgraded and rerun the full validation suite.
