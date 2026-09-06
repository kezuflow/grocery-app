# Lalamove Delivery Setup Runbook

This runbook activates the existing Core-only Lalamove v3 adapter. It does not change checkout,
delivery, or payment authority.

## Official source baseline

The implementation was checked on 2026-09-06 against the official Lalamove v3 API reference and
changelog (including changes published through August 2026), plus the official webhook tutorial
version 1.4 dated May 2023. Outbound API calls use the documented `Authorization` HMAC over the
timestamp, method, exact path, and body. Inbound webhooks instead verify the `apiKey`, `timestamp`,
and `signature` fields carried in the JSON payload, signing only the payload's `data` object and the
exact registered callback path.

## 1. Obtain sandbox credentials

Create or use the FreshMarkets account in the Lalamove Partner Portal and select the Sandbox
environment. Copy the sandbox API key and secret into `apps/core/.dev.vars`, which is ignored by
Git:

```dotenv
LALAMOVE_API_KEY=pk_test_...
LALAMOVE_API_SECRET=sk_test_...
```

Never put either value in `wrangler.jsonc`, Web variables, browser code, logs, tickets, or committed
fixtures.

## 2. Confirm Cebu service configuration

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

## 3. Configure every store pickup profile

Select each permitted store location in Admin, open **Delivery**, expand **Store courier pickup
profile**, and save its factual sender name, E.164 phone, optional email, structured pickup address,
and pickup instructions. The coordinate shown by the form comes from the fulfillment-location
record and cannot be overridden by the courier profile. Do not copy Central Cebu's profile into
another store: Core fails that store's external booking until its own profile is complete.

## 4. Register the webhook

In the same Partner Portal environment, register the public Core callback URL ending exactly in:

```text
/webhooks/delivery/lalamove
```

Select webhook version 3. The exact path participates in signature verification. Confirm the
provider's initial connection check receives HTTP 200, then send a sandbox order status event and
verify one `lalamove` inbox record is applied. Duplicate delivery of the same `eventId` must be an
acknowledged no-op.

## 5. Run sandbox acceptance

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

## 6. Production activation

Fund the Lalamove production wallet and obtain production credentials. Store them with Wrangler's
interactive secret command from `apps/core`:

```powershell
pnpm exec wrangler secret put LALAMOVE_API_KEY --config wrangler.jsonc --env staging
pnpm exec wrangler secret put LALAMOVE_API_SECRET --config wrangler.jsonc --env staging
```

Use the actual deployment environment name. Enable `lalamove` in that environment's ordered
`DELIVERY_PROVIDERS` only after all acceptance evidence above passes. Production and sandbox keys
must never be mixed.

## 7. Dispatch and incident recovery

Admin Delivery is an external-courier queue. It creates one provider delivery per customer Order;
there is no active Rider, batch, route-planning, or live-driver-map path. Instant must retain the
customer-selected provider/service snapshot. Scheduled permits an immediate pickup or a supported
future pickup within the committed delivery boundary.

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
