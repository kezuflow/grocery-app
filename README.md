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

By default, `pnpm dev` uses the staging Wrangler variables and **the same D1 and R2
resources as freshmarkets.ph**. Both Workers still run local source with hot reload;
database and image changes affect the deployed site's data. Auth URLs and cookies
remain on localhost. Cloudflare operator login is required for remote bindings.
Core's Email binding is remote too; scheduled jobs and notification queue processing
remain owned by the deployed Core, which reads the shared notification outbox.

Secrets remain in ignored `apps/core/.dev.vars` and `apps/web/.dev.vars`; deployed
secret values cannot be downloaded from Wrangler. Core requires a private
`BETTER_AUTH_SECRET` of at least 32 characters for this mode. Provider credentials
must match the connected environment. Google login additionally needs local
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and an allowed localhost callback in
Google's configuration. Localhost has its own login session.

For isolated local data in PowerShell, run
`$env:FRESHMARKETS_DEV_DATA='local'; pnpm dev`; remove the override afterward with
`Remove-Item Env:FRESHMARKETS_DEV_DATA`. This mode, `pnpm dev:core`, and
`pnpm dev:stack` use `apps/core/.wrangler/state`. Builds do not enable shared dev
bindings. Explicit `CLOUDFLARE_ENV` selection retains Wrangler environment behavior.

For the production-built Web Worker plus Core in one Cloudflare local runtime, first build Web, then run the multi-config Wrangler smoke stack:

```sh
pnpm --filter @freshmarkets/web build
pnpm dev:stack
```

The combined stack also uses `http://localhost:3000` as its public origin.

Open `http://localhost:3000/api/core-health` to verify
`Web -> CORE Service Binding -> Core`.

The Core D1 `database_id` is an explicit development placeholder. Replace it with environment-specific provisioned IDs before remote deployment; do not commit secrets to Wrangler configuration.
