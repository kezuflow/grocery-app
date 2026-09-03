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
pnpm architecture:check
pnpm readiness:check
pnpm typecheck
pnpm lint
pnpm --filter @freshmarkets/core exec wrangler types ./src/worker-configuration.d.ts --check
pnpm --filter @freshmarkets/web exec wrangler types ./worker-configuration.d.ts --check
pnpm --filter @freshmarkets/web exec vinext check
pnpm --filter @freshmarkets/core build
pnpm --filter @freshmarkets/web build
node scripts/verify-worker-readiness.mjs
```

`node scripts/verify-worker-readiness.mjs --probe-local` is local-only and
requires the Web/Core stack started with `pnpm dev:stack`.

The local probe treats `/health` as liveness and `/ready` as dependency
readiness. A release cannot receive traffic unless `/ready` reports ready for
runtime configuration, D1, and the configured Payments adapter. The response
must expose only the provider code, its canonical capabilities, and renewal
initiation state—never a secret, origin credential, or provider payload.

## Edge security controls

Configure these controls in the Cloudflare zone/account deployment layer; they
are not application defaults and must be reviewed for preview, staging, and
production independently:

- Enable current Cloudflare managed WAF rules for every public Web route. Keep
  Core private behind the Service Binding except for the narrowly required,
  signature-verified provider webhook surface.
- Rate-limit sign-in, registration, password reset, and account-recovery routes
  using both client-network and normalized account identifiers. Use a stricter
  rule for reset initiation than for ordinary authenticated reads.
- Rate-limit address search by session and client network, with a burst ceiling
  below the upstream provider quota. Do not cache or log precise query strings.
- Rate-limit checkout quote, recurring-authorization initiation, and payment
  initiation by authenticated principal plus client network. Edge controls do
  not replace Core idempotency, expected aggregate versions, or entitlement
  checks.
- Exempt payment webhooks from interactive challenges, but restrict methods and
  body size at the edge and apply a provider-compatible request-rate ceiling.
  Edge filtering never replaces signature verification, provider-event inbox
  uniqueness, replay handling, or reconciliation.
- Alert on sustained 401/403/413/429/5xx changes, failed webhook signatures,
  readiness failures, payment reconciliation backlog, and provider error-code
  changes. Never include cookies, authorization headers, action URLs, tokens,
  webhook bodies, provider payloads, password/reset links, or precise address
  snapshots in logs.

Both Workers retain 100% of logs and sample 5% of traces in the checked-in
configuration. Preview, staging, and production deployment overrides must keep
observability enabled and record an explicit approved sampling decision. Query
strings must be redacted in the Cloudflare observability/edge configuration
because Wrangler 4.125.0's checked schema does not expose that option.

## Deployment and rollback

The current staging Web Worker uses `https://freshmarkets.ph` as its canonical
public origin and keeps its `workers.dev` hostname enabled as a diagnostic
fallback. The checked-in staging Custom Domain route is the DNS and certificate
source of truth. Core remains behind Web's Service Binding; only Core's
signature-verified PayMongo webhook stays public on its staging `workers.dev`
hostname.

Before changing the staging public origin, update the same release's
`PUBLIC_APP_ORIGIN`, `BETTER_AUTH_URL`, and `TRUSTED_ORIGINS` values together.
Register `https://freshmarkets.ph/api/auth/callback/google` as an authorized
Google OAuth redirect URI and allow `https://freshmarkets.ph/*` in any Mapbox
public-token URL restrictions before accepting traffic.

1. Build Web with `CLOUDFLARE_ENV=staging`, then review the generated Worker
   configuration under `apps/web/dist/server`; do not edit generated output.
   The vinext-generated file is already resolved to
   `freshmarkets-web-staging` and intentionally has no nested environment
   section.
2. Deploy Core with `pnpm --filter @freshmarkets/core exec wrangler deploy --config wrangler.jsonc --env staging`.
3. Deploy Web using the generated configuration with
   `pnpm --filter @freshmarkets/web exec wrangler deploy --config dist/server/wrangler.json`.
4. Verify Core `/health`, Core `/ready`, and Web `/api/core-health`; promote
   traffic only when readiness is `ready`, then inspect structured logs using
   the returned request reference.
5. If verification fails, stop traffic promotion and redeploy the last known
   good Worker version from the Cloudflare dashboard or deployment history.
   Do not roll back a schema independently of the code that reads it; use the
   migration recovery runbook first.
