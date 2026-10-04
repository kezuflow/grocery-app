# Deployment Runbook

## Prerequisites

- Confirm the target Cloudflare account, Worker names, D1 binding, Email
  binding, and Service Binding are configured outside source control.
- Provision production values for `TRUSTED_ORIGINS`, `BETTER_AUTH_URL`,
  `PUBLIC_APP_ORIGIN`, `AUTH_EMAIL_FROM`, and the required route provider
  configuration through the deployment environment.
- Run checks from the repository root with Node 24 and pnpm 11.

## Local verification

Use [ENGINEERING.md](../architecture/ENGINEERING.md#choose-checks-by-risk) for the full risk-based matrix. The commands below cover deployment-specific checks; also run `pnpm check` and the relevant browser/provider acceptance before an implementation release. Test discovery, build/dry-run output, and readiness configuration do not prove an end-to-end customer journey. A Markdown-only task does not require deployment or provider activation.

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
requires the Web/Core stack started with `pnpm dev`.

The local probe treats `/health` as liveness and `/ready` as dependency
readiness. A release cannot receive traffic unless `/ready` reports ready for
runtime configuration, D1, and the configured Payments adapter. The response
must expose only the provider code, its canonical capabilities, and required one-time payment readiness—never a secret, origin credential, or provider payload.

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
- Rate-limit checkout quote and payment
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

The production Web Worker uses `https://freshmarkets.ph` as its canonical
public origin and keeps its `workers.dev` hostname enabled as a diagnostic
fallback. The checked-in production Custom Domain route is the DNS and
certificate source of truth. Core remains behind Web's Service Binding; only
Core's signature-verified PayMongo webhook stays public on its production
`workers.dev` hostname. Staging no longer claims the production hostname.

The checked-in `production` environments use isolated
`freshmarkets-*-production` Workers, D1, R2 and Queue resources. The live
PayMongo public key is a required Web Worker secret binding so the value is
supplied outside Git, while Core requires the matching live secret key and live
webhook endpoint secret. Production Lalamove uses separately uploaded live
credentials with the `PH` market, `en_PH` language and `MOTORCYCLE` service type;
production mode targets Lalamove's production API host. A successful deployment
proves configuration only: complete a controlled quotation/booking/cancellation
acceptance journey before treating provider operations as accepted. Provision,
migrate and verify the isolated resources before deploying Web and moving the
Custom Domain.

Before changing the staging public origin, update the same release's
`PUBLIC_APP_ORIGIN`, `BETTER_AUTH_URL`, and `TRUSTED_ORIGINS` values together.
Register `https://freshmarkets.ph/api/auth/callback/google` as an authorized
Google OAuth redirect URI and allow the exact production Web origins in the
`GOOGLE_MAPS_BROWSER_KEY` HTTP-referrer restrictions before accepting traffic. Keep the separate
`GOOGLE_MAPS_SERVER_KEY` restricted to Core's Places API (New), Geocoding API and Routes API calls.
Keep Web's browser/referrer-restricted Maps JavaScript key separate. After configuration changes,
verify address search, selected-place details and pin reverse geocoding in the target environment;
source configuration and local tests do not establish deployed key restrictions. Follow Google's [API security best practices](https://developers.google.com/maps/api-security-best-practices) when applying and verifying those restrictions.

1. Build Web with `CLOUDFLARE_ENV=production`, then review the generated Worker
   configuration under `apps/web/dist/server`; do not edit generated output.
   The vinext-generated file is already resolved to
   `freshmarkets-web-production` and intentionally has no nested environment
   section.
2. Deploy Core with `pnpm --filter @freshmarkets/core exec wrangler deploy --config wrangler.jsonc --env production`.
3. Deploy Web using the generated configuration with
   `pnpm --filter @freshmarkets/web exec wrangler deploy --config dist/server/wrangler.json`.
4. Verify Core `/health`, Core `/ready`, and Web `/api/core-health`; promote
   traffic only when readiness is `ready`, then inspect structured logs using
   the returned request reference.
5. If verification fails, stop traffic promotion and redeploy the last known
   good Worker version from the Cloudflare dashboard or deployment history.
   Do not roll back a schema independently of the code that reads it; use the
   migration recovery runbook first.

For staging-only verification, substitute `staging` at build/deploy time; the
resulting Web Worker is available through its `workers.dev` hostname and does
not own `freshmarkets.ph`.

## Operational handbook index

- [Authentication email](#authentication-email)
- [Initial administrator](#initial-administrator)
- [Commerce mode changes](#commerce-mode-changes)
- [Migration recovery](#migration-recovery)
- [Notification queues](#notification-queues)
- [Failed scheduled jobs](#failed-scheduled-jobs)
- [Provider webhook replay](#provider-webhook-replay)

## Authentication email

### Production prerequisites

- Onboard and verify the sender domain/address with Cloudflare Email Service.
- Configure the Core `EMAIL` binding and deployment-only `AUTH_EMAIL_FROM`.
- Configure `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` for the actual Web origin;
  production must not inherit loopback development origins.
- Whenever the canonical Web hostname changes, register its exact
  `/api/auth/callback/google` URL with Google before traffic moves. The current
  production callback is `https://freshmarkets.ph/api/auth/callback/google`.
- Ensure the Web proxy preserves cookies, callback URLs, origin, and CSRF
  protections when forwarding `/api/auth` to Core.

The owner authorized native Cloudflare email setup on 2026-09-10. Wrangler
enabled Email Sending for `freshmarkets.ph`; the selected transactional sender
is `no-reply@freshmarkets.ph`. It is configured in the ignored local Core
`.dev.vars`, and must also be supplied to Core's deployment environment when
that release is authorized. Sending-domain setup does not deploy a Worker,
verify inbox delivery, or create the inbound `support@freshmarkets.ph` mailbox.
Current acceptance, including owner-confirmed test receipt, is tracked only
in [the active checkpoint](checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).

### Verify without bypassing auth

1. Deploy Core and Web with the environment configuration above.
2. Request email verification or password reset through the normal browser
   flow and confirm delivery from the approved sender.
3. Confirm the Core auth response and Web response preserve `Set-Cookie` and
   callback behavior. Inspect structured request references only.
4. Run the authenticated Playwright suite only after the transport is
   provisioned:

```text
$env:E2E_AUTH_EMAIL_CONFIGURED="1"
pnpm --filter @freshmarkets/web exec playwright test
```

When the local transport is unavailable, leave those tests environment-gated.
Never add a test bypass, log a reset link, or put a sender credential in the
repository. Missing sender configuration must remain fail-closed as
`AUTH_EMAIL_DELIVERY_UNCONFIGURED`.

## Initial administrator

This is first-installation enrollment, not staff recovery. Existing Global staff scope, including suspended staff, or completed setup makes new enrollment unavailable. Retained installations with staff use their existing access and invitation commands.

1. Set Core's `INITIAL_GLOBAL_ADMIN_EMAIL` to the explicitly chosen initial administrator email through deployment configuration. The committed empty value leaves setup disabled. Do not infer the email from Git, seed a password, or configure it in Web.
2. Use the normal Web registration or sign-in journey for that email and complete Better Auth email verification. OAuth may be used where separately configured and verified.
3. Open `/setup`. Review the Global access description and select **Create Global administrator access**. Core rechecks the current verified identity and clean setup eligibility in the transaction.
4. If confirmation is lost, retry the same displayed request. Reloading after successful setup shows completion. Open Admin, review explicit roles and invite operators with their required scopes.
5. Remove the setup email from deployment configuration after completion. The immutable singleton receipt prevents re-enrollment even if the email is later configured again. Removing configuration does not prevent authenticated replay of the original successful receipt.

Migration `0078_initial_administrator.sql` adds an empty evidence table and integrity triggers without altering existing users, roles, grants, or commercial data. Apply it using the normal backed-up, verified migration process. No existing database has been upgraded by writing this runbook.

Setup saves an explicit snapshot of current non-membership capabilities. It does not automatically grant later capabilities or restore suspended accounts. Better Auth continues to own credentials and sessions. The chosen deployment email and real email/OAuth delivery must be verified for the target environment before operational acceptance.

## Commerce mode changes

Use these steps to pause selling, switch the one global fulfillment mode, and reopen commerce.
Core commands remain authoritative; never edit D1 rows directly.

### Pause

1. Record the operational reason and current configuration version.
2. Run `PauseSelling` with `commerce.manage`, the expected version, and a stable idempotency key.
3. Confirm the state is `PAUSED`. New fulfillment options, Quotes, and payment initiation must stop.
4. Confirm provider events, started-payment commitment, committed Orders, refunds, notifications,
   and delivery operations continue.

### Switch mode

1. Keep selling paused.
2. Verify mode readiness: exact store/SKU prices and Instant stock/provider capability, or an open
   Scheduled cycle/window before cutoff with a verified Lalamove quotation capability.
3. Run `ActivateGlobalFulfillmentMode` with the current expected version.
4. Confirm uncommitted commerce was invalidated and committed Orders retained their snapshots.
5. Never configure sourcing behavior or Scheduled capacity; behavior derives from the mode.

### Reopen

1. Resolve every blocker returned by the authoritative readiness query.
2. Run `OpenSelling` with the current expected version and a new stable idempotency key.
3. Confirm the state is `OPEN`, then smoke-test the active mode from fulfillment options through
   quote creation. Do not infer readiness from the Admin screen alone.

### Recovery

- On `STALE_VERSION`, reload and require a newly reviewed operator decision.
- On an ambiguous command response, retry the exact command with the same idempotency key.
- On provider configuration or quotation failure, remain paused; do not substitute a fixed rate.
- Do not switch mode to work around an already-started payment or rewrite a committed Order.


## Migration recovery

### Choose the lifecycle first

FreshMarkets is pre-launch. A better schema may replace or squash the development baseline under [ENGINEERING.md](../architecture/ENGINEERING.md#pre-launch-schema-and-interface-policy). This runbook does not require preserving disposable fixtures or an obsolete migration chain.

For a disposable local environment, identify its exact database/persistence directory, update the baseline and all consumers/seeds/verifiers, then recreate only that environment through its reviewed setup workflow. Verify clean initialization and relevant Worker/D1 tests. Editing an already-applied migration does not upgrade its database.

For shared staging data that must be retained, or a supported production baseline, use a tested migration/upgrade and recovery procedure. Identify the actual database and code version; do not infer disposability from an environment label. No documentation or test command authorizes a destructive remote reset.

Rehearse retained-data upgrades on an isolated copy before changing an active
deployment. Keep exports outside Git with the same protection as the database.
D1 exports can interleave child inserts before their parent tables/data. If
restore fails, preserve the original export; order table/index definitions
before data, parent data before dependent data, and triggers after the imported
data. Verify that every original statement is preserved and that immediate
foreign-key enforcement succeeds before importing. Do not disable constraints
or remove records to make a restore pass. See Cloudflare's
[import ordering guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Record full-database integrity failures separately. When `PRAGMA quick_check`
hits a provider resource limit, per-table `PRAGMA quick_check('table_name')`
and `PRAGMA foreign_key_check` provide bounded checks; they do not turn the
failed whole-database command into a pass. The actual CA-7.10 rehearsal target,
results and limits live in [the active checkpoint](checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).

### Retained-environment prerequisites

- Identify the target Core D1 database and an approved maintenance window.
- Confirm a recent platform-managed D1 backup exists before applying a
  production migration. Backup operations are performed in Cloudflare, never
  by copying credentials into a command line.

### Preflight and apply

```text
pnpm migration:check
pnpm --filter @freshmarkets/core build
```

Apply migrations through the reviewed Core deployment process. The local
verifier exercises SQLite schemas and selected upgrades; it is neither a production backup nor proof of Worker/D1 runtime integration. See [ENGINEERING.md](../architecture/ENGINEERING.md#choose-checks-by-risk).

### Recovery

1. Stop further deployment/traffic promotion and record the Worker version, migration filename, UTC
   time, and request references from structured logs.
2. Assess writes and provider operations since the recovery point before restoring. Prefer a forward repair when it preserves valid new work. If restoration is required, use the target database's verified recovery procedure and account for post-backup writes; restoration is not automatically harmless.
3. Redeploy the matching prior Worker version.
4. Run `pnpm migration:check` locally and perform the health and representative
   read-only smoke checks before retrying.
5. Reconcile any provider or scheduled-job effects using their runbooks; do not
   hand-edit business rows.

## Notification queues

Cloudflare Queues transports notification work only. D1 `notification_outbox` is the transactional
source of intent; Queue messages contain only `{ "outboxId": "..." }`. The consumer must not mutate
Orders, Payments, Memberships, Fulfillment, or Delivery state.

### Provisioning

Create the configured source and dead-letter queues before deploying each environment:

```powershell
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-dev
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-dlq-dev
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-staging
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-dlq-staging
```

`wrangler.jsonc` binds `NOTIFICATION_QUEUE`, registers this Worker as the consumer, caps batches at
10, retries five times, and routes exhausted messages to the environment-specific DLQ. Queue names
must never be shared across development, staging, and production.

### Normal operation

The every-minute scheduled job projects domain facts into D1, conditionally leases due unpublished
rows, and publishes stable outbox identities. A successful publish records transport evidence and
clears the publication lease. The consumer conditionally claims the notification, renders the
approved template, writes attempt evidence, sends through Cloudflare Email Service, and then marks
the outbox row sent.

Each message is handled in its own `try/catch` and explicitly acknowledged or retried. Duplicate
delivery after a completed send is acknowledged without calling the email provider again.

### Recovery and incidents

- `FAILED` publication rows and expired `PUBLISHING` leases are recovered by the next scheduled run.
- A send-provider rejection uses bounded backoff. After the fifth attempt, D1 and the Queue/DLQ retain
  the terminal evidence for operations.
- If an attempt is still `PROCESSING` after its lease, the send outcome is unknown. Core records
  `SEND_OUTCOME_UNKNOWN` and acknowledges the message rather than risking a duplicate customer email.
- A Queue publish failure never rolls back or changes the source domain event. Repair the binding or
  Queue service, then let scheduled recovery republish the same outbox identity.
- Inspect DLQ messages and their matching D1 outbox/attempt rows together. Do not replay raw payloads
  or edit domain rows manually.

Before activation, run the Core notification Queue integration tests and a Wrangler dry-run. In
staging, verify one success, one transient retry, one duplicate delivery, and one exhausted message
visible in the DLQ before enabling customer traffic.

## Failed scheduled jobs

### Identify

1. Inspect the authorized scheduled-job diagnostic read model when available, or
   Cloudflare Cron Trigger Past Events, for job name, status, error code, affected
   count and timestamps. There is no ordinary Admin Scheduled jobs workspace.
2. Check Cloudflare Cron Trigger Past Events for failed invocations and the
   structured Worker logs for the job name and error code. A failed observation
   row write also fails the invocation, so diagnostic run history may be incomplete.
3. Capture the request reference and structured error; do not treat an empty
   queue as evidence that a failed run did not occur.
4. Check whether the job is one of the configured cron lanes in
   `apps/core/wrangler.jsonc` and whether a duplicate execution is safe.

### Recover

1. Correct the external prerequisite or provider condition identified by the
   error without editing business state directly.
2. Allow the next configured cron invocation to retry bounded work. Payment
   redrive and reconciliation remain idempotent and can escalate exhausted
   reactions for operator review.
3. If an approved operator rerun mechanism is available, use that mechanism
   with a new request reference and record the reason. There is no generic
   public job-trigger API.
4. Verify the subsequent Cron invocation and affected authorized diagnostic read model.
5. Escalate repeated failures with the job name, error code, UTC timestamps,
   deployment version, and request references; exclude credentials and raw
   provider payloads.

## Provider webhook replay

### Prerequisites

- Obtain the provider event identity from the provider dashboard and the
  affected payment/order identifiers from Core's purpose-built read models.
- Use the provider's signed replay facility or approved operator tooling; do
  not paste signed payloads or credentials into tickets or source files.

### Procedure

1. Check the payment and inbox/event history in Admin Payments and capture the
   request reference for the investigation.
2. Confirm the event is not already recorded as processed. Provider event
   identity is `(provider, providerEventId)`; duplicate delivery must be safe.
3. Request a replay through the provider's dashboard or approved support
   channel to the configured Core path `/webhooks/payments/<provider>`.
4. Confirm Core's structured response and inspect the payment reconciliation
   read model. A browser return or payment initiation is not payment success.
5. If the payment remains stuck, allow the scheduled reconciliation/redrive
   job to handle it and use `FAILED_JOB_RUNBOOK.md` for an exhausted run.
6. Record the outcome, event identity, UTC time, and request reference without
   storing provider payloads or secrets.

Production queue provisioning uses the separately configured `freshmarkets-notifications-production` and `freshmarkets-notifications-dlq-production` names. Inspect `apps/core/wrangler.jsonc` for the target environment before creating resources; the examples above provision development/staging only. Commands in this handbook require authorization for their environment and side effects. Documentation cleanup does not execute them.
