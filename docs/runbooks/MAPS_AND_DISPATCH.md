# Maps and Dispatch Production Runbook

## Purpose and authority

This runbook covers the FreshMarkets customer address map, Core Mapbox geocoding and Directions adapters, the Admin delivery map and manual route preview, and Rider navigation handoff. Core remains authoritative for saved coordinates, serviceability polygons, fulfillment assignment, delivery batches, Rider assignment, legal transitions, idempotency, and audit. Web is presentation only and reaches Core through the typed Cloudflare Service Binding.

This runbook does not authorize a public Core REST API, route optimization, live Rider tracking, embedded turn-by-turn navigation, or new KV, Queue, Durable Object, Workflow, or analytics ownership.

## Token separation and provisioning

### Browser public token

`MAPBOX_PUBLIC_ACCESS_TOKEN` is the only Mapbox token allowed in Web configuration, rendered props, and browser bundles.

1. Create a dedicated non-default public token for each environment. Grant only the public read scopes needed by Mapbox GL JS. Do not grant secret or write scopes.
2. Add URL restrictions for the exact Web origins. Production must name the exact HTTPS production hostname. Preview must name each approved exact HTTPS preview hostname. Local development uses a separate token whose allowlist explicitly includes `http://localhost:3000` (and `http://127.0.0.1:3000` only when that origin is actually used).
3. Do not allow a bare parent domain, wildcard, IP address, or unreviewed preview domain. Mapbox treats subdomains of an allowed hostname as allowed and does not support wildcard characters, so broad entries expand access unexpectedly.
4. Set the value in the Web deployment environment. Do not commit a real token to `apps/web/wrangler.jsonc`.
5. In browser developer tools, confirm map requests carry the public token and an approved `Referer`. A restricted token returns `403` when the origin/referrer does not match.

Mapbox recommends separate least-privilege public tokens with URL restrictions and notes that public tokens are visible to browser users: [Mapbox secure-use guidance](https://docs.mapbox.com/help/dive-deeper/how-to-use-mapbox-securely/) and [token URL restrictions](https://docs.mapbox.com/accounts/guides/tokens/#url-restrictions).

### Core server token

`MAPBOX_ACCESS_TOKEN` is a Core-only Cloudflare secret used for Geocoding v6 and Directions. It must never appear in Web configuration, browser output, source, a command argument, a ticket, or logs.

The current `apps/core/wrangler.jsonc` defines the root Worker `freshmarkets-core` and has no named `env` blocks. From `apps/core`, authenticate Wrangler to the intended Cloudflare account, verify that the root Worker is the intended target, and run:

```text
pnpm exec wrangler secret put MAPBOX_ACCESS_TOKEN --config wrangler.jsonc
```

Enter the value only at Wrangler's hidden prompt; never put the value in an argument, source file, Wrangler config, or shell history. `wrangler secret put` creates a new Worker version and immediately deploys it. A rotation therefore changes the secret for live traffic as soon as the command completes; schedule and monitor it as a production deployment, and keep the old provider credential available until the new version is healthy.

If a named Wrangler environment is added later, select it explicitly with both config and environment after verifying that the block exists:

```text
pnpm exec wrangler secret put MAPBOX_ACCESS_TOKEN --config wrangler.jsonc --env <configured-environment>
```

For a versioned or gradual rollout, create a version without deploying it immediately:

```text
pnpm exec wrangler versions secret put MAPBOX_ACCESS_TOKEN --config wrangler.jsonc --env <configured-environment> --message "Rotate Mapbox server token"
pnpm exec wrangler versions deploy --config wrangler.jsonc --env <configured-environment>
```

Omit `--env` only after explicitly choosing the current root Worker. The second command interactively selects the created version and traffic allocation; do not use `--yes` for a reviewed gradual rollout. Cloudflare documents that `secret put` immediately deploys, while `versions secret put` only creates a version for later `versions deploy`: [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

Repeat secret setup separately for every intended deployment because environment bindings are not inherited. Regenerate/check binding types with the repository's existing `pnpm --filter @freshmarkets/core types` command; do not hand-write an `Env` interface. Cloudflare's current guidance requires secrets outside source and generated binding types: [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

Before enabling address persistence in an environment, verify the Mapbox account has permanent geocoding entitlement. Mapbox requires a valid credit card on file or an active enterprise contract for permanent results. Temporary search results cannot be cached or stored; only the final Core reverse lookup with `permanent=true` may supply stored Mapbox-derived metadata. See [Mapbox Geocoding result storage](https://docs.mapbox.com/api/search/geocoding/#storing-geocoding-results).

## Content Security Policy

`apps/web/next.config.ts` delivers a complete environment-safe `Content-Security-Policy` for every
Web path. Its Mapbox-required directive subset is kept exact:

```text
worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' https://api.mapbox.com https://events.mapbox.com
```

The map component dynamically imports the `mapbox-gl` ESM package. Mapbox documents that its ESM bundle requires `worker-src blob:` and has no strict-CSP alternative. A policy that forbids blob workers is therefore incompatible with the current FreshMarkets implementation. Do not remove `blob:` or switch bundles through an operational configuration change. Using Mapbox's UMD strict-CSP bundle and its separately served same-origin worker would require a separately designed, implemented, and reviewed application change.

Use a referrer policy that still sends an origin, such as `strict-origin`; `no-referrer` and `same-origin` break URL-restricted cross-origin Mapbox requests. Recheck required endpoints whenever `mapbox-gl` changes. Source: [Mapbox GL JS security and CSP guidance](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/).

## Current polygon implementation and production blocker

Service-area and delivery-zone polygons are versioned Core-owned configuration. Address text, Mapbox results, and Web geometry never replace Core polygon evaluation.

What the repository currently implements:

- `apps/core/migrations/0003_phase2_geography.sql` creates `service_area` and `delivery_zone`, requires positive `polygon_version`, enforces version uniqueness within their current keys, and seeds the current version-1 Cebu rectangles. It is historical migration data, not a reusable polygon release command.
- `apps/core/src/geography/geometry.ts` parses a GeoJSON `Polygon` or `Feature`, retains finite numeric positions, requires at least one ring and at least four retained positions per ring, and evaluates boundaries and holes. It does not validate closed rings, longitude/latitude ranges, self-intersection, Cebu bounds, service-area containment, zone overlap, or business approval.
- `apps/core/src/geography/serviceability.ts` reads active/effective service areas and active zones ordered by polygon version, evaluates a coordinate, and returns the resolved versions. It has no polygon write, activation, deployment, or rollback command.
- `geometry.test.ts` and `serviceability.test.ts` cover parser and runtime evaluation fixtures. `pnpm migration:check` proves migrations apply and checks its enumerated schema/data invariants; it is not a polygon geometry or release validator.

Current reproducible checks are limited to these real commands:

```text
# From apps/core
pnpm exec vitest run --config vitest.config.ts src/geography/geometry.test.ts src/geography/serviceability.test.ts

# From the repository root
pnpm migration:check
```

**Production polygon deployment, activation, validation, and rollback tooling is not implemented.** This is a blocking prerequisite for any production polygon change. Do not change polygon rows manually and do not present the tests above as a release mechanism. Before a new polygon version can ship, an owner-approved implementation phase must define and test the missing validation, authorized version lifecycle, deployment, and recovery mechanism. Task 5 intentionally does not invent that platform.

## Provider outage and degraded behavior

Classify incidents using stable telemetry error codes and provider status, without inspecting or logging private requests.

- Browser map/style outage: preserve the customer textual confirmation flow and Admin synchronized table workflow. Do not expose provider errors or tokens. Map-only selection is unavailable; keyboard/table operations remain available.
- Temporary address-search outage: show a retryable safe error. Do not cache old candidates across sessions. A first-party user pin or explicitly accepted device coordinate may be saved only through the existing structured confirmation and Core serviceability rules.
- Permanent-geocoding outage or entitlement failure: fail saving new temporary-provider-derived components closed. Unchanged already-permanent components may follow the existing no-provider-call path; first-party structured input may retain null provider metadata only where the canonical command permits it. Never persist a temporary response as a workaround.
- Route-distance outage, timeout, `NoRoute`, or malformed response: checkout fails closed with its stable application error. Do not use straight-line distance, zero distance, a fabricated fee, or stale provider output.
- Route-preview outage: show the existing warning and allow an authorized dispatcher to continue with the submitted manual order. Preview is informational and never authorizes assignment.
- Google Maps navigation outage: Rider still sees the immutable destination and records FreshMarkets lifecycle actions explicitly. Do not synthesize an En Route, Arrived, Delivered, or Failed event from navigation behavior.

Escalate persistent provider failures to the incident owner with time window, environment, operation, result count, and stable error-code distribution only. Provider URLs, payloads, queries, addresses, coordinates, contacts, delivery instructions, tokens, cookies, and sessions are prohibited in the incident record.

## Atomic dispatch and idempotency recovery

`CreateAndAssignDeliveryBatch` is one atomic Core command. It validates `delivery.manage`, location scope, exact mode/cycle context, active canonical Rider, one-to-24 ordered jobs, coordinates, legal states, expected versions, and assignment conflicts before committing the batch, stops, events, transitions, and Rider assignment.

When the caller loses the response or sees an ambiguous network failure:

1. Preserve the exact request and the original idempotency key. Never retry the same intent with a new key.
2. Refresh the scoped delivery map/batch view. If the committed batch is visible, treat it as success and do not create another.
3. If the outcome remains unknown, replay the exact command with the same idempotency key and expected versions. Core returns the original result or a stable conflict; it must not create a second batch.
4. On stale-version, scope, Rider, or assignment conflict, refresh authoritative state and require a new reviewed user intent before using a new idempotency key.
5. If any partial batch/stop/event mutation is observed, stop dispatch changes, preserve IDs and stable error codes, and escalate as a data-integrity incident. Do not repair rows manually.

Route preview must preserve submitted order and must not optimize. FreshMarkets has no route optimization and no live tracking; do not add optimization parameters, background location collection, fleet polling, or customer-visible Rider location during recovery.

## Privacy-safe observability

Core emits one bounded `provider_operation` event around each Mapbox geocoder search, permanent reverse geocode, route-distance request, and route-preview request. Allowed diagnostic fields are:

- fixed `operation`;
- integer `durationMilliseconds` (capped);
- `result` of `SUCCESS` or `FAILURE`;
- stable `errorCode` on failure;
- the observability helper's timestamp, level, and fixed event name.

Never add query/address text, structured components, recipient/contact data, delivery instructions, coordinates, candidate contents, provider URL or response, access tokens, cookies, sessions, or arbitrary exception messages. Telemetry is diagnostic, not an Analytics-owned business metric or durable audit record. Sink/console failure is ignored and must not change provider or domain outcomes.

During an incident, aggregate only by fixed operation, result, stable error code, time bucket, and environment. Do not enable raw request logging or copy provider requests from developer tools into shared systems.

## Rollback sequence

1. Declare the affected surface: browser maps, geocoding, route distance, route preview, dispatch command, or polygon version.
2. Disable the affected release through the normal deployment rollback; do not disable Core authorization, idempotency, serviceability, or payment/checkout guards.
3. Rotate a suspected public token and update its exact allowed origins. Rotate a suspected Core token using the immediate or versioned Wrangler path above; never copy the Core value into Web.
4. If the incident involves polygon data, freeze polygon changes and escalate. There is no implemented production polygon rollback command; recovery requires an owner-approved, separately reviewed migration/restore procedure before execution. Never repair polygon, Customer, or Order rows manually.
5. Replay only safe idempotent commands with their original keys. Do not replay lifecycle actions speculatively.
6. Run the smoke tests below and inspect only privacy-safe telemetry before closing the incident.

## Manual Customer smoke test

1. Open serviceability/address entry on desktop and mobile at an approved origin; confirm the browser receives only `MAPBOX_PUBLIC_ACCESS_TOKEN` behavior and no Core token.
2. Search a Cebu address, choose a candidate, move the pin to the entrance, enter structured fields/contact/instructions, and confirm Core returns service area, zone, polygon resolution version, and serviceable state.
3. Save, reload, and edit the address as its owner. Confirm a second customer cannot list, read, or update it.
4. Test a known outside coordinate and confirm it may display unavailable but checkout rejects it.
5. Block Mapbox in developer tools and confirm safe textual/fallback and retry states without provider details. Confirm route-distance failure never fabricates a checkout fee.

## Manual Admin smoke test

1. Sign in with `delivery.read` scoped to the target location. Confirm only that location/mode/cycle appears and protected detail is separately loaded.
2. Verify a user without `delivery.read` and a reader outside the location receive the stable denial/not-found envelope without pins or protected identifiers.
3. Select deliveries using both rectangle and keyboard/table flows, order them manually, and preview the route. Confirm the returned route preserves that order and offers no optimization control.
4. Block Directions and confirm preview warns while an authorized manual assignment remains possible.
5. With `delivery.manage`, create and assign one batch. Repeat the exact request with the same idempotency key and confirm no duplicate. Force a stale expected version and confirm no partial mutation.

## Manual Rider smoke test

1. Sign in as an active canonical Rider. Confirm only assigned batches appear and another Rider's batch, stop, contact, and instructions are absent.
2. Open the first unfinished delivery and confirm Navigate uses the immutable destination in a Google Maps HTTPS URL without a supplied origin.
3. Confirm navigation opens externally and creates no FreshMarkets state transition.
4. Record En Route, Arrived, and a terminal Delivered or Failed action through FreshMarkets. Retry once with the same idempotency key after simulating connection loss and confirm no duplicate event.
5. Sign in as a non-Rider and inactive Rider; confirm both are denied without assignment data.
