# Deployment Runbook

## Prerequisites

- Confirm the target Cloudflare account, Worker names, D1 binding, Email
  binding, and Service Binding are configured outside source control.
- Provision production values for `TRUSTED_ORIGINS`, `BETTER_AUTH_URL`,
  `PUBLIC_APP_ORIGIN`, `AUTH_EMAIL_FROM`, and the required route provider
  configuration through the deployment environment.
- Run checks from the repository root with Node 24 and pnpm 11.

## Local verification

```text
pnpm naming:check
pnpm migration:check
pnpm typecheck
pnpm lint
pnpm --filter @freshmarkets/web exec vinext check
pnpm --filter @freshmarkets/core build
pnpm --filter @freshmarkets/web build
node scripts/verify-worker-readiness.mjs
```

`node scripts/verify-worker-readiness.mjs --probe-local` is local-only and
requires the Web/Core stack started with `pnpm dev:stack`.

## Deployment and rollback

1. Review the generated Worker configuration under `apps/web/dist/server`
   after the Web build; do not edit generated output.
2. Deploy Core with `pnpm --filter @freshmarkets/core exec wrangler deploy --config wrangler.jsonc`.
3. Deploy Web using the generated configuration with
   `pnpm --filter @freshmarkets/web exec wrangler deploy --config dist/server/wrangler.json`.
4. Verify `/api/core-health` through the same origin and inspect structured
   logs using the returned request reference.
5. If verification fails, stop traffic promotion and redeploy the last known
   good Worker version from the Cloudflare dashboard or deployment history.
   Do not roll back a schema independently of the code that reads it; use the
   migration recovery runbook first.
