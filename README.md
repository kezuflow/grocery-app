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

## Guidance, operations and project skills

Business rules live in [PRODUCT](docs/product/PRODUCT.md); execution and subject routing start in [AGENTS](AGENTS.md). The [single checkpoint](docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md) records unfinished work and acceptance levels. Use the [deployment handbook](docs/operations/DEPLOYMENT_RUNBOOK.md), [PayMongo setup](docs/operations/PAYMONGO_SETUP_RUNBOOK.md) and [Maps/courier setup](docs/runbooks/MAPS_AND_DISPATCH.md) for the corresponding environment operation.

The required Admin skill is `.agents/skills/shadcn-admin/`. Its complete references, agent metadata and assets are retained. Hermes keeps an identical `.hermes/skills/shadcn-admin/` copy until independent host discovery is verified. `pnpm skills:check` checks these complete trees; generic animation/prototyping skills are retired from this project and remain retrievable from Git if a personal installation is needed. No personal skill directories or settings were changed.

## Documentation provenance

The Markdown consolidation starts at `75c0bd35936ccb3d5ef0fbcff565b0da877906bc` (4 October 2026). Removed historical plans, audits, prompts, skill copies and checkpoint diaries remain retrievable with:

```text
git show 75c0bd35936ccb3d5ef0fbcff565b0da877906bc:path/to/file.md
```

Use Git blob extraction for byte-exact recovery of the damaged historical `IMPLEMENTATION_STATUS.md`; do not decode and resave it. Commit-pinned historical links provide provenance, not current execution authority. The protected original discussion, SQL/fixtures, runtime assets, tests and raw performance JSON remain intact. Archive source hashes and requirement-accounting JSON are also preserved at this revision in Git.

## Workspace commands and configuration

From `apps/web`, `pnpm run dev`, `build`, `start` and `check:vinext` start the auxiliary-Worker development topology, build output, run built output locally and scan framework compatibility. `pnpm run deploy` is a deployment action requiring the target-environment release authorization and reviewed generated configuration from the handbook.

Core `BETTER_AUTH_URL` is the browser-facing Web origin (`http://localhost:3000` locally), even when `pnpm dev:core` listens separately at `http://127.0.0.1:8787`. Set auth/OAuth credentials per environment; Google routes remain unavailable until both credentials exist. Web proxies preserve repeated Set-Cookie, origin and CSRF behavior. The selected transactional sender and verification procedure are in the deployment handbook, not a second package README.

Catalog tooling in `apps/core/src/catalog/seed/` maintains the typed 226-product produce manifest and deterministic SQL generator. `pnpm catalog:generate` regenerates `apps/core/migrations/0025_complete_produce_catalog.sql`; `pnpm catalog:check` detects drift. Rebaseline work updates generator, consumers and verifier together; generated artifacts are not edited by hand.

Web's `GOOGLE_MAPS_BROWSER_KEY`/`GOOGLE_MAPS_MAP_ID` are browser-visible rendering configuration; restrict the key to Maps JavaScript API and exact authorized origins. Core's separate `GOOGLE_MAPS_SERVER_KEY` is restricted to Places API (New), Geocoding API and Routes API. Never place it in Web, logs or client errors. Maps/provider configuration and permanent address finalization follow the Maps/courier handbook.
