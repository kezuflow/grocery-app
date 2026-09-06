# Address maps and external dispatch

This runbook covers customer address confirmation and external-provider delivery operations.
FreshMarkets has no active internal Rider, batch, route-planning, or live-driver-map workflow.

## Address incidents

Production polygon deployment, activation, validation, and rollback tooling is not implemented.
The Web content-security policy must continue to allow Mapbox workers with
`worker-src 'self' blob:`. Bind or rotate the Core geocoder secret with
`wrangler versions secret put MAPBOX_ACCESS_TOKEN`; never place it in source or browser code.

- Mapbox search and reverse geocoding are advisory; Core persists the exact customer-confirmed pin
  and validates serviceability polygons.
- If geocoding is unavailable, do not guess coordinates or accept free-form text as serviceability
  evidence. Preserve the customer's draft and retry.
- Overlapping service areas resolve to the closest dispatch origin by Haversine distance, with the
  stable location-ID tie-break. A driving route provider never selects the owning location.
- Customer delivery phone is required and normalized; provider email is optional.

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
