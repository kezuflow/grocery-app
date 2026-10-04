# Address maps and external dispatch

This runbook covers customer address confirmation and external-provider delivery operations.
FreshMarkets has no internal Rider, batch or route-planning workflow. Approved Order messaging and
external Lalamove tracking remain available; they do not introduce third-party rider chat or an internal fleet.

## Address incidents

Core requires the confirmed pin to lie inside the union of active Global service-area polygons.
Global owns that area; locations do not own separate polygons. Configure the exact map pin and
courier pickup profile on every customer-fulfillment location. Inside the Global area, Core assigns
the nearest eligible location using its exact pin and stable ID tie-break, without stock rerouting.
Google Maps Platform must have Maps JavaScript API, Places API (New), Geocoding API, and Routes API enabled for the
deployment project. Use two different API keys:

- Bind the browser/referrer-restricted key to Web as `GOOGLE_MAPS_BROWSER_KEY` and bind the
  corresponding public vector-map ID as `GOOGLE_MAPS_MAP_ID`. Restrict the key to Maps JavaScript
  API and the exact local, preview, staging, and production Web origins. Both values reach the
  browser by design; neither grants Core access.
- Bind a separate server-only key to Core with
  `wrangler versions secret put GOOGLE_MAPS_SERVER_KEY`. Restrict it to Places API (New), Geocoding API and Routes
  API. Never place it in Web configuration, client bundles, logs, or rendered errors.

Keep `worker-src 'self' blob:` and the exact Google Maps script/image/connect CSP origins in Web.
FreshMarkets selects Google's raster renderer because its current maps do not require vector-only
features and production CSP permits neither `unsafe-eval` nor `wasm-unsafe-eval`. Do not weaken that
policy to activate vector/WebGL rendering. Provider activation still requires an actual nonce-CSP
browser check with the configured project. After any key or map-ID rotation, verify map load,
address search, pin reverse geocoding, confirmed address persistence, route distance, and route
preview in the target environment before accepting traffic.

- Google Maps search and reverse geocoding are advisory; Core persists the exact customer-confirmed
  pin and assigns the nearest active, capable fulfillment-location pin. Checkout separately rechecks
  mode readiness.
- Google geocoding content may be stored only within the current Google Maps Platform terms and
  attribution requirements. Do not repurpose persisted geocoder data as a standalone address
  database or expose provider references to customers.
- If geocoding is unavailable, do not guess coordinates or accept free-form text as serviceability
  evidence. Preserve the customer's draft and retry.
- Multiple eligible fulfillment locations resolve to the closest dispatch origin by Haversine
  distance, with the stable location-ID tie-break. Stock never changes or splits that assignment.
- Lalamove quotation is the route-specific availability and fee authority. A missing, expired or
  rejected quotation blocks new payment without relabeling the address as outside a FreshMarkets
  delivery polygon.
- Customer delivery phone is required and normalized; provider email is optional.

## Address autocomplete

Admin pickup pins and customer address pickers use Web's private-body, no-store
`/api/commerce/address-autocomplete` and `/api/commerce/address-prediction` endpoints.
Core calls Google Places Autocomplete (New) with a Philippines restriction and a soft Cebu/current-pin
bias. Details are requested only for the selected suggestion, with the same editor session token and
only ID, place name, formatted address, coordinate and address components. The server key needs Places API (New);
the browser map key does not. Suggestions remain temporary; saving still finalizes the exact confirmed
pin through Core. Verify actual suggestions, selection, pin adjustment and provider failures in the
target environment. A successful local-key check does not prove deployed-key activation.

## External dispatch

1. Open the location-scoped Delivery queue.
2. Confirm the store pickup profile, committed destination, phone, promise/window and provider.
   Quotes/bookings use the fixed 20,000 g Motorcycle envelope; staff must pack within actual provider limits.
3. Instant first booking runs automatically at Start packing using the accepted provider/service.
   Scheduled uses week Purchase complete -> per-Order Finish packing -> staff Lalamove or Manual choice.
   Manual is ordinary for Scheduled and available for Instant recovery only after definite closure
   of a previous courier attempt and completed packing. Active/unknown outcomes block replacement.
4. Use a stable idempotency key and current job version. Retry an ambiguous create only with the
   exact same command and key.
5. Use provider refresh when a webhook is delayed. Never infer success from browser state.

## Provider incidents

- Uncertain create outcome: quarantine and reconcile by the persisted idempotency/reference
  evidence before any new create attempt.
- Delayed or duplicate webhook: retain the provider event identity; replay is safe and must not
  regress normalized status.
- Courier price increase after a Scheduled customer has paid: FreshMarkets absorbs the increase.
  A decrease is retained and does not trigger a new customer charge.
- Cancellation: call the provider cancel command with the current dispatch version, then refresh.
  Order cancellation and customer refunds remain separate coordinated domain operations.
- Provider outage or invalid store profile: pause new selling when checkout or dispatch readiness
  cannot be met. Existing reconciliation, refunds, and committed-order reads remain available.

Production Lalamove remains fail-closed until the credential, wallet, Cebu service, webhook,
pickup-profile, sandbox-evidence, and reconciliation gates in the Lalamove setup runbook pass.

## Courier setup and dispatch recovery

This runbook activates the existing Core-only Lalamove v3 adapter. It does not change checkout,
delivery, or payment authority.

### Official source baseline

The implementation was checked on 2026-09-06 against the official Lalamove v3 API reference and
changelog (including changes published through August 2026), plus the official webhook tutorial
version 1.4 dated May 2023. Outbound API calls use the documented `Authorization` HMAC over the
timestamp, method, exact path, and body. Inbound webhooks instead verify the `apiKey`, `timestamp`,
and `signature` fields carried in the JSON payload, signing only the payload's `data` object and the
exact registered callback path.

### 1. Obtain sandbox credentials

Create or use the FreshMarkets account in the Lalamove Partner Portal and select the Sandbox
environment. Copy the sandbox API key and secret into `apps/core/.dev.vars`, which is ignored by
Git:

```dotenv
LALAMOVE_API_KEY=pk_test_...
LALAMOVE_API_SECRET=sk_test_...
```

Never put either value in `wrangler.jsonc`, Web variables, browser code, logs, tickets, or committed
fixtures.

### 2. Confirm Cebu service configuration

Use the authenticated `GET /v3/cities` endpoint with `Market: PH`. Locate Cebu Islandwide and copy
the exact active service `key` suitable for the packed order. Do not infer a key from a marketing
vehicle label. Set these non-secret Core variables for the target environment:

```powershell
pnpm --filter @freshmarkets/core lalamove:cities
```

```dotenv
DELIVERY_PROVIDERS=lalamove
LALAMOVE_MARKET=PH
LALAMOVE_LANGUAGE=en_PH
LALAMOVE_SERVICE_TYPE=<verified service key>
```

The repository's local `MOTORCYCLE` value is only a development starting point and must be replaced
if the authenticated city response differs. The PH integration deliberately omits the optional
Lalamove `item` object even if sandbox capability discovery happens to expose it.

Core's default development configuration leaves market/language/service variables blank; staging
and production currently declare `PH`, `en_PH` and `MOTORCYCLE`. The configured service key still
requires target-environment capability verification. The two credentials are required secret bindings.
Wrangler filters
`.dev.vars` when `secrets.required` is present: undeclared names are discarded even when the file
contains them. If checkout throws `LALAMOVE_SERVICE_TYPE_REQUIRED`, verify these declarations as
well as the ignored local values, then restart the development stack after a binding change.
Keep delivery disabled until the intended environment is configured; do not supply a fallback
service key or use a mock outside the isolated test runtime.

### 3. Configure every store pickup profile

Select each permitted store location in Admin, open **Delivery**, expand **Store courier pickup
profile**, and save its factual sender name, E.164 phone, optional email, structured pickup address,
and pickup instructions. The coordinate shown by the form comes from the fulfillment-location
record and cannot be overridden by the courier profile. Do not copy Central Cebu's profile into
another store: Core fails that store's external booking until its own profile is complete.

### 4. Register the webhook

In the same Partner Portal environment, register the public Core callback URL ending exactly in:

```text
/webhooks/delivery/lalamove
```

Select webhook version 3. The exact path participates in signature verification. Confirm the
provider's initial connection check receives HTTP 200, then send a sandbox order status event and
verify one `lalamove` inbox record is applied. Duplicate delivery of the same `eventId` must be an
acknowledged no-op.

### 5. Run sandbox acceptance

Credential-safe evidence recorded on 2026-09-06:

- authenticated PH city discovery returned Cebu Islandwide (`PH CEB`), including the current
  `MOTORCYCLE` service with a 20 kg load limit;
- a signed, immediate two-stop Cebu quotation succeeded, returned PHP 40.00, a provider request ID,
  and the expected short quote expiry, with no special requests; and
- the smoke command created no provider order and used no customer data.

Order creation/get/cancel and an actual sandbox webhook delivery remain production-activation gates;
the adapter contract and failure paths are covered by automated tests, but those tests are not a
substitute for portal-backed end-to-end evidence.

Verify, without using real customer data:

1. `GET /v3/cities` returns the configured Cebu service key.
2. An immediate quotation succeeds with the FreshMarkets origin and a serviceable test destination.
3. The quotation total is converted to the expected integer PHP minor units.
4. Order creation returns an order ID and share link, and the saved merchant metadata identifies the
   FreshMarkets test order.
5. Recipient name, E.164 phone, address, exact coordinates, and delivery instructions appear in the
   driver flow as intended.
6. The quotation contains no `item` block, proof of delivery is enabled, and no thermal-bag, COD,
   COD-autodeduct, or purchase-service option is requested.
7. Status webhooks authenticate, deduplicate, and remain ordered by `updatedAt`.
8. Cancel behavior is tested both while assigning a driver and after the documented cancellation
   window closes.
9. A simulated network interruption after order submission enters reconciliation instead of
   creating another order.

The credential-safe quotation smoke command uses synthetic Cebu addresses and creates no order:

```powershell
pnpm --filter @freshmarkets/core lalamove:smoke
```

The smoke command creates no order. Customer payment is owned by FreshMarkets; Lalamove is paid
separately from the funded provider arrangement, so these tests must never enable provider COD or
purchase service.

### 6. Production activation

Fund the Lalamove production wallet and obtain production credentials. Store them with Wrangler's
interactive secret command from `apps/core`:

```powershell
pnpm exec wrangler secret put LALAMOVE_API_KEY --config wrangler.jsonc --env production
pnpm exec wrangler secret put LALAMOVE_API_SECRET --config wrangler.jsonc --env production
```

These commands target `freshmarkets-core-production`; Cloudflare documents that [`secret put` deploys a new Worker version](https://developers.cloudflare.com/workers/configuration/secrets/). [Environment bindings are configured separately](https://developers.cloudflare.com/workers/wrangler/environments/).
For sandbox staging, use separate sandbox credentials and the explicitly separate commands:

```powershell
pnpm exec wrangler secret put LALAMOVE_API_KEY --config wrangler.jsonc --env staging
pnpm exec wrangler secret put LALAMOVE_API_SECRET --config wrangler.jsonc --env staging
```

Those commands target `freshmarkets-core-staging`. Documentation maintenance does not authorize
running either set, uploading secrets or releasing configuration. Enable `lalamove` in that environment's ordered
`DELIVERY_PROVIDERS` only after all acceptance evidence above passes. Production and sandbox keys
must never be mixed.

### 7. Dispatch and incident recovery

Admin Delivery is an external-courier queue. It creates one provider delivery per customer Order;
there is no internal Rider, batch or route-planning path. Approved customer external-provider tracking
and Order messaging remain separate from third-party rider chat. Instant first booking runs
automatically at Start packing using the customer-selected provider/service, with bounded safe retries.
Scheduled uses Purchase complete -> Finish packing -> staff Lalamove or Manual dispatch; its courier
pickup may be immediate or supported future pickup within the committed boundary. Manual is ordinary
for Scheduled and Instant recovery only after definite prior-attempt closure and completed packing.

- On a definite provider rejection, preserve the failed dispatch and use a new reviewed operator
  intent only after the cause is corrected.
- On `OUTCOME_UNKNOWN` or `RECONCILIATION_REQUIRED`, never blindly create again. Use the provider
  order identity/merchant reference to reconcile, then refresh the existing dispatch.
- Webhook duplicates and older observations are acknowledged no-ops. Invalid signatures are 401;
  do not disable verification during an incident.
- A manual refresh calls provider GET and applies only that dispatch version. A stale result means
  another event won; reload before acting.
- Cancellation is accepted only when the provider confirms it. A transport timeout is not proof of
  cancellation and must be reconciled.
- Provider status is projected only to supported FreshMarkets states. Do not fabricate an Arrived
  state or driver location when Lalamove did not provide that fact.
