# Address maps and external dispatch

This runbook covers customer address confirmation and external-provider delivery operations.
FreshMarkets has no active internal Rider, batch, route-planning, or live-driver-map workflow.

## Address incidents

FreshMarkets does not operate customer service-area polygons or geofences. Configure the exact map
pin and courier pickup profile on every customer-fulfillment location.
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
2. Confirm the store pickup profile, committed destination, phone, promise/window, provider, and
   total shipping grams.
3. For Instant, book only the provider/service snapshotted from the customer option. For Scheduled,
   choose an enabled provider and an immediate or supported future pickup within the window.
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
