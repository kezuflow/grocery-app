# FreshMarkets

A pnpm monorepo with vinext Web and authoritative Core Workers. Start with [AGENTS.md](AGENTS.md) for the five-guide reading route. Current commerce work and evidence live in [the execution checkpoint](docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md); archived phase summaries are not acceptance.

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

Run the vinext Web Worker and its Core auxiliary Worker together in one Vite runtime:

```sh
pnpm dev
```

Web is available at `http://localhost:3000`. Keeping both Workers in the same local
runtime preserves the `CORE` RPC binding across vinext program reloads. Browser-facing
Better Auth routes remain under Web at `http://localhost:3000/api/auth/*`. Use
`pnpm dev:core` only when working on Core in isolation. Both commands use Core's
existing local state under `apps/core/.wrangler/state`.

For the production-built Web Worker plus Core in one Cloudflare local runtime, first build Web, then run the multi-config Wrangler smoke stack:

```sh
pnpm --filter @freshmarkets/web build
pnpm dev:stack
```

The combined stack also uses `http://localhost:3000` as its public origin.

Open `http://localhost:3000/api/core-health` to verify
`Web -> CORE Service Binding -> Core`.

The Core D1 `database_id` is an explicit development placeholder. Replace it with environment-specific provisioned IDs before remote deployment; do not commit secrets to Wrangler configuration.
