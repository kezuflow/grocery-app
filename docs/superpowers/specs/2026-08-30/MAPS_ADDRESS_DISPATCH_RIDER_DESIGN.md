# FreshMarkets Maps, Address, Dispatch, and Rider Navigation Design

## Status

Implemented and integrated on `main` at `98c2378` on 2026-08-30. This document preserves the approved design for Mapbox-powered address confirmation and dispatch visualization, plus Google Maps navigation handoff for assigned riders.

## Goals

- Replace customer-facing raw coordinate entry with address search and exact pin confirmation.
- Keep Core authoritative for saved coordinates, serviceability, fulfillment assignment, batching, rider assignment, legal transitions, concurrency, and audit.
- Show all open deliveries in the selected Admin operational context as map pins and a synchronized accessible list.
- Let dispatch rectangle-select eligible pins, manually order up to 24 deliveries, preview the chosen driving path, and atomically create and assign one rider batch.
- Let a rider open the current delivery destination in Google Maps without embedding a second navigation product.

## Non-goals

- Automatic route or stop-order optimization.
- Live rider GPS tracking or customer-visible fleet tracking.
- Embedded turn-by-turn navigation.
- Traffic-backed fulfillment promises.
- Customer selection of fulfillment locations.
- Photo, signature, or recipient proof expansion.

## Architecture

Web renders maps through `mapbox-gl@3.29.0` using a URL-restricted public token. Browser requests call typed Web adapters, which call Core through the existing Service Binding. Core owns Mapbox Geocoding v6 and Directions adapters behind provider-neutral ports and uses the existing server token binding.

Mapbox Search Box is not used because its documented geography excludes the Philippines and its results are temporary-only. Customer search uses temporary Geocoding v6 responses for the active browser interaction. Core performs a `permanent=true` final lookup before storing Mapbox-derived coordinates or metadata. Customer-positioned or device-positioned coordinates are first-party inputs and may be stored with manually supplied structured fields when provider enrichment is unavailable.

The Admin map is a projection over Delivery-owned state. It never mutates orders or raw database rows. The rider Navigate action is a direct Google Maps universal URL using immutable stop coordinates; navigation itself produces no FreshMarkets state transition.

## Customer Address Flow

```text
Search or use current location
  -> choose a candidate
  -> review structured address fields
  -> drag pin to the exact entrance
  -> enter recipient/contact/instructions
  -> Core resolves serviceability
  -> save as serviceable or unavailable
```

The address editor is reused in checkout, the saved-address book, and the public serviceability surface. It supports Cebu-biased Philippines search, draggable pin confirmation, browser location, live serviceability feedback, and a textual geocoder fallback when the map cannot render. Customers never see raw latitude/longitude inputs.

Saved data separates recipient and phone, structured address components, coordinate confirmation provenance, Mapbox reference when applicable, and delivery instructions for building/unit, landmark, gate/guard, delivery note, and recipient/contact guidance. An unserviceable destination may be saved with an unavailable badge and correction action, but checkout rejects it. Address edits re-resolve serviceability and never rewrite committed order snapshots.

## Admin Dispatch Flow

The Delivery workspace is scoped by location, fulfillment mode, Scheduled cycle when applicable, status, and rider. All open deliveries in that context appear as status-styled pins and list rows. Assigned deliveries remain visible; only Core-approved `UNASSIGNED` or legally retry-assignable deliveries are selectable.

An explicit Select Area tool draws a rectangle. The client converts its corners to geographic bounds and selects eligible coordinates inside or on the boundary. Map and table selection stay synchronized, and the table remains the keyboard and map-failure fallback.

The selected-deliveries drawer enforces one to 24 deliveries, shows protected details on demand, and supports pointer reordering plus keyboard Move Up/Down controls. Route preview starts at the authoritative fulfillment location and follows the submitted manual order. Mapbox returns provider-neutral GeoJSON, total meters, seconds, and legs; it must not reorder stops. Preview failure warns but does not block assignment.

The final Create Batch and Assign Rider command includes location/mode/cycle context, rider ID, an ordered list of job IDs and expected versions, and an idempotency key. Core atomically verifies common scope/context, legal job states, active rider, coordinates, versions, and absence of an active conflicting batch. It creates the batch/stops/events, executes legal transitions, and assigns the rider. Any conflict fails the entire command.

## Rider Flow

Riders see only their assigned batches. The first unfinished sequence is the current delivery and upcoming deliveries are summarized below it. The current card contains immutable destination, recipient/contact data, instructions, and Core-derived lifecycle actions.

Navigate opens:

```text
https://www.google.com/maps/dir/?api=1&destination={latitude},{longitude}&travelmode=driving&dir_action=navigate
```

Origin is omitted so Google Maps may use the device location. The button opens the native Google Maps app when supported or a browser tab otherwise. The rider still explicitly records En Route, Arrived, Delivered, or Failed in FreshMarkets. Stable idempotency keys survive connection-loss retries.

## Contracts

Provider-neutral contracts add `AddressSearchCandidate`, structured address and instruction DTOs, `DeliveryMapPin`, `DeliveryMapView`, `EligibleRiderView`, `BatchRoutePreview`, `DeliveryBatchView`, and an ordered create-and-assign command. Core service methods are:

- `searchAddressCandidates`
- `resolveServiceability` (existing, expanded usage)
- `createCustomerAddress` / `updateCustomerAddress` (structured extensions)
- `getDeliveryMap`
- `getEligibleRiders`
- `previewDeliveryBatchRoute`
- `createAndAssignDeliveryBatch`
- `getRiderBatches`

Raw address JSON, polygon GeoJSON, fulfillment ranking rules, Mapbox responses, and Better Auth rows are not public DTOs.

## Persistence

Migration `0042` adds structured address, geocoder provenance, confirmation, and delivery-instruction fields while retaining historical compatibility columns and nullable metadata for legacy rows.

Migration `0043` converges delivery batches and stops onto the canonical model, supports nullable cycle for Instant, introduces canonical rider references, materializes immutable stop coordinates for map queries, adds events/versions/timestamps, and backfills one stop per existing delivery job without changing historical snapshots.

## Security, Privacy, and Reliability

- The Web token is public, read-only, and restricted to approved origins.
- The Core token is never returned to Web.
- Temporary Mapbox results are not persisted, cached across sessions, or logged.
- Logs record provider operation, duration, result category, and stable error code without address text, contact data, or coordinates.
- Customer address reads remain owner-scoped; Admin map/details require `delivery.read`; batch assignment requires `delivery.manage` and location scope; rider reads/actions require an active rider identity and assigned batch.
- Missing map rendering preserves textual address confirmation or the Admin table workflow.
- No new KV, Queue, Durable Object, Workflow, or public Core HTTP API is introduced.

## Testing and Acceptance

Tests cover provider mapping and storage rules, address ownership and serviceability, immutable snapshots, migration preservation, map selection geometry, accessibility fallbacks, batch validation and concurrency, idempotent replay, rider isolation, Google URL construction, and provider failures. CI uses fixtures and fake map adapters, not live Mapbox calls. Completion requires focused and full tests, formatting, naming and migration checks, lint, type checks, `vinext check`, Worker builds, and relevant Playwright flows.

## Locked Decisions

- Search then confirm pin is the primary address path.
- Unserviceable addresses are saved as unavailable and cannot be checked out.
- Rectangle selection creates one delivery batch.
- Dispatch manually orders deliveries; Mapbox previews but never optimizes.
- A batch contains at most 24 deliveries because the fulfillment origin consumes one of the Directions API's 25 coordinates.
- Create-and-assign is one atomic reviewed command.
- Rider navigation opens only the current delivery in Google Maps.
- Customer/Admin UI calls map pins “deliveries”; `DeliveryStop` remains internal domain terminology.
