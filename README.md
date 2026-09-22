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
`pnpm dev:core` only when working on Core in isolation.

By default, `pnpm dev` is isolated. It uses local D1, R2 and Queue state under
`apps/core/.wrangler/state`, disables outbound Email, and keeps payment and delivery
providers disabled. It does not write deployed storage or a deployed notification
outbox. Use `pnpm seed:development` when that isolated database needs representative
data.

Secrets remain in ignored `apps/core/.dev.vars` and `apps/web/.dev.vars`; deployed
secret values cannot be downloaded from Wrangler. Google login additionally needs
local `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and an allowed localhost callback
in Google's configuration. Localhost has its own login session.

For deliberate read-oriented access to the remote `freshmarkets-core-staging` D1 and
`freshmarkets-product-media-staging` R2, run `pnpm dev:shared-staging`. That explicit
mode prints its policy before startup, requires Cloudflare operator login and a
private 32+ character `BETTER_AUTH_SECRET`, and disables local Email, Queue, cron,
PayMongo and delivery-provider effects. It is not a mutation sandbox: writes change
shared staging records, and the deployed staging Core may consume notification
outbox rows written to that D1. Do not use ordinary customer or Staff mutations in
this mode. Builds and explicit `CLOUDFLARE_ENV` selections retain their own Wrangler
environment behavior.

The normal `pnpm dev` runtime uses `http://localhost:3000` as its public origin.

Open `http://localhost:3000/api/core-health` to verify
`Web -> CORE Service Binding -> Core`.

The Core D1 `database_id` is an explicit development placeholder. Replace it with environment-specific provisioned IDs before remote deployment; do not commit secrets to Wrangler configuration.
