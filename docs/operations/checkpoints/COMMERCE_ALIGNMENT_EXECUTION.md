# Commerce alignment — active checkpoint

## Current owner request — GLOBAL-SERVICE-AREAS-1 and checkout/delivery verification (2026-09-13)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. Owner requests the full checkout/payment/nearest-location/Lalamove booking flow reviewed
against current official provider requirements, plus an active Global Service areas Admin workspace
where independently named polygons (for example Cebu and Lapu-Lapu) gate customer ordering without
being assigned to individual fulfillment locations. Acceptance: customers outside every active area
receive explicit not-yet-serviceable feedback and cannot obtain an eligible fulfillment option or
reach payment; inside the union selects the nearest capable/mode-ready whole-order pin; area changes
invalidate unstarted quotes; Admin can list/add/edit/preview named polygons; payment commitment creates
assigned fulfillment/delivery work and automatic Instant booking occurs only when final packing starts;
required Lalamove pickup/destination data and unknown-outcome safeguards are verified. Full access and
commit/push authority were reiterated; no routine approval pause is required.

Starting branch/HEAD: clean `main` at `a2f99629`, matching `origin/main`. No deployment, live payment,
actual courier booking, destructive data operation or outbound message is part of this implementation.
The working slice uses the existing market-owned/versioned `service_area` table; delivery-zone and
location-link rows remain compatibility routing/snapshot structures, so no schema migration or
per-location association is introduced.

Implemented working-tree behavior: Core gates address resolution and every operational-candidate
checkout/revalidation path against the active Global-area union before nearest-pin ranking. Admin
serviceability contracts and UI now expose a numbered named-area list, Add service area, one polygon
editor and coordinate preview, with no nested zones or location checkboxes. Publishing retires only
the prior active version of the same market/code, advances geography configuration, supersedes
unstarted quotes, audits and stores the immutable command result. Customer address/editor and saved
address selection distinguish outside-area feedback from missing fulfillment capability. A checkout
regression proves an outside-area address cannot cause a courier quotation request.

Flow/code review confirms: fulfillment options and accepted provider quotation precede payment;
canonical provider-confirmed payment atomically commits the Order, immutable assigned-location
snapshot, NOT_STARTED fulfillment record and UNASSIGNED delivery job/stop. It does not book a rider.
For Instant, START_PACKING after item checks triggers the automatic booking path, which creates a fresh
short-lived quotation and then places the Lalamove order using the snapshotted selected provider/service.
Scheduled retains future-pickup booking after accepted goods and credible readiness. Booking requires
the fulfillment location's sender name, normalized E.164 phone, formatted/structured pickup address
and exact pin; the customer snapshot supplies recipient name/E.164 phone, formatted address, exact
destination pin and optional recipient remarks. Internal BAG/BOX, dimensions, unsupported PH item data
and store pickup instructions are not sent. Provider mutation is preceded by durable intent and an
ambiguous response cannot be blindly retried.

Verification at the final working-tree scope:
- Complete Core: 202 files / 1,650 tests pass. An aggregate run had first reached 201 files / 1,649
  tests with one stale pre-area browsing expectation; its test-only correction passed focused and in
  the complete rerun. Focused Global-area/checkout coverage also passes 7 files / 83 tests.
- Complete Web after the map fallback correction: 122 files / 497 tests pass. Contracts pass 19 files
  / 68 tests and the other shared-package suites pass. Workspace typecheck, lint, formatter and
  architecture checks pass, as does `git diff --check`.
- Web production build passes; Core build/deployment dry run passes; vinext compatibility is 100%,
  16 supported / 0 issues.
- Browser acceptance against an explicit isolated local Worker/D1 stack with all 96 migrations passes
  2/2 Chromium journeys: desktop publishes a uniquely named polygon through the real Admin form and
  reloads the persisted result; mobile verifies the live workspace at 390px without horizontal
  overflow. The first run exposed a post-load Google marker scene-update exception when localhost was
  rejected by the configured referrer policy. The map now degrades to the manual-coordinate editor;
  its regression tests pass 2 files / 11 tests.

Official documentation review is research evidence, not actual Lalamove account acceptance. No live
payment, provider mutation, deployment or outbound message was performed. Remaining activation evidence
is a real Lalamove sandbox/account quotation/booking/webhook journey and current enabled PH/Cebu
service-type confirmation. Concrete next action: commit this verified slice directly to main, push,
then perform provider acceptance when owner-supplied credentials and transaction authority are in scope.

## Prior owner request — GIT-SLICES-1 commit all changes and push (2026-09-13)

Owner requests all existing changes committed as one cohesive commit per slice or feature, then
pushed to main with a clean working tree. Full access and commit/push authorization were reiterated.
Plan context: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. This is Git integration of existing slices, not completion of the remaining commerce phase.
Acceptance: reviewed feature boundaries, relevant verification, all intended tracked/untracked
changes recorded, normal push to origin/main, and matching local/remote HEAD with no pending changes.

Starting branch/HEAD: main at `6c5349008f927c5c3fda370cb6360f6eb1e8b65d`; remote main matched.
The explicit all-changes request supersedes old outside-commit exclusions for the existing
`.codex/config.toml` deletion and product discussion. Their existing state is preserved in the commits.
Ignored credentials, local databases, generated builds and provider payloads remain outside Git.
Published history is preserved; no force push, deployment, provider transaction or outbound message.

Implementation integration is committed through `6f5855e7`, in eight cohesive groups:
- `2f7b3a89`: agent skills/guidance and existing config removal.
- `62889c4b`: superseded implementation plans and reports.
- `25b819f8`: Locations navigation in Global and location scopes (ADMIN-LOCATIONS-NAV-1).
- `1c92485b`: unified resizable Admin workspaces, Product authoring/preview/pricing and sidebar polish.
- `55dda3b6`: full-width storefront footer boundary (STOREFRONT-FOOTER-1).
- `eec557dd`: consistent development client-module identities.
- `137dd78f`: Google Maps, Places suggestions, shared address/pickup-pin editing and pin assignment
  (MAPS-GOOGLE-1, MAPS-AUTOCOMPLETE-1, LOCATION-PIN-EDITOR-1, DELIVERY-PIN-ASSIGNMENT-1).
- `6f5855e7`: guided checkout, saved-address selection and editable order/cart review.

This checkpoint, the existing design changes and the continuation-boundary reconciliation form the
ninth documentation commit. Shared checkout browser-configuration props were staged with maps;
the rest of checkout was committed separately without rewriting working files or published commits.

Verification on the integrated source represented by `6f5855e7`:
- `pnpm.cmd check`: formatting, naming, terminology, 31 harness tests, migrations, commit convention,
  architecture, readiness, lint and all workspace typechecks passed. Web passed 122 files / 496 tests;
  contracts passed 19 files / 68 tests; config/domain-shared/validation each passed 1 file / 2 tests.
  Core completed 202 files / 1,652 tests with 199 files passing and 7 stale expectations failing in
  three files. The aggregate exited nonzero and was not rerun end-to-end after test-only corrections.
- `pnpm.cmd --filter @freshmarkets/core test src/customer-address.integration.test.ts src/admin/application/serviceability-administration.integration.test.ts --maxWorkers=1`: 2 files / 50 tests pass after correction.
- `pnpm.cmd --filter @freshmarkets/core test src/checkout/application/cart-location-carryover.integration.test.ts`: 1 file / 4 tests pass after correction. All three previously failing files have passing rerun evidence; the other 199 Core files were unchanged.
- `pnpm.cmd --filter @freshmarkets/web test components/admin/admin-accessibility.test.tsx lib/core-client/security-boundary.test.ts`: 2 files / 19 tests pass; the subsequent complete Web run also passed.
- `pnpm.cmd --filter @freshmarkets/core --filter @freshmarkets/web build`: both pass; Core is a deployment dry run. Existing environment, plugin-timing and chunk-size advisories remain.
- `pnpm.cmd --filter @freshmarkets/web check:vinext`: passes, 16 supported / 0 issues.
- `pnpm.cmd --filter @freshmarkets/core exec wrangler types ./src/worker-configuration.d.ts --check` and the Web equivalent using `./worker-configuration.d.ts`: both current.
- Post-correction Core typecheck, focused oxlint, full formatter check and `git diff --check`: pass.
  Reviewed local links in eight changed owning guides/runbooks: no missing targets. Pattern scan of
  changed files found no suspected credentials; this is not an exhaustive secret audit.

Integration corrections: formatter fixes; whitespace-tolerant accessible-label assertion; current
pin-model runbook/address/Admin-preview/cart expectations; capability fixture restoration so later
tests do not inherit disabled locations. Rejection/no-Cart/no-success-receipt and readiness checks
remain asserted. No production business behavior was changed while repairing these tests.

GIT-SLICES-1 has nine commit groups at the Git-integration counting level. The session must finish
with `git push origin main`, matching remote/local HEAD and clean status; this record is necessarily
committed before those final checks. No new browser or actual provider acceptance is claimed.
Earlier commerce/provider/visual acceptance obligations remain open; their historical evidence below
is preserved, and this Git request does not mark Phase 7 complete or authorize a new deployment.

## Prior records — historical implementation and acceptance evidence

All following uncommitted-state, active-slice and next-action statements describe the time recorded.
The current request and Git state above supersede them; their prior acceptance limits remain evidence.

## Latest owner request — MAPS-AUTOCOMPLETE-1 Google Places suggestions (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. Owner authorized Google autocomplete for the location pins and asked which application/key
owns it. Acceptance: Admin pickup and customer address editors suggest while typing, selecting one
resolves address fields and moves the pin, newer pin/query actions reject stale details, and Core
keeps the provider credential and final write authority.

Implemented in the dirty `main` working tree at `6c5349008f927c5c3fda370cb6360f6eb1e8b65d`:
Core exposes typed autocomplete/selected-prediction RPCs, validates input, and calls Places API (New)
with bounded fetches, safe telemetry, Philippines restriction and soft proximity bias. Predictions
contain no coordinates; only selection fetches details. An editor UUID groups prediction/detail
requests and is retired on selection. Details include the place name so a landmark with a broad postal
address still fills a meaningful address line. Web uses private POST/no-store endpoints, validates
provider-neutral replies, preserves pin adjustment, and shows Google Maps attribution. Existing
reverse-geocoding/finalization and saved-address writes remain unchanged. API contracts and maps
runbook document the new boundary and server-key API restriction.

Actual acceptance: the existing local Core server key returned HTTP 200 for Google Autocomplete and
Place Details; five suggestions and valid coordinate/address data were observed. Browser acceptance
on localhost traversed real Web -> Core -> Google in both the customer serviceability editor and
Admin Locations: type-ahead suggestions appeared, selection moved the map pin, customer nearest-center
read resolved, and Admin filled the landmark/address/coordinate fields. Closed the Admin draft without
saving the public-landmark test pin. No customer address was saved and no provider transaction or
deployment was performed. The local dev server is running at localhost:3000.

Verification on this working tree:
- `pnpm --filter @freshmarkets/core test src/geography/infrastructure/google-places.test.ts src/geography/infrastructure/provider-telemetry.test.ts`: 2 files / 10 tests pass.
- `pnpm --filter @freshmarkets/web test components/storefront/address/address-editor.test.tsx components/admin/locations-workspace.test.tsx test/app/google-maps-key-security.test.ts`: 3 files / 26 tests pass, including selected-detail/session behavior and a late-detail/manual-pin race.
- `pnpm --filter @freshmarkets/contracts test`: 19 files / 68 tests pass.
- `pnpm --filter @freshmarkets/core --filter @freshmarkets/web --filter @freshmarkets/contracts typecheck`: pass.
- `pnpm --filter @freshmarkets/web build` and `pnpm --filter @freshmarkets/core build` (dry-run only): pass.
- Focused oxlint/oxfmt and `git diff --check`: pass (existing CRLF notices only).

Failure/recovery: initial real Worker request returned GEOCODER_UNAVAILABLE despite a successful
Node/provider probe. Calling runtime fetch through an arrow instead of the adapter method receiver
fixed the actual Worker request; both browser flows passed afterward. The broader Web selection that
included `lib/core-client/security-boundary.test.ts` had 29 passing tests and one pre-existing failure:
it still expects the retired polygon-deployment sentence in the maps runbook. This is recorded, not
silenced or counted as a passing aggregate. The full commerce aggregate was not rerun.

Preservation/release boundary: this checkout already contains extensive tracked/untracked work,
including the uncommitted Mapbox-to-Google migration on which these editors depend. No unrelated files
were staged or committed; extracting a standalone autocomplete commit would omit required migration
files and would not represent the verified tree. MAPS-AUTOCOMPLETE-1 local implementation and real local
provider/browser acceptance are complete; release integration remains open. One next action: integrate
and verify the existing map migration together with this slice before committing/pushing and performing
any separately authorized deployment. Earlier commerce acceptance obligations remain open.


## Latest owner request — ADMIN-LOCATIONS-NAV-1 expose Locations (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. The owner reported that the implemented `/admin/locations` pickup-pin editor was not
reachable from either Global or Central Cebu navigation. Acceptance: Core-authorized Staff with
`locations.read` or `locations.manage` see one Locations destination under Administration in Global
and selected-location scope; the destination uses the existing capability-filtered navigation
contract and opens `/admin/locations`; Web does not invent access.

Implemented in the current dirty `main` working tree from `6c534900`: Core already published the
Locations workspace for capable Staff, but Web silently dropped the unknown `locations` code because
its closed canonical order and icon map omitted it. Web now recognizes the destination, gives it a
map-pin icon and orders it under Administration. Core now declares the destination applicable to
both `GLOBAL` and `LOCATION`, so choosing Central Cebu no longer hides it. Existing Core location
read/manage checks remain authoritative.

Verification in this working tree: focused Web navigation passes 1 file/14 tests; focused Core Admin
context integration passes 1 file/14 tests; Web and Core typechecks pass; `git diff --check` passes
apart from pre-existing line-ending warnings in unrelated dirty files. No browser automation was run
for this correction. Changes remain uncommitted because the navigation files are part of the large
owner-owned dirty working tree. Next action: refresh the running Admin shell and use Administration →
Locations in either Global or Central Cebu scope to open the fulfillment-center pickup-pin editor.

## Latest owner request — LOCATION-PIN-EDITOR-1 per-location pickup pins (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. The owner asked to set the location pin inside each fulfillment-location record after
retiring customer geofences. Acceptance: Add/Edit Location exposes one explicit required pickup pin;
search, map click, drag, current location and manual-coordinate fallback all update the same stored
latitude/longitude; each Locations row shows its saved pin; the map does not render duplicate static
and draggable markers; Core remains the write authority and exact active-origin changes remain
blocked while an in-flight delivery or started payment uses that origin.

Implemented in the current dirty `main` working tree from `6c534900`: the existing Web-to-Core
location command already persisted exact latitude/longitude on every `fulfillment_location`, with
provider finalization, optimistic versioning, idempotency, audit and geography revision. The Admin
editor now presents that fact as a dedicated **Fulfillment location pin** card with clear required/set
state, address search, stable map, draggable/clickable pickup marker, independent current-location
action and visible coordinates. Manual fields are renamed Pickup pin latitude/longitude. Each
Locations row displays its stored pickup pin. Editing renders only the draggable marker; read-only
rendering uses one static marker, removing the prior two-marker overlap. Copy explains that this pin
is the Lalamove pickup origin and that customer-fulfillment pins participate in nearest-location
assignment.

Verification in this working tree: Web typecheck passes; focused Locations workspace and Google map
suites pass 2 files/11 tests; the focused Locations workspace rerun passes 1 file/3 tests with an
explicit assertion that an editable pin has one draggable marker and zero duplicate static points;
focused diff checking passes. Playwright browser acceptance was not run in this slice. Changes remain
uncommitted because the affected location/map files overlap the large owner-owned dirty working tree.
Next action: when a clean browser-acceptance window is available, create two fulfillment locations at
different pins and confirm customer assignment switches to the nearer pin while Lalamove remains the
route-availability authority.

## Latest owner request — DELIVERY-PIN-ASSIGNMENT-1 retire customer geofences (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. The owner explicitly superseded the per-location polygon/geofence model: every
customer-fulfillment location owns an exact map pin and courier pickup profile; a confirmed customer
coordinate selects the nearest active, capable whole-order location; checkout rechecks mode
readiness; and Lalamove quotation decides route-specific delivery availability and fee. Acceptance:
no polygon geometry or timed location-link can reject address confirmation, fulfillment readiness,
checkout option/quote selection or payment; stock cannot reroute/split the order; the Admin polygon
workspace is retired; retained area/zone records remain only where existing schema/snapshots require
their identities.

Implemented in the current dirty `main` working tree from `6c534900`: Core serviceability now loads
the market and active customer-fulfillment pins/capabilities only, ranks them by Haversine distance
with stable location-ID tie-break and returns null legacy area/zone context. Address selection and
checkout use confirmed coordinates even when an old saved `serviceable` flag is false. Checkout
options, Scheduled evaluation and quote revalidation select operational pins; customer copy now
separates fulfillment assignment from Lalamove route confirmation. Dispatch readiness no longer
requires an eligible service-area link. Scheduled destination reads/guards no longer require that
link. The pre-payment transaction no longer joins or checks service-area, zone status or timed
location-link eligibility, and a focused integration test proves an expiring legacy link during
provider quotation cannot reject payment creation.

The existing non-null zone identifier remains a compatibility routing bucket for Scheduled cycle,
checkout-attempt, delivery-job and immutable Order snapshot relations; its polygon geometry, status
and location-link interval have no assignment authority. The active Admin `/admin/locations` page
describes pin-based assignment and no longer links the service-area editor;
`/admin/locations/service-areas` redirects back to Locations, and direct Web reads/publication at
`/api/admin/serviceability` return the retired-resource result instead of mutating polygons. The
preserved discussion record, PRODUCT, architecture, contracts, data model, design guide,
maps/dispatch runbook and continuation
boundary now record the exact owner supersession without deleting historical polygon evidence.

Verification in this working tree: Contracts, Core and Web typechecks pass. Focused Core pin,
readiness, Scheduled destination, fulfillment-option and quote suites pass 7 files/66 tests. The
complete payment-reaction integration file passes 1 file/36 tests, including legacy-link expiry at
the provider boundary. Focused Web address, checkout and Locations suites pass 6 files/47 tests.
No interactive browser check or live Lalamove quotation/booking was run in this slice; actual
provider/account acceptance and typed provider-specific rejection UX remain separate activation
evidence. DELIVERY-PIN-ASSIGNMENT-1 is implemented and locally verified at contract/Core/Web source
level. Changes remain uncommitted because these files overlap the large intertwined owner-owned dirty
working tree. Next action: run clean-process browser acceptance of address selection -> nearest
location -> real configured Lalamove quotation without logging customer address or provider payload.

## Latest owner request — DELIVERY-ASSIGNMENT-REVIEW-1 polygon versus provider availability (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. The owner asked why two Cebu addresses can receive different availability results and
proposed using the address to select the closest fulfillment location while treating Lalamove as
the authority for delivery coverage. Acceptance for this diagnostic: trace the current decision,
distinguish FreshMarkets geography from provider availability, check current official Lalamove
behavior, and identify the cohesive policy boundary without making an unapproved rule change or
provider transaction.

Observed in the current dirty `main` working tree from `6c534900`: Core does not use the address's
city text as proof of delivery availability. It first requires the confirmed coordinate to fall in
an active service-area polygon and an active nested delivery-zone polygon. It then filters active
customer-fulfillment locations by zone assignment and Picking/Packing/Dispatch capabilities and
selects the nearest remaining site by deterministic Haversine distance. The owner-provided northern
Cebu City result resolves successfully through Google but Core returns `OUTSIDE_SERVICE_AREA`; the
bootstrap boundary is a small rectangular Cebu City placeholder, not Cebu Islandwide. This failure
occurs before fulfillment-option loading and before any Lalamove quotation request.

Current official Lalamove documentation lists Cebu Islandwide as a Philippine API city, but its
quotation endpoint can still reject a particular pickup/drop-off/service-type request with
`ERR_OUT_OF_SERVICE_AREA`; it publishes no single fixed maximum Cebu distance. A successful quote
contains provider distance, price and a short-lived quotation ID, but it is not a guarantee that a
driver has already matched. The existing Core flow already obtains Lalamove pricing after internal
routing, although its quote helper currently collapses all provider quote failures to a null result
and the adapter normalizes a provider 422 to `LALAMOVE_HTTP_422`, losing the actionable out-of-area
distinction at the checkout boundary.

No source, configuration, database, provider, browser, or product-policy change was made for this
diagnostic. The current approved PRODUCT rule still requires stored per-site polygons, so replacing
that rule needs explicit owner approval and a cohesive contracts/Core/Web update. Recommended next
action: approve a two-stage model—use a broad configured Cebu market boundary plus nearest
operational site for catalog ownership, display courier availability as pending during address
selection, and make the provider quotation the route-specific delivery gate at checkout while
preserving typed internal readiness and provider-failure reasons.

## Latest owner request — MAPS-GOOGLE-BROWSER-ACCEPTANCE-1 checkout map error recovery (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. The owner explicitly authorized browser-skill inspection and requested reproduction of the
storefront delivery chooser with an owner-provided Cebu search query. Acceptance: the search resolves
through Core; selecting the result renders a usable Google basemap and draggable entrance marker;
Vinext's generic script-error overlay is absent; the browser console gains no new CSP, Google loader,
or Advanced Marker warnings; strict production CSP and browser/server credential separation remain
intact.

Root cause observed in the existing in-app browser: the configured Map ID selected Google's vector
renderer, whose WebAssembly bootstrap was rejected by FreshMarkets' nonce CSP. Google then displayed
only a gray surface and Vinext wrapped the cross-origin failure as an unhelpful `Script error` overlay.
The same browser session also showed deprecated Advanced Marker listener warnings and a development
HMR warning whose serialized loader options included the public referrer-restricted browser key.

Implemented in the current dirty `main` working tree from `6c534900`: the shared Google adapter now
explicitly selects raster rendering. Current FreshMarkets interactions—pins, clustering, polygons,
polylines, click/drag, and area selection—are supported by raster rendering, so production CSP retains
neither `unsafe-eval` nor `wasm-unsafe-eval`. Advanced Marker activation and drag completion now use
the current `gmp-` DOM events. Google loader configuration is stored on `globalThis` so Vite HMR does
not call `setOptions` again or serialize the browser key into its warning. The dependency optimizer
also excludes `lucide-react` and the Vinext package graph, which removed the separately observed
Lucide deep-module warning; Vinext beta.8 still reports its own relative internal prefetch-queue file
as inconsistently optimized despite the package exclusion, so that upstream development-only warning
remains recorded rather than hidden.

Browser acceptance: after a full reload, `Deliver to` opened, the search control expanded, the
owner-provided query returned its intended result, and selection rendered labeled Google raster map
tiles, Google attribution, camera controls, and the confirmed-entrance marker without changing the
dialog geometry. The result is outside the currently configured delivery polygon, so the explicit
`Delivery is unavailable` business result is expected and separate from map rendering. Browser logs
after the corrected replay contained zero warnings or errors; no credential value is stored here.

Verification in the working tree: Web typecheck passed; focused CSP, Google map, and address-editor
suites passed 3 files/43 tests; focused oxlint and oxfmt passed; `git diff --check` passed for the
affected source/guidance files; the full Web production build passed. A final `pnpm dev` clean start
serves localhost:3000 and remains running. Repeated development-server restarts briefly exposed
remote Cloudflare connection/R2 failures while the live-data tunnel reconnected; a clean start
recovered and served the storefront, so no local business-write or storage change was made.

MAPS-GOOGLE-BROWSER-ACCEPTANCE-1 is complete at browser, console, typecheck, focused-test, lint,
format, and production-build level. Changes remain uncommitted because the affected map, security,
Vite, architecture, runbook, and checkpoint files overlap the existing intertwined owner-owned dirty
working tree. Next action: keep the current raster renderer for checkout/Admin maps and track the
Vinext beta.8 optimizer diagnostic separately from this completed Google Maps browser recovery.

## Latest owner request — MAPS-GOOGLE-ACTIVATION-1 local credential/runtime validation (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. After configuring the Web browser key/map ID and Core server key, the owner requested a
local `pnpm dev` run, diagnosis of its warnings and the recommended Vite dependency-optimizer fix.
Acceptance: both ignored `.dev.vars` files are loaded without exposing their values; `/checkout`
responds; the server key can call the exact Geocoding and Routes APIs used by Core; the localhost-
restricted browser key can retrieve Maps JavaScript without a standard key/API/referrer/billing
error marker; the inconsistent RSC dependency optimization warning is absent after a cold start;
focused compatibility and build checks pass.

Implemented in the current dirty `main` working tree from `6c534900`: added both the public
`next/link` alias and its resolved `vinext/shims/link` target to `optimizeDeps.exclude`. The warning
identified Vinext's client-marked App Router prefetch queue, not either Google Maps package. Both
names are required because Vinext/Vite use the alias name while scanning the cold RSC dependency
graph and the resolved package name in the client shim configuration. Existing `vitest` and
`jsdom` exclusions remain. No credential value was printed, persisted in source or moved across
the Web/Core boundary.

Verification in the working tree: a cold `pnpm dev` loaded `apps/web/.dev.vars` and
`apps/core/.dev.vars`, served localhost:3000 and returned HTTP 200 for `/checkout` without the
inconsistent-optimization warning. Name/shape-only checks confirmed both API keys and the current
24-character alphanumeric Map ID shape. One generic-Cebu, non-persisting live provider probe
returned Geocoding HTTP 200/status `OK` and Routes HTTP 200 with one route. A localhost-referrer
Maps JavaScript fetch returned HTTP 200 and contained none of Google's standard invalid-key,
API-disabled, referrer-denied or billing-disabled error identifiers. Web typecheck passed; focused
Google map and browser-key security suites passed 2 files/9 tests; `vinext check` reported 100%
compatibility; focused oxlint/oxfmt and `git diff --check` passed; the full Web production build
passed. The dev server remains running. No browser skill, browser automation, deployment or
business write was used.

MAPS-GOOGLE-ACTIVATION-1 is complete at configuration, terminal runtime, provider-connectivity,
typecheck, focused-test and build level. Actual map rendering, Advanced Marker/Map ID behavior and
the approved nonce-CSP boundary still require owner visual acceptance in a real browser. The
pre-existing nonfatal Wrangler warning for `INITIAL_GLOBAL_ADMIN_EMAIL` remains: local development
uses the top-level empty disablement while staging intentionally requires an environment secret,
and copying the empty value into staging would weaken that setup. Next action: owner refreshes the
checkout address Location step and confirms map tiles, search, current-location, pin drag/click and
browser-console CSP behavior.

## Latest owner request — MAPS-GOOGLE-1 replace Mapbox with Google Maps (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation
evidence. The owner requested a provider-wide removal of Mapbox and replacement with Google Maps.
Acceptance: all active browser rendering, address search/reverse geocoding, road-distance and route-
preview paths use Google Maps Platform; browser and Core credentials remain separate; CSP and setup
guidance match the new provider; missing configuration fails closed; focused adapter, security,
address and route tests plus Web/Core type checks pass. Historical migrations and archived evidence
remain unchanged because they record prior persisted-schema facts rather than active provider use.

Implemented in the current dirty `main` working tree from `6c534900`: removed `mapbox-gl`, the
Mapbox renderer and three Core Mapbox adapters. Added a lazily loaded Google Maps JavaScript
renderer using an origin-restricted browser key, required vector map ID, Advanced Markers,
clustering, polygons, polylines, draggable pins, point activation and area selection. All customer
and Admin map consumers now pass Google browser configuration. Added server-only Google Geocoding
and Compute Routes adapters for search, temporary/permanent reverse resolution, checkout driving
distance and Admin route preview. Runtime bindings are `GOOGLE_MAPS_BROWSER_KEY`,
`GOOGLE_MAPS_MAP_ID`, `GOOGLE_MAPS_SERVER_KEY`, and provider selector `google_maps`; Web never
receives the server key. CSP permits only the required Google Maps script/image/connect origins.
The runbook records API activation, billing, referrer/API restrictions, rotation validation,
storage/attribution limits, and fail-closed behavior.

Verification: Web and Core typecheck pass. Focused Google map wrapper, address editor, Admin
locations, CSP and browser-key security tests passed (43 tests after correcting the test-only
`matchMedia` shim). Focused Google Geocoding, Routes distance/preview, runtime selection, PII-safe
telemetry and permanent browsing-location confirmation tests passed (23 tests after correcting the
synthetic Google response shape). The complete Web suite passed 122 files/490 tests. The first
unbounded complete Core run exited on Windows with `3221226505` without an assertion report; the
established bounded rerun passed 201 files/1,635 tests. Focused oxlint and oxfmt, Web production
build, Core Wrangler dry-run build and `git diff --check` passed. Builds intentionally warn that the
new Google bindings are absent from local secret files. Actual Google-provider acceptance is
blocked by owner-controlled Google Cloud billing/API enablement, restricted keys and map ID; no
live provider call, browser automation, deployment or business write was performed.

MAPS-GOOGLE-1 is complete at source, unit/integration, typecheck, lint/format and build level.
Provider and visual acceptance remain pending until the owner supplies the three environment
bindings. Google's current strict-CSP example also includes `unsafe-eval`, which the approved
FreshMarkets production policy forbids; this migration did not silently weaken that boundary.
Activation must prove the configured Maps JavaScript project works under the existing nonce CSP or
receive an explicit security/renderer decision. Changes remain uncommitted because the affected
checkout/editor/configuration/docs files overlap the existing intertwined owner-owned dirty working
tree. Next action: configure the Google Cloud project and restricted bindings, then validate map
load/CSP, address search/pin confirmation, route distance and route preview in the target
environment.

## Latest owner correction — STOREFRONT-CHECKOUT-MAP-CONTROLS-1 independent search and location controls (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. The owner requested that checkout Step 1 stop showing search and current location as one combined control surface: search should be a dedicated icon-triggered expand/collapse interaction and current location should remain a separate direct button. Acceptance: both actions are independently discoverable and keyboard accessible over the stable map; search expands without document reflow, focuses the field, closes from its trigger, close control, Escape or result selection and restores focus appropriately; current location operates without opening search.

Implemented in the current dirty `main` working tree from `6c534900`: replaced the always-expanded overlay bar with two persistent 44px circular map controls. The search icon toggles an origin-anchored panel below the controls; the panel stays out of layout, uses an interruptible 180ms opacity/transform transition, respects reduced motion, bounds result scrolling and is inert/hidden from assistive technology while collapsed. The location icon remains a sibling direct action, closes an open search without stealing focus, and preserves existing permission/error handling. Search is suspended while collapsed, selection collapses the panel, and Escape returns focus to the search trigger. Mobbin MCP references were visually inspected: Airbnb's map-anchored address entry and sweetgreen's independent locate control were combined for this interaction. The approved presentation is recorded in `docs/design/DESIGN.md`; Mapbox, Core search/reverse resolution, serviceability, API, contracts, storage, authorization and transactions are unchanged.

Verification in the working tree: the focused address-editor suite passed (1 file, 21 tests), including distinct controls, initial collapsed state, expansion/input focus, Escape collapse/focus return, result-selection collapse and stable map geometry; the complete Web unit suite passed (122 files, 501 tests); Web typecheck, focused oxlint, formatter and `git diff --check` passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's standing instruction, no browser skill, browser automation, screenshot automation or Playwright run was used; Mobbin MCP reference search was used as explicitly requested.

STOREFRONT-CHECKOUT-MAP-CONTROLS-1 is complete at source, unit, typecheck, lint and build level. Visual owner acceptance remains pending. Changes remain uncommitted because the shared editor, tests, design guide and checkpoint overlap the existing intertwined owner-owned dirty working tree. Next action: owner refreshes checkout and checks the two floating buttons, rapid search open/close, Escape/focus behavior, current location and result selection at desktop and mobile widths.

## Latest owner correction — STOREFRONT-CHECKOUT-MAP-1 stable map and overlaid location controls (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. The owner reported that the large Step 1 checkout map collapsed into a smaller two-column presentation after clicking or selecting a location, and requested that address search and current location sit over the map following established Mapbox interaction patterns. Acceptance: the map retains one full-width geometry before and after coordinate selection; search, results and device-location access are available in an accessible high-contrast overlay; map click/drag, reverse resolution, serviceability and step gating remain unchanged.

Root cause and implementation in the current dirty `main` working tree from `6c534900`: Step 1 conditionally added an `lg:grid-cols-[…]` class only after `coordinate` became truthy, so the interaction itself changed the layout and reduced the map to the second column. Replaced that state-dependent grid with one stable 420px mobile / 500px larger-screen full-width map surface. Address search and the existing browser-geolocation action now share a responsive white overlay at the map's top edge; search results expand as a bounded scrolling layer over the map rather than changing document geometry. Compact delivery selection and non-wizard address editing keep their existing layouts. The implementation adapts Mapbox's documented Search Box and Geolocate control placement while retaining the existing FreshMarkets Web-to-Core search, reverse-address and serviceability path instead of introducing a second client-owned provider integration. The approved presentation is recorded in `docs/design/DESIGN.md`; no Core, API, contract, storage, authorization or transaction behavior changed.

Verification in the working tree: the focused address-editor suite passed (1 file, 21 tests), including an invariant that search and current-location controls remain inside the same map surface before and after address selection; the complete Web unit suite passed (122 files, 501 tests); Web typecheck, focused oxlint, formatter and `git diff --check` passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's standing instruction, no browser skill, browser automation, screenshot automation or Playwright run was used.

STOREFRONT-CHECKOUT-MAP-1 is complete at source, unit, typecheck, lint and build level. Visual owner acceptance remains pending. Changes remain uncommitted because the shared editor, tests, design guide and checkpoint overlap the existing intertwined owner-owned dirty working tree. Next action: owner refreshes checkout, clicks the map and selects a search result at desktop and mobile widths, confirming that the map remains full width and the overlaid controls/results do not obstruct pin placement.

## Latest owner correction — STOREFRONT-CHECKOUT-PHONE-1 saved and format-aware delivery phone (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. The owner requested that checkout address details support both selecting an existing phone number and entering a different number, with Philippine mobile formatting while typing. Acceptance: valid account and saved-address phones appear as deduplicated choices; choosing one populates the field; “Use a different number” clears the field for free entry; local `09…`, compact `639…` and international `+639…` entry are grouped legibly without weakening the existing canonical phone validation or saved command.

Implemented in the current dirty `main` working tree from `6c534900`: the shared address editor now derives valid phone choices from the current address, account profile and saved addresses, displays them in canonical `+63 9xx xxx xxxx` form, and retains a separate editable telephone field. The input formats local numbers as `09xx xxx xxxx` and international numbers as `+63 9xx xxx xxxx` during entry, including partially entered values; the existing validator remains authoritative and the address command still persists canonical `+639…`. Checkout and the account address book both provide their saved-address phone set to the shared editor. Invalid legacy values are not offered as saved choices. The approved interaction is recorded in `docs/design/DESIGN.md`; no Core, API, contract, storage, authorization or transaction behavior changed.

Verification in the working tree: the focused address-editor suite passed (1 file, 21 tests), including initial formatting, saved-number order/deduplication, switching to a different number, partial international/local typing and canonical command serialization; the complete Web unit suite passed (122 files, 501 tests); Web typecheck, focused oxlint, formatter and `git diff --check` passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's standing instruction, no browser skill, browser automation, screenshot automation or Playwright run was used.

STOREFRONT-CHECKOUT-PHONE-1 is complete at source, unit, typecheck, lint and build level. Visual owner acceptance remains pending. Changes remain uncommitted because the shared editor, checkout, account address book, design guide, tests and checkpoint overlap the existing intertwined owner-owned dirty working tree. Next action: owner refreshes checkout, advances to address step 2 and checks a saved phone selection plus local and `+63` manual entry on desktop and mobile.

## Latest owner request — STOREFRONT-CHECKOUT-REDESIGN-1 complete guided checkout redesign (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. The owner approved a complete checkout redesign after Mobbin research into DoorDash, Uber Eats and Instacart delivery-checkout patterns. Acceptance: checkout remains one review workspace; adding or correcting an address replaces the full left workspace with the existing exact three-step address task while the rich cart/total summary remains visible; completion returns to a concise selected-address state and exposes delivery choices, promotion entry and payment review without weakening quote invalidation or Core authority.

Implemented in the current dirty `main` working tree from `6c534900`: rebuilt `/checkout` as a full-width two-column review surface with a sticky 420px order summary, responsive header and secure-payment context. The delivery card now presents a concise confirmed-address summary, collapsible saved-address choices and a direct add action. Add/correct opens a dedicated left-hand address workspace instead of nesting another constrained form inside the card. The three-step editor now has persistent Location / Details / Instructions progress, a larger exact-entrance map, confirmed-location context on later steps and one coherent Back / Continue / Save-and-use action footer. Delivery options are selectable arrival cards; promotion and payment review use the same hierarchy. Product media, editable quantity, right-aligned line totals, active-quote release before cart mutation, stale-response guards, payment handoff and Core-owned serviceability/quote decisions are unchanged. The approved presentation is recorded in `docs/design/DESIGN.md`; no Core, API, contract, storage or authorization behavior changed.

Verification in the working tree: focused checkout/address/summary suites passed (8 files, 37 tests); the complete Web unit suite passed (122 files, 500 tests); Web typecheck, focused oxlint, formatter and `git diff --check` passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's standing instruction, no browser skill, browser automation, screenshot automation or Playwright run was used.

STOREFRONT-CHECKOUT-REDESIGN-1 is complete at source, unit, typecheck, lint and build level. Visual owner acceptance remains pending. Changes remain uncommitted because the checkout, shared address/summary components, design guide, tests and checkpoint overlap the existing intertwined owner-owned dirty working tree. Next action: owner refreshes `/checkout` locally and checks the saved-address summary, all three address stages, delivery selection and sticky editable order summary at desktop and mobile widths.

## Latest owner correction — STOREFRONT-CHECKOUT-ADDRESS-GUIDE-1 three-step address guide and rich order summary (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. The owner clarified that the guided multi-step treatment belongs inside checkout address creation/correction, not around the entire checkout page. Acceptance: adding or correcting an address uses exactly three stages—find/search or use current location and confirm the exact pin; complete address and recipient details; add delivery instructions and save—while delivery details, promotions, delivery options and total review remain together in the checkout workspace. The sticky order summary shows image, name, editable quantity and right-aligned price without weakening the existing quote/payment state machine.

Implemented in the current dirty `main` working tree from `6c534900`: removed the mis-scoped outer checkout stepper and restored the complete checkout review workspace. Checkout now enables the existing address editor's `multiStep` mode for both new and corrected addresses. Its first stage contains search, device-location choice, draggable/clickable exact-entrance pin confirmation and coverage feedback; its second validates address and recipient fields; its third captures courier-facing instructions and saves through the existing idempotent address command. The sticky summary renders product media, product/fixed-pack identity, the shared cart mutation path through an inline quantity stepper, sale/unavailable price states and right-aligned line totals. Quantity changes still release an active quote before cart mutation and require delivery/total review again. The approved presentation and transaction ordering are recorded in `docs/design/DESIGN.md`. No Core, API, contract, storage or authorization behavior changed.

Verification in the working tree: focused checkout/address/order-summary suites passed (7 files, 35 tests), including address step gating, exact location/serviceability, retained form values, final-step-only save, idempotent uncertain-write recovery and checkout enabling `multiStep`; the complete Web unit suite passed (122 files, 500 tests); Web typecheck, focused oxlint and formatting passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's explicit instruction no browser skill, screenshot automation or Playwright run was used.

STOREFRONT-CHECKOUT-ADDRESS-GUIDE-1 is complete at source, unit, typecheck, lint and build level. Visual owner acceptance remains pending. Changes remain uncommitted because the checkout, shared summary, design guide, tests and checkpoint overlap the existing intertwined owner-owned working tree. Next action: owner opens `/checkout` locally and verifies all three address stages plus the sticky editable order summary.

## Latest owner correction — STOREFRONT-CART-ROW-1 quantity and price alignment (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested that each item in the FreshMarkets “Your cart” drawer place its quantity control and price on the same line, with price aligned right. Acceptance: product identity remains above; the existing quantity mutation controls remain together on the left; regular/current or unavailable line-total presentation remains on the right without changing authoritative cart totals.

Implemented in the current dirty working tree from `799addf6`: moved the existing line-total presentation into the same flex row as the quantity stepper, kept the stepper non-shrinking, and pinned the tabular line total to the right with right alignment and no wrapping. Sale-price strike-through, unavailable states, button labels, disabled-state policy and cart mutations are unchanged. The presentation rule is recorded in `docs/design/DESIGN.md`. No API, Core, contract, storage, authorization or business behavior changed.

Verification in the working tree: the focused cart-drawer suite passed (4 tests), including the quantity/price row geometry contract; Web typecheck and focused oxlint passed; `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. Per the owner's explicit instruction, no browser skill, screenshot inspection or DOM automation was used.

STOREFRONT-CART-ROW-1 is complete at source/build level. Visual owner acceptance remains pending. Changes remain uncommitted because the storefront cart, design guide and active checkpoint are part of the existing intertwined owner-owned working tree. Next action: owner opens the cart locally and confirms quantity-left/price-right alignment for ordinary, discounted and unavailable items.

## Latest owner request — BRAND-LOGO-1 shared FreshMarkets brand mark (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested an original logo for the Admin dashboard, Storefront and browser `.ico`. Acceptance: one cohesive FreshMarkets mark uses the approved storefront forest/lime palette, remains legible at favicon size, is available as a transparent reusable project asset, replaces the existing Admin and Storefront placeholder marks, and is served as the browser icon without changing business behavior.

Implemented in the dirty `main` working tree from `799addf6`: generated an original leaf-and-market-basket mark with the built-in image generator, normalized it to the exact two-color palette (`#1F3D24` and `#B7F34A`) with a transparent alpha channel, saved the 1024px master under Web public assets, and derived a multi-size 16/24/32/48/64px `favicon.ico`. Added one decorative shared React mark component, replaced the Admin mobile/desktop Sprout placeholders and the Storefront lime square, and retained each link's existing accessible name. No API, Core, contract, storage, authorization or business behavior changed.

Verification in the working tree: the focused brand/Admin/Storefront suites passed (17 tests); Web typecheck passed; the production Web build passed with only the existing large-chunk advisory; asset inspection confirmed RGBA transparency and only the approved two RGB colors; the `.ico` contains 16/24/32/48/64px entries; localhost returned `/favicon.ico` as `image/x-icon` with HTTP 200; desktop and mobile Storefront screenshots and a 16–128px light/dark scale proof were visually reviewed. Admin integration is source/render-test/build verified; an authenticated Admin browser view was not changed or exercised.

BRAND-LOGO-1 is complete at local asset, source and Storefront-browser level. Deployed acceptance and owner visual approval of the authenticated Admin shell remain pending. Next action: owner refreshes the Admin shell and confirms the shared mark in collapsed, expanded, mobile and dark appearances.

## Latest owner correction — ADMIN-SIDEBAR-COLLAPSE-1 deterministic icon rail (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner reported that labels such as Overview, Products and Orders remained visible after the desktop Admin rail collapsed to icons. Acceptance: the collapsed rail cannot paint its wordmark, group headings or navigation labels; the 200ms rail transition remains interruptible; accessible names and the required right-side hover/focus tooltips remain; tooltip content does not linger when the pointer leaves; reduced-motion removes the layout transition.

Implemented in the current dirty working tree from `799addf6`: collapsed wordmark and navigation labels now combine explicit `visibility`, zero maximum width and zero opacity, are removed from the accessibility tree while their icon controls retain explicit accessible names, and retain the existing 200ms linear expand/collapse transition. Group headings use the same deterministic visibility boundary. The existing collapsed right-side tooltips remain available for icon discovery, but `disableHoverableContent` makes them close when the pointer leaves the icon rather than behaving like persistent navigation text. Reduced-motion makes these label transitions immediate. No navigation destinations, authorization, API, Core, contract, storage or business behavior changed.

Verification in the working tree: `pnpm --filter @freshmarkets/web typecheck` passed; focused oxlint passed; the corrected package-relative Admin accessibility suite passed (15 tests); `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. The first focused test invocation used a repository-relative path after the filtered runner changed directories and therefore found no test files; it was rerun with `components/admin/admin-accessibility.test.tsx`. Per the owner's explicit instruction, no browser skill, screenshot inspection or DOM automation was used.

ADMIN-SIDEBAR-COLLAPSE-1 is complete at source/build level. Visual owner acceptance remains pending. Changes remain uncommitted because the Admin shell, shared test and checkpoint contain intertwined owner-owned workspace changes. Next action: owner refreshes localhost and checks collapse, rapid reverse, hover/focus tooltips and reduced-motion behavior.

## Latest owner correction — ADMIN-PRODUCT-STATUS-LINE-1 compact preview status (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested removing the bordered Status field in the Product preview and placing the Status label and pill on one line. Implemented the preview section as a compact horizontally aligned label/pill row while retaining the section divider and shared semantic status pill. No API, Core, contract, storage, authorization or business behavior changed.

Verification in the working tree: Product preview and row-selection suites passed (5 tests), including an assertion that the former bordered field wrapper is absent; Web typecheck and focused oxlint passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's explicit instruction, no browser skill or visual automation was used.

ADMIN-PRODUCT-STATUS-LINE-1 is complete at source/build level. Visual owner acceptance remains pending. Changes remain uncommitted because the Product preview and tests are intertwined with the current owner-approved Admin workspace work. Next action: owner confirms the compact Status row locally.

## Latest owner correction — ADMIN-PRODUCT-ROW-PREVIEW-1 row-wide preview selection (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner clarified that Product preview selection belongs to each complete list row, not only to the Product-name control. Acceptance: clicking a row's informational content opens that Product's right-pane preview and visibly identifies the open row; bulk-selection checkboxes, action menus, links and other nested controls remain independent; keyboard and assistive-technology users retain an explicit controlled preview action.

Implemented in the current dirty working tree from `799addf6`: each Product table row now owns the pointer preview action and open-row accent state. The handler deliberately ignores nested interactive targets, so product selection/deactivation, action menus, edit/detail links and copy commands do not accidentally open the preview. The Product name remains an explicit focusable button, now labelled “Preview [Product name]” and retaining `aria-expanded`/`aria-controls` for the right pane. No API, Core, contract, storage, authorization or business-write semantics changed.

Verification in the working tree: Product list, Product preview and shared Admin accessibility suites passed (20 tests), including row-cell opening, open-row state and checkbox isolation; Web typecheck and focused oxlint passed; the full Web unit suite passed (119 files, 495 tests); the production Web build passed with only the existing large-chunk advisory. Per the owner's explicit instruction, no browser skill, screenshot inspection tool or DOM automation was used.

ADMIN-PRODUCT-ROW-PREVIEW-1 is complete at source/build level. Visual owner acceptance remains pending. Changes remain uncommitted because the Product list route/component/tests, shared Admin workspace, design guide and checkpoint contain intertwined owner-owned uncommitted work. Next action: owner confirms row selection, open-row treatment and nested-control isolation locally.

## Latest owner correction — ADMIN-PRODUCT-WORKFLOW-1 companion Product authoring and pricing layouts (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. After approving the selected-Product preview, the owner supplied companion references for Create Product, Edit Product/images and exact-location pricing and asked that they guide the other Product surfaces. Acceptance: preserve the breadcrumb-free full-width Admin system and real catalog policy while adding an honest live creation preview, a responsive details/images edit workspace with persistent actions, and a right-side master-detail price editor that uses the existing smooth resize/slide behavior.

Implemented in the current dirty working tree from `799addf6`: Create Product now renders a live customer-facing preview from entered Product identity, selected category, main draft image, status and first selling option. The preview explicitly says that exact-location price and availability are configured after creation instead of fabricating the reference's illustrative price. The embedded creator is forced into a single-column container-safe layout, places preview content at the top of its independent scroll area, moves Cancel/Create actions into a persistent footer and adds a dedicated close control; the standalone fallback keeps the preview in its editor aside. UI terminology now presents variants as “Selling options” during creation while preserving contract fields and writes.

Edit Product now uses a responsive two-column details/images workspace, reference-style section links, a real dirty-state warning and a persistent Cancel/Save changes bar. Product image management is a responsive card gallery with visible count while retaining main-image, ordering, alt-text, upload, replace, remove, uncertain-result recovery and Product version rules. Global exact-location price inspection is now a master surface: after the operator selects a selling option and location and Core confirms the current view/can-manage decision, Edit price opens `AdminMasterDetailWorkspace` on the Product detail route. The pane is independently scrolling, animated/resizable, shows only the selected authoritative facts, and retains the exact price command/idempotency identity after an unknown outcome. No API, Core, contract, storage, authorization or business-write semantics changed.

Verification in the working tree: Web typecheck and focused oxlint passed; the full Web unit suite passed (119 files, 494 tests), including Product form/preview, selected-Product preview, price workspace selection, read-only handling and unknown-outcome retry coverage; the production Web build passed with only the existing large-chunk advisory. The updated controlled browser specification records the new Edit price opening step, but per the owner's explicit instruction no browser skill, screenshot inspection tool, DOM automation or live business action was run.

ADMIN-PRODUCT-WORKFLOW-1 is complete at source/build level. Visual owner acceptance remains pending. Changes remain uncommitted because the affected Product list/detail/create/edit surfaces, shared Admin workspace/tests, design guide and checkpoint contain intertwined owner-owned uncommitted work. Next action: owner reviews Create Product preview and footer, Edit Product details/images and dirty-state actions, then opens/resizes/saves/closes an exact-location price pane locally.

## Latest owner correction — ADMIN-PRODUCT-PREVIEW-1 selected Product preview pane (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner clarified that Products should use the reference's selected-product preview in the right master-detail workspace rather than treating Add Product as the pane's default content. Acceptance: selecting a Product loads its authoritative current-scope detail and presents its image/identity, status, selling options with available price/status facts, honest catalog metadata, and full-detail/edit escape actions; Add Product remains an explicit pane mode and the master list stays visible.

Implemented in the current dirty working tree from `799addf6`: Product row selection now fetches the selected Product detail for the active Global or location scope, validates the response through the shared contract schema, aborts stale selection requests, and renders loading, persistent failure/reference and retry states. The new rich Product preview uses the actual primary media, Product/category identity, status, returned selling options, available exact-location prices, action permissions and catalog facts. It intentionally shows catalog version/latest recorded audit change instead of fabricating a creation date the read model does not provide. View Product, Edit and Add selling option remain dedicated-workflow escape actions; the existing embedded Add Product form opens only from the explicit Add Product action. No API, Core, contract, storage, authorization or business-write semantics changed.

Verification in the working tree: focused Product preview, Product list, Product form and Admin accessibility suites passed (23 tests); Web typecheck and focused oxlint passed; the production Web build passed with only the existing large-chunk advisory. Per the owner's explicit instruction, no browser skill, screenshot inspection tool, DOM automation or live business action was used.

ADMIN-PRODUCT-PREVIEW-1 is complete at source/build level. Visual owner acceptance remains pending. Changes remain uncommitted because the Products route, shared Admin tests, design guide and checkpoint contain intertwined owner-owned uncommitted work. Next action: owner selects Products locally and reviews preview/create mode switching, panel resize/scroll and full-detail actions.

## Latest owner correction — ADMIN-CATALOG-AUTHORING-PANELS-1 embedded Product and Category creation (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner identified that Add Product still navigated to a centered standalone page instead of visibly opening the smooth right-side workspace used by Promotions and Inventory sales, and requested the same correction for Add Category. Acceptance: both collection actions remain on their list route, open the animated/resizable right pane, keep the complete existing forms independently scrollable, and preserve command validation, idempotent retry and dedicated deep-link fallbacks.

Implemented in the current dirty working tree from `799addf6`: exported the existing Product and Category authoring flows as embeddable workspaces without duplicating their command logic. Products now toggles an embedded Add Product pane, retains its full product/variant/media validation and safely refreshes the collection after confirmed creation. Categories is now a full-bleed master-detail route; Add Category toggles its embedded form, confirmed creation refreshes the collection, and selected category rows also open the shared summary pane with full-detail/edit escape links. The standalone `/new` routes remain as deep-link/recovery fallbacks but are no longer the list actions. No API, Core, contract, storage, authorization or business-write semantics changed.

Verification in the working tree: focused Admin accessibility, product-list, product-form and category-authoring suites passed (24 tests); Web typecheck and focused oxlint passed; production Web build passed with only the existing large-chunk advisory. Source coverage asserts that Product and Category list actions no longer link to `/new`, both mount their authoring workspace inside the shared panel, and Categories participates in the shell's full-bleed route set. Per the owner's explicit instruction, no browser skill, screenshot inspection tool, DOM automation or live business action was used.

ADMIN-CATALOG-AUTHORING-PANELS-1 is complete at source/build level. Visual owner acceptance and direct pointer/keyboard review remain pending on localhost. Changes remain uncommitted because the affected shell, catalog routes, shared Admin tests, design guide and checkpoint contain intertwined owner-owned uncommitted work. Next action: owner opens Add Product and Add Category locally and verifies the visible slide, resize edge, independent form scrolling, cancel behavior and retained list context.

## Latest owner request — ADMIN-WORKSPACE-UNIFICATION-1 full-width Admin master-detail system (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested that the non-centered, multi-workspace treatment established by Promotions and Inventory sales apply across the Admin dashboard, explicitly naming Products, Orders, Customers and Banners, and requested deletion of Admin breadcrumbs. Acceptance: Admin pages no longer inherit a centered fixed-width canvas or render breadcrumbs; the four named resource lists use a responsive master-detail workspace with continuous desktop column resizing, an independently scrolling detail/editor pane, mobile slide-over behavior and reduced-motion handling; existing dedicated resource URLs and business commands remain available.

Implemented in the current dirty working tree from `799addf6`: removed the shell-wide maximum-width container and the Admin breadcrumb renderer/component, then removed remaining fixed centered wrappers from Admin page roots and shared transfer workspaces. Added `AdminMasterDetailWorkspace`, which centralizes the existing Promotions/Inventory-sales desktop split, animated mobile overlay, 220ms exit lifecycle and accessible pointer/keyboard resize handle. Products now opens selected product summaries in that pane while preserving full-detail/edit URLs; Orders and Customers open selected summaries in the pane while preserving their complete deep-link workflows; customer invitation authoring/history moved into the same pane; Banners moved its complete create/edit/media workflow out of the inline page body and into the independently scrolling pane. Other Admin pages use the complete available canvas without inventing a detail pane where no selected resource or authoring task exists. No API, Core, contract, storage, authorization or business-write semantics changed.

Verification in the working tree: focused Admin accessibility and product-list suites passed (18 tests); Web typecheck and focused oxlint passed; production Web build passed with only the existing large-chunk advisory. Source coverage asserts that all six master-detail routes are full-bleed, the four new pages use the shared workspace, panes expose their controlled relationship, and shared motion/resizing/reduced-motion contracts remain present. Per the owner's explicit instruction, no browser skill, screenshot inspection tool, DOM automation or live business action was used.

ADMIN-WORKSPACE-UNIFICATION-1 is complete at source/build level. Visual owner acceptance and direct keyboard/pointer review remain pending on localhost, and earlier commerce/provider obligations remain open. The change remains uncommitted because the Admin shell, product list, affected pages, design guide, tests and checkpoint contain intertwined owner-owned uncommitted work. Next action: owner refreshes each named Admin workspace locally and verifies list width, panel opening/closing, resizing, independent scrolling and deep-link escape actions.

## Latest owner correction — STOREFRONT-FOOTER-1 full-width shell boundary (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner reported that the desktop storefront navigation rail, its background and divider continued beside the footer. Acceptance: the footer spans the complete shell below both the navigation rail and content, the rail ends before the footer begins, and the existing mobile-navigation clearance remains intact.

Implemented in the current dirty working tree from `533f8888`: moved `StorefrontFooter` out of the content-column wrapper and placed it after the bounded sidebar-and-main row. That row now owns the viewport-filling minimum height, so the sticky desktop navigation stops at the row boundary while the footer occupies the full shell width. Footer content, destinations and mobile clearance remain unchanged. Updated the storefront presentation guidance and added a source-layout regression test. No route, API, Core, storage, authorization or business behavior changed.

Verification in the working tree: the focused StorefrontShell layout regression passed (1 test); Web typecheck, focused oxlint/oxfmt and Web build passed; the build emitted only the existing large-chunk advisory. Per the owner's explicit instruction, no browser skill, screenshot inspection tool, DOM automation or live business action was used.

STOREFRONT-FOOTER-1 is complete at source/build level. Visual owner acceptance remains pending on localhost, and earlier commerce/provider obligations remain open. These changes remain uncommitted because the shell, footer, design guide and checkpoint contain intertwined owner-owned uncommitted work. Next action: owner refreshes the storefront locally and verifies that the rail stops above the full-width footer.

## Latest owner request — ADMIN-SALES-SEARCH-1 product-search popup repair (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner reported that the New inventory sale product-search popup and adjacent form layout were wrong and explicitly requested Emil design-engineering guidance. Acceptance: search results behave as an anchored popup rather than expanding the form, remain usable inside the independently scrolling detail workspace, preserve remote search/selection and selling-option loading, and keep the narrow detail layout legible.

Implemented in the existing dirty working tree from `533f8888`: replaced the inline product-result list with the existing Base UI/Shadcn combobox primitive, using its portaled, origin-aware popup so results are not clipped by or added to the form's scroll height. Remote filtering remains authoritative; the popup provides loading, failure/retry, empty, result-count and pagination states, closes on selection, retains the selected product label, and supports the primitive's keyboard/highlight behavior. Location and product search are now stacked, full-width, visibly labeled controls instead of a viewport-triggered two-column row that cramped inside the 380–640px detail pane. List-fetch, detail-fetch and form-validation errors now have separate state so a search request no longer clears or duplicates unrelated errors. Popup motion is a near-imperceptible 150ms origin-aware ease-out and is removed for reduced motion. No API, Core, contract, storage, authorization, or business-write behavior changed.

Verification on the working tree: focused SaleTargetsPicker and Admin accessibility tests passed (18), including remote debounced search, portaled popup ownership, product selection, location-scoped option loading, price/stock preview, quantity validation and overlap warning; Web typecheck, focused oxlint/oxfmt and diff whitespace checks passed; `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. Per the owner's explicit instruction, no browser skill, screenshot, DOM automation, or live sale mutation was used.

ADMIN-SALES-SEARCH-1 is complete at source/build level. Visual owner acceptance remains pending on localhost. These changes remain uncommitted because the affected picker/test and surrounding Admin workspace files contain intertwined owner-owned uncommitted redesign work. Next action: owner searches, keyboard-navigates, selects, clears and retries product search in the New inventory sale workspace locally.

## Latest owner request — ADMIN-WORKSPACE-RESIZE-1 adjustable master-detail divider (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested a “scrollable edge” so the Promotions and Inventory sales detail workspaces can be adjusted. Implemented as the standard desktop resizable split-pane divider. Acceptance: a visible edge affords horizontal resizing, follows pointer movement directly, preserves a usable master/detail minimum, supports keyboard operation and reset, and does not add lag to the open/close motion.

Implemented in the existing dirty working tree from `533f8888`: shared `AdminWorkspaceResizeHandle` appears on the left edge of both detail panes at `xl`. Pointer capture keeps resizing active outside the narrow hit target; the pane tracks the pointer 1:1 between 380px and the smaller of 640px or the width that preserves a 560px master area. Grid easing is disabled only during direct manipulation and resumes for pane open/close. The separator is focusable and exposes orientation/current/min/max values; Arrow Left/Right adjust by 16px, Home/End select bounds, and double-click resets to 460px. The handle receives a larger invisible hit area, visible focus/hover/drag feedback, and reduced-motion-safe feedback. Width remains local UI state; no preference persistence, API, Core, contract, storage, authorization, or business-write behavior was added.

Verification on the working tree: focused Admin accessibility, promotion-status, and sale-target picker tests passed (22); Web typecheck and focused oxlint passed; `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. Compiled CSS contains the grid transition, open-width variable, resize cursor, touch-action suppression, and reduced-motion rule; diff whitespace checks passed. Source-level accessibility contracts cover both page labels, separator semantics, pointer capture, keyboard directions, and reset affordance. Per the owner's explicit instruction, no browser skill or visual automation was used.

ADMIN-WORKSPACE-RESIZE-1 is complete at source/build level. Pointer feel and visual owner acceptance remain pending on localhost. These changes remain uncommitted because the affected page, token, test, and checkpoint files contain intertwined owner-owned uncommitted redesign work. Next action: owner drags, keyboard-resizes, and double-click-resets both desktop workspace dividers locally.

## Latest owner request — ADMIN-WORKSPACE-MOTION-1 pane expansion/collapse motion (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested smooth expand/collapse motion for the full-bleed Promotions and Inventory sales master-detail panes, then clarified that the intended behavior is the visible workspace resize used by the Admin sidebar toggle beside Global—not only a form fade/translation. Acceptance: the desktop master and detail columns resize continuously while the pane is revealed/hidden, narrow screens retain slide-in/slide-out, interrupted toggles retarget cleanly, and reduced-motion users receive a gentler non-spatial transition.

Implemented in the existing dirty working tree from `533f8888`: both desktop workspaces now transition their second grid track from 0 to `clamp(420px, 28vw, 480px)` with the same 200ms linear resize pattern as the Admin sidebar, while a fixed-width inner form is clipped/revealed from the right so its contents do not reflow during the transition. Narrow screens retain the shared 240ms drawer transform/opacity motion and strong `--fm-ease-drawer` curve. A two-frame mounted/closed staging step guarantees the browser paints the initial state before opening, fixing the skipped entrance; reopening during close cancels teardown and retargets the transition. `prefers-reduced-motion` makes the layout change immediate, removes translation, and retains a short opacity transition. No motion dependency, API, Core, contract, storage, authorization, or business-write behavior was added.

Verification on the working tree: focused Admin accessibility, promotion-status, and sale-target picker tests passed (22); Web typecheck and focused oxlint passed; `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. Compiled CSS contains the grid-track transition, panel-width variable/clamp, reduced-motion rule, panel token, and drawer curve; diff whitespace checks passed. The layout contract covers both panes' resizing geometry, duration, curve, and reduced-motion behavior. Per the owner's explicit instruction, no browser skill or visual automation was used.

ADMIN-WORKSPACE-MOTION-1 is complete at source/build level. Feel and visual owner acceptance remain pending on localhost. These changes remain uncommitted because the affected page, token, and test files contain intertwined owner-owned uncommitted redesign work. Next action: owner feel-checks open, interrupted reopen, close, and reduced-motion behavior on both workspaces.

## Latest owner request — ADMIN-SALES-WORKSPACE-1 full-bleed creation pane (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested the same full-bleed master-detail treatment for `/admin/sales` as Promotions, with the top-level Inventory sales breadcrumb removed. Acceptance: the list owns the complete master area below the Admin header; the create-sale form is a flush right workspace section on wide desktops, has independent scrolling with persistent header/footer actions, and becomes a full-screen workspace below the wide-desktop breakpoint.

Implemented in the existing dirty working tree from `533f8888`: the Admin shell now shares an exact-route full-bleed workspace list for Promotions and Inventory sales and derives breadcrumb exclusion from that same list. Inventory sales uses a full-height two-pane grid at `xl`, a 420–480px right detail pane, fixed full-screen presentation below `xl`, independent form scrolling, an accessible close control, pinned footer actions, and bottom-anchored list pagination on sparse results. Loading/error states retain page padding. No sale API, Core, contract, storage, authorization, or business-write behavior changed; unrelated Admin redesign/configuration work remains untouched.

Verification on the working tree: Web typecheck passed; focused Admin accessibility, promotion-status, and sale-target picker tests passed (22); focused oxlint and diff whitespace checks passed; `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. The layout contract test covers the shared exact-route shell behavior plus Inventory sales wide split-pane geometry, full-screen narrow behavior, full-height pane, and close labeling. Per the owner's explicit instruction, no browser skill, screenshots, DOM inspection, or live sale mutation were used.

ADMIN-SALES-WORKSPACE-1 is complete at source/build level. Visual owner acceptance remains pending on localhost. The changes are not committed because the same Inventory sales, Admin shell, and layout-test files already contain intertwined owner-owned uncommitted redesign work; committing this slice independently would absorb unrelated work rather than produce a coherent revision. Next action: owner reviews the Inventory sales split workspace locally.

## Latest owner request — ADMIN-PROMO-WORKSPACE-1 full-bleed creation pane (2026-09-12)

Plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 7 — Complete journeys and activation evidence. Owner requested that `/admin/promotions` use the supplied master-detail reference: the create-promo-code surface consumes the complete right workspace section rather than remaining inside centered page constraints, and the top-level Promotions breadcrumb is removed. Acceptance: full-width list/pane ownership below the Admin header, independently scrolling pane with persistent header/footer, and a full-screen pane below the wide-desktop breakpoint.

Implemented in the existing dirty working tree from `533f8888`: the Admin shell gives the exact Promotions list route a full-bleed content mode while other Admin routes retain their centered container; Promotions now uses a full-height two-pane grid at `xl`, a 420–480px flush right pane, fixed full-screen presentation below `xl`, independent form scrolling, a visible close control, and pinned footer actions. Loading/error states retain page padding. The already-approved breadcrumb exclusion is preserved. No promotion API, Core, contract, storage, or business-write behavior changed; unrelated Admin redesign/configuration work remains untouched.

Verification on the working tree: Web typecheck passed; focused Admin accessibility and promotion-status tests passed (19); focused oxlint and diff whitespace checks passed; `pnpm --filter @freshmarkets/web build` passed with only the existing large-chunk advisory. The layout contract test covers shell full-bleed routing, wide split-pane geometry, full-screen narrow behavior, full-height pane, and close labeling. Per the owner's explicit correction, no browser skill, screenshots, DOM inspection, or live promotion mutation were used for this implementation.

ADMIN-PROMO-WORKSPACE-1 is complete at source/build level. Visual owner acceptance remains pending on localhost. The changes are not committed because the same Promotions and Admin shell files already contain intertwined, owner-owned uncommitted redesign work; committing only this slice would not produce a coherent revision without absorbing that unrelated work. Next action: owner reviews the Promotions split workspace locally.

## Latest owner request — PROMO-REASON-1 remove lifecycle reason entry (2026-09-12)

Plan: docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, Phase 7 — Complete journeys and activation evidence. Owner explicitly requests removing reasons from Promotions and Inventory sales. Acceptance: list confirmations and shared detail lifecycle actions submit without reason; Core accepts omission while preserving authorization, version, transition, replay and audit enforcement.

Implemented on main from 8224c25f: removed reason fields and client gates; shared contract/validation makes reason optional for existing callers. No fabricated reason or audit removal. Completed the existing uncommitted status-switch component/list wiring needed by both pages; preserved unrelated Switch styling, source/config changes and archive deletions. PRODUCT and API_CONTRACTS record the owner correction. No storage migration or deployment.

Verification in the working tree: pnpm -r typecheck passed; focused Web status-switch tests passed (4); Core Worker/D1 admin-promotions and promotion-effects integration tests passed (29), including activation/deactivation/archive without reason and an activation audit with null reason and correct before/after status. Focused oxlint/oxfmt, architecture:check, readiness:check and naming:check passed. pnpm -r build passed Web build and Core dry-run (existing bundle/environment warnings). Browser opened Promotions confirmation and verified Cancel/Deactivate with no reason field; Cancel dismissed without writing shared data. Inventory sales uses the same tested component. No live promotion status was changed as a test.

PROMO-REASON-1 complete at request-slice level. Earlier commerce/provider obligations remain open; full aggregate acceptance is not claimed. Next action: owner uses the simplified controls on localhost.

## Parallel owner request — Admin UI/UX craft repair P0–P3 (2026-09-12)

Owner requested an emil-design-eng review of the Admin dashboard and approved fixing all findings P0–P3 in one pass (fix-in-place of the pinned visual system, not a redesign). Recorded as the "Admin craft repair program — 2026-09-12" section in docs/design/DESIGN.md, which owns the approved rules.

Implemented (Web only; no Core/contract/storage/migration change): installed tw-animate-css (overlay enter/exit animations were dead classes) and cmdk; `@theme inline` bridge mapping shadcn semantic utilities to `--fm-*` tokens; `--fm-radius-panel`, `--fm-primary-hover/-foreground`, `--fm-destructive-hover`, easing tokens, reduced-motion now keeps color/opacity transitions; token-mapped Sonner Toaster mounted inside the Admin scope and beside the auth provider (auth error toasts previously rendered nowhere); button press scale + token hovers; tooltip 400ms/150ms skip; sheet/alert-dialog/dialog enter-exit animations; popover/select/dropdown/tooltip/badge/card moved from oklch literals to tokens; all 53 Admin `bg-white`→`--fm-admin-surface` and both dark-mode CSS patch blocks removed; one status pill (AdminStatusPill classes; `.fm-product-status-*` deleted; per-badge live regions removed); one FilterBar in admin-controls (section/card variants; audit page restructured to the form); MetricCard uses Link; token-styled Recharts tooltip; Ctrl/Cmd+K command palette over Core-authorized navigation with a desktop header search trigger; toast policy helpers with product deactivation full-success/clipboard-failure as reference applications (partial failures keep inline banners).

Verification: Web typecheck passed; Web vitest 115 files/485 tests passed (admin-accessibility contract updated to the approved badge contract — badges are labels, live semantics stay with AdminPageState/AdminLiveRegion; next/navigation mock gained useRouter); vinext build passed; compiled CSS verified to contain animate-in/slide/zoom, active:scale-0.97, duration/ease var utilities, `.bg-muted`/`.text-muted-foreground`/`.ring-ring` bridged to tokens, `--fm-radius-panel`. E2E on the managed stack: admin-visual-regression 3/3 passed after pixel-level diff review and baseline re-anchor — observed diffs were exactly the intended muted notification text, the new header search trigger, and rail icons already stale on main since the banners (164ac8d0) and sales (55ae9721) workspaces were added after the baselines' last capture (db56b5b3); 18 baselines re-anchored and the spec re-ran green twice. admin-foundation and the remaining admin-catalog journeys passed; one pre-existing failure remains open on main independent of this work: admin-catalog.spec.ts:123 expects "Media uploaded." while product-media-upload.tsx renders "Image uploaded." (stale expectation vs current copy — needs an owner call, not silently changed here). No provider transaction, outbound message or deployment performed. Next action: owner exercises /admin on localhost (⌘K palette, toasts, dark mode, tooltips).

## Latest owner request — CA-7.47 shared admin catalog session resolution (2026-09-12)

Owner asked why /admin/sales location-scoped product detail requests took 9.5-12.6s, then approved the proposed authorization fix. Diagnosis: pnpm dev runs staging D1 remote:true, so each of ~15 serial queries per getAdminProduct round-trips to Cloudflare (~0.5-1s each); three separate resolveCatalogAdministrationAccess calls re-resolved the session, IAM capability/scope rows and operational market per capability before any product data.

Implemented: new resolveCatalogAdministrationSession in catalog-administration-access.ts resolves the application context, staff identity and operational scope once per request and exposes a require(capability) gate producing the same FORBIDDEN messages as the sequential resolver (prices capabilities keep global-only authorization). getAdminProduct and listAdminProducts now use it for their catalog.read/inventory.read checks; getAdminProduct's catalog.manage gate reuses the session instead of a fourth resolution (allowedActions unchanged). No contract, storage, API or error-code change; remaining data queries untouched.

Verification: Core typecheck passed; focused admin-catalog integration tests passed (20); full Core suite passed 201 files/1686 tests (one earlier background attempt reported failure spuriously — vitest ran from the wrong working directory and never started; a correctly rooted pnpm-filtered run passed fully); oxlint and oxfmt on changed files passed. Expected effect: roughly halves the remote round-trips for these admin reads; deployed latency also improves. Owner browser verification pending on localhost with shared staging. Next action: owner re-times product selection in /admin/sales; broader read consolidation remains the documented loading-investigation option.

## Latest owner request — CA-7.46 slices 2 and 3, sale creation and promo rules (2026-09-11)

Owner reported a 400 on sale creation from /admin/sales and disliked the create UI, then authorized finishing all redesign slices in one pass. The 400 was diagnosed as the generated SALE_ code containing lowercase hex (contract requires ^[A-Z][A-Z0-9_]*$); BFF validation rejected it before Core. Implemented at main before this commit.

Slice 2 (sale creation): new SaleTargetsPicker replaces the shared promotion targets editor on /admin/sales — live debounced product search, location select from admin scopes, location-scoped option fetch (scopeKind=LOCATION with marketId) showing per-option price and availability, live sale-price preview against the entered discount (₱120 → ₱96 with savings), approximate sellable pieces (availableBase / consumptionBaseQuantity), explicit whole-stock vs fixed-clearance-pool choice, overlap warning against currently ACTIVE sale targets, and target chips. During testing an infinite refetch loop was found and fixed: the option fetch effect depended on a derived scope object that changes identity every render; it now depends on the stable location id and resolves the scope inside the effect. Sale code generation upper-cases the suffix.

Slice 3 (promo codes): /admin/promotions create form gains an optional Rules section — minimum purchase, start/end datetimes (start defaults to now; end must be later), total and per-customer usage limits — all client-validated before submit; the list adds Window and Limits columns and shows the minimum under Benefit.

Verification: Web 485 tests passed (3 new SaleTargetsPicker tests cover debounce search with location-scoped fetch, price preview, whole-stock default vs fixed-pool validation, overlap warning); Web typecheck, oxlint, oxfmt, naming/architecture verifiers passed. Tests initially hung from the refetch loop above; fixed in the component, not the test. No Core, contract, storage or migration change this slice; no sale/promotion write performed. Owner browser acceptance pending. Next action: owner exercises both workspaces in localhost Admin; remaining known gap — shared promotion detail page still serves both kinds and per-order sale limits remain unimplemented (needs owner decision).

## Latest owner request — CA-7.46 promotions and inventory sales separation, slice 1 (2026-09-11)

Owner approves separating product sales from promo codes in Admin and redesigning both flows, after reporting a chosen abiu/location sale showing 1 piece against ~100. Proposed three-slice design accepted: (1) navigation/IA split, (2) sale-creation upgrade with live stock readout, whole-stock vs fixed pool, price preview and overlap warnings, (3) promo-code rules polish. Slice 1 implemented at main before this commit (working tree). Source: docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, Phase 7 — Complete journeys and activation evidence; GD-D06/GD-D07 remain the owning product rules.

Implemented: new /admin/sales workspace (Core-authorized navigation entry `sales`, promotions.read/manage capabilities) with sale-only create form (percentage/amount off each unit, targets editor always-on, SALE_-prefixed generated code since automatic sales never surface a code) and a sales list filtered to promotions with product targets, showing targets, sold/pool allowance and status via the unchanged promotion APIs. /admin/promotions is now promo-codes-only: product-sale checkbox/state removed and its list excludes promotions with product targets. Shared promotion detail page unchanged and remains the Manage target for both lists. No contract, Core write, storage or migration change.

Verification: Web 482 tests passed; Core 1686 tests passed (one pnpm-filtered run failed under concurrent-suite resource contention; isolated direct run and a second isolated pnpm run both fully passed — no test was changed). Web/Core typecheck, oxlint, oxfmt on changed files, naming/architecture/readiness verifiers passed. Browser acceptance belongs to the owner; no sale/promotion write was performed. The reported 1-of-100 allowance display is diagnosed as quantity-pool semantics (GD-D07 chosen clearance quantity or stock-cap math) and is scheduled for slice 2's live stock readout. Next action: owner verifies both workspaces in localhost Admin; slice 2 sale-flow upgrade follows owner go-ahead.

## CA-7.38 follow-up — pnpm dev startup investigation (2026-09-11)

Owner requests shared-storage localhost startup and investigation of pnpm dev. Source: docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, Phase 7 — Complete journeys and activation evidence; runtime follow-up only. Observed main at c22e336f with pre-existing configuration, documentation and deletion changes; preserved them. pnpm dev delegates to vinext dev; Vite config starts auxiliary Core and remote staging D1/R2. Earlier agent startup initially refused connections and eventually printed localhost readiness; agent restarted it prematurely. At resumed investigation, current vinext PID 11152 (started 15:29:27 local) listens on IPv6 ::1:3000. No source/configuration change or deployment made.

Executed read-only Node fetch probes: localhost and IPv6 /api/catalog?limit=1 returned HTTP 200, ok:true (2.8s and 0.86s); IPv4 127.0.0.1 refused. /api/core-health returned HTTP 200 with status ok and database binding configured. First full homepage response returned HTTP 200 with products and no catalog-error fallback in 30.2s; next measured request completed in 6.2s. In-app browser rendered catalog categories, prices and published banners after its loading state. Startup log has a multi-minute gap but no explicit connection failure; existing INITIAL_GLOBAL_ADMIN_EMAIL staging warning is nonfatal. Exact startup-delay cause and earlier native crash/remote-runtime issue remain unproven; this is successful current read acceptance, not a runtime fix or write/provider acceptance. Current server left running. Concrete next action if slow startup recurs: capture timestamped startup-stage diagnostics with credentials and remote proxy URLs redacted to distinguish remote handshake from Worker initialization.

## Latest owner request — CA-7.45 three-step address creation (2026-09-11)

Source: docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, **Phase 7 — Complete journeys and activation evidence**. Main at bcb1eb4f. Owner approves new-address sequence: find address/map, address and recipient details, delivery instructions, final Save address. Acceptance: step progress, Back/Continue with retained values, per-step validation and no address write before final submit. Implemented opt-in wizard only for new address creation in /account/addresses; existing address editing and compact Deliver to retain their flows. Step 1 requires a confirmed coordinate and completed coverage check; existing ability to save unavailable destinations for later correction remains. Step 2 validates required address/contact fields. Step 3 instructions are optional. Map stays mounted while hidden between steps; queries are cancelled away from step 1. Step titles receive focus. Existing guarded final save and uncertain retry behavior are retained.

Verification: Web typecheck, focused oxlint/oxfmt and diff whitespace check passed. 32 address-editor/delivery-dialog tests passed, including missing-location and missing-contact gates, Back retention, optional empty instructions and exactly one final write. No browser tools used per owner preference. No actual address/provider mutation performed. CA-7.45 implementation complete at request-slice level; owner performs visual verification. Preserved unrelated dirty work and earlier Phase 7/runtime/provider obligations. Next action: owner reviews the new-address steps.

## CA-7.44 final owner correction — inline search input (2026-09-11)

Main at 7cf37976. Owner clarifies icon click must reveal an input in the Deliver to header, not a dropdown. Replaced floating panel with inline header input and icon-only toggle; removed Search text/chevron and outside-click dismissal. Results remain below; focus, Escape, retained query and cancellation preserved. No browser tools used per owner instruction. Web typecheck, focused lint/format and 31 address editor/dialog tests passed. Source/phase remains docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, Phase 7 — Complete journeys and activation evidence. CA-7.44 correction implemented; owner performs visual verification. Earlier phase/runtime obligations remain open. Next action: owner reviews inline search.

## CA-7.44 owner correction — header search dropdown (2026-09-11)

Owner corrects the initial implementation: Search belongs on the same line as Deliver to and opens a dropdown, not an accordion. Owner will verify visually; no browser tools used for this correction. Source remains docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, Phase 7 — Complete journeys and activation evidence. Main at 8d53a43c. Moved Deliver to into the compact editor header beside Search and its chevron. Search input/results float below the header without expanding the layout; outside click, Escape and candidate selection dismiss it. Focus/query retention and cancellation remain. Full account editor unchanged. Web typecheck, focused lint/format and 31 editor/dialog tests passed. Visual acceptance belongs to owner. CA-7.44 correction implemented; unrelated changes and earlier phase obligations preserved. Next action: owner verifies dropdown placement.

## Latest owner request — CA-7.44 collapsible delivery search (2026-09-11)

Source: docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, **Phase 7 — Complete journeys and activation evidence**. Main at 164ac8d0. Owner requests expand/collapse of search in Deliver to. Acceptance: compact search starts collapsed, accessible icon/chevron row toggles input/results, expansion focuses input, collapse cancels pending search while retaining typed text. Current-location/map/saved-address controls remain available. Only compact AddressEditor changes; full account editor stays expanded. Preserved unrelated work.

Implemented disclosure with aria-expanded/controls, focus on expansion and search debounce/fetch cancellation on collapse. Verification: Web typecheck and focused oxlint/oxfmt passed; 19 address-editor tests passed including toggle/focus/query retention and cancellation. New timer test initially lacked fake-timer setup; corrected then passed. In-app browser verified collapsed row, expanded focused input and collapse. No address write, location permission or provider search performed. CA-7.44 complete at request-slice level; earlier Phase 7/provider/runtime obligations remain open. Next action: owner reviews dropdown behavior.

## Latest owner request — CA-7.43 standalone banners and upload limit (2026-09-11)

Source: docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md, **Phase 7 — Complete journeys and activation evidence**. Main at 25126087. Owner requires independent promotional banners, not images tied to financial promo codes; follow-up reports uploader retry failure. Acceptance: separate authorized gallery, independently versioned images/schedules/optional links, publication without a promo code, and working advertised upload size. Preserved unrelated dirty source/config/documentation and archive deletions.

Implemented /admin/banners with Core-authorized navigation, draft editing, media upload/replacement/removal, active date windows, priority and optional same-origin paths. Standalone storefront_banner and banner_media/upload/cleanup tables use guarded authority/version/effects, audit and immutable receipts. Storefront consumes independent published banners. Retained promotion-media data/APIs remain compatible; promotion detail links to Banners. Owning Product/Design/API/Data/State references updated. Admin gallery currently bounds reads to 200; public gallery to 20.

Shared staging had zero active promotion attachments. Exported a private pre-migration backup to C:/Users/reggi/AppData/Local/Temp/freshmarkets-before-banners-20260911.sql, then applied only additive 0096 with pnpm --filter @freshmarkets/core exec wrangler d1 migrations apply freshmarkets-core-staging --remote --env staging (nine commands succeeded). No application deployment or financial data change. Localhost continues to use shared staging D1/R2.

Verification: pnpm -r typecheck passed. Core focused storefront-banners, promotion-media and core-service-conformance tests passed (23); seven standalone Worker/D1/R2 tests cover independent publication, image-required rejection, replay, stale version, authorization, schedule boundaries, uncertain upload recovery and cleanup. pnpm --filter @freshmarkets/web test passed 478 tests before final upload/navigation corrections; final focused banner-media-editor/admin-navigation/promo-banners tests passed 17. pnpm -r build passed Core dry-run and Web build before final small UI/config changes. Architecture/naming/migration verifier scripts passed; focused oxfmt/oxlint passed. Final upload regression initially failed because its required description was omitted; corrected realistic form input then passed. Navigation test type fixture lacked marketId; corrected and typecheck passed.

Browser review initially hit stale dev module loading; restart restored Admin. Owner then created a banner and encountered repeated plain-text HTTP 413 before route handling. Installed vinext multipart progressive-action preflight used its default 1 MiB limit. Set experimental.serverActions.bodySizeLimit to 6mb for 5 MiB media plus envelope; application route/Core limits remain 5 MiB. Uploader now treats 413 as a definitive size rejection, without automatic duplicate retry or misleading unknown-success message. Restarted localhost; an unauthenticated 1.2 MB multipart probe reached normal Core auth rejection (no write), proving the preflight block removed. Owner retried their image and activated the banner; in-app Admin showed saved image/ACTIVE and storefront screenshot showed the real published image without a promo code. No synthetic shared banner was published by the agent.

CA-7.43 complete at this request-slice level. Upload still appears after draft creation; moving it into initial creation was suggested but not implemented. Existing remote proxy internal errors (CA-7.38) remain unresolved and are separate from the diagnosed 413. Phase 7 aggregate/provider obligations remain open. Next action: owner reviews standalone gallery; continue remaining commerce acceptance under its active plan.

## Latest owner request — CA-7.42 owner-requested test administrator (2026-09-11)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `74fc8606`. Owner explicitly supplied test credentials and authorized creation after shared staging database disclosure. Existing target identity and Global scope were absent. Seeded only the requested test identity and Better Auth hashed credential into shared staging; verification is synthetic for this reserved test identity, not mailbox ownership evidence. No plaintext password stored in repository. Temporary SQL removed. No other user credentials changed.

Initial credential issuer was incompatible with Better Auth 1.7.1; inspected installed sign-in implementation and corrected to its local credential issuer. Real localhost sign-in then succeeded. Temporarily enabled the chosen setup identity in ignored local environment/config, restarted development server, and executed the normal /setup Core command in the in-app browser. Actual D1 verification found active Global staff, 31 explicit capabilities, one immutable setup receipt and one setup audit event. Browser /admin loaded the Global Overview successfully. Temporary setup settings removed; unrelated staging config edits preserved. One restart failed because the temporary binding was duplicated as both var and secret; corrected before successful startup. Earlier read-only inspection referenced a nonexistent role-definition table; corrected to actual role schema. No application source change, deployment or email sent.

CA-7.42 complete: account creation, credential sign-in, actual Core setup transaction and Admin browser access verified. Local server remains running. Next action: owner uses the supplied credentials for Admin; runtime issue CA-7.38 and remaining commerce/provider obligations remain open. This is explicitly seeded test authentication, not real email verification acceptance.

## Latest owner request — CA-7.41 sign-out confirmation (2026-09-11)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `9c10aade`. Owner requests popup confirmation before sign-out. Account popup and account page now open a shared compact dialog with Cancel and Sign out; no sign-out request before confirmation. Existing auth client owns sign-out. Success navigates home with a full load to discard in-memory authenticated state; errors remain visible for retry. In-flight guard prevents duplicate submission and dismissal while pending. Focus starts on Cancel. Preserved unrelated work.

Verification: Web typecheck, focused oxlint/oxfmt and five AccountPopover tests passed. Tests cover open/cancel without sign-out, confirmed failure/retry availability, guest/loading/session-error behavior. Updated obsolete close-button test to Escape. In-app browser visually verified popup, then Cancel closed it without signing out. Actual successful session revocation was not performed. CA-7.41 complete. Next action: owner reviews confirmed sign-out; runtime issue CA-7.38 and earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.40 direct saved-address selection (2026-09-11)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `2d0576b4`. Owner clarifies that clicking a saved address should apply it. Removed saved-address initialization of the map editor. The saved row now calls the existing browsing-location confirmation endpoint with the stored coordinate, checks current Core serviceability, then applies the confirmed browsing location and closes. Existing unchanged-coordinate refresh suppression remains. Failed/unavailable confirmation preserves the current selection and shows a concise error; in-flight guard prevents duplicate submissions and abort on unmount prevents dismissed responses from applying. No new business API or checkout persistence rule. Preserved unrelated changes.

Verification: focused dialog tests passed (12), including direct success, unavailable coverage, request failure, duplicate-click suppression and abort/discard after dismissal. Web typecheck and focused oxlint/oxfmt passed. Actual provider confirmation and a real browsing-location change were not exercised as an incidental test. CA-7.40 implementation complete. Next action: owner clicks a saved address to review live confirmation; runtime issue CA-7.38 and earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.39 compact address controls (2026-09-11)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `4858d571`. Owner requests Foodpanda references, icon-led search/current location, less copy, removal of X and skip link. Mobbin web search returned other apps; iOS flow https://mobbin.com/flows/eaa5ce64-204d-46cc-84d2-86a84863b223 was inspected visually. Adapted its short icon/text actions; retained FreshMarkets search-first flow and existing capabilities.

Implemented compact search input with accessible hidden label and Search icon; Navigation icon for current location; MapPin with short map label; reduced pin copy and deferred a short checkout reminder until a coordinate exists. Removed X and Skip for now controls; native Escape/outside dismissal remains. Full account address editor copy remains unchanged. Authentication gating and deferred map loading retained. Preserved unrelated work.

Verification: Web typecheck and focused oxlint/oxfmt passed; 26 editor/dialog tests passed. Removed obsolete close/skip cases and updated map selector to its accessible label after its visible copy changed (initial test failed on old text). In-app browser visually verified compact layout/icons with saved addresses and no X/skip, verified Escape dismisses and reopened for owner review. No address/location write or device-location permission request performed. CA-7.39 complete. Next action: owner review; runtime issue from CA-7.38 and earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.38 address search and error diagnosis (2026-09-11)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `7ebf07b9`. Acceptance: inspect search versus map entry, eliminate known guest saved-address requests, distinguish 401 from opaque runtime errors. Preserved unrelated working-tree changes.

Address search was already rendered and real browser typing returned suggestions; provider telemetry recorded successful search and HTTP 200. Compared with the previously inspected DoorDash search-first flow. Added a clear street/address placeholder and reset the saved-address editor on dismissal so reopening begins at search without mounting the prior map. Private address reads now wait for a resolved authenticated session, with pending/error/guest states and expired-session 401 handling. Disabled speculative navigation prefetch for address management/sign-in links.

Verification on intended working-tree files: `pnpm --filter @freshmarkets/web test components/storefront/address/address-editor.test.tsx components/storefront/address/delivery-address-dialog.test.tsx` passed 28 tests; Web typecheck and focused oxlint/oxfmt passed. In-app browser verified actual typed search results, authenticated saved-address loading, map entry on choosing an existing address, and search/no map after closing and reopening. No save, location confirmation or provider mutation performed.

Runtime diagnosis: repeated internal-reference errors continued around successful requests, with no browser console errors observed. Local Miniflare 5.20260828.0-alpha still eagerly creates WebSocket RPC stubs in its remote proxy constructor. This matches Cloudflare workers-sdk issue #15351 and merged PR https://github.com/cloudflare/workers-sdk/pull/15432 (September 8), which lazily creates sessions to stop unused RPC connections for fetch-only bindings. Strong evidence for the flood, not proof for each opaque reference or the earlier native crash. The 401 instead represents Core rejecting an unauthenticated saved-address read. Runtime package upgrade and long-running runtime verification remain unperformed; no configuration or dependency change made. CA-7.38 application correction and diagnosis complete; runtime noise remains unresolved. Next action: validate a released Cloudflare runtime containing #15432 against shared-data development. Earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.37 delivery dropdown reference (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `45e46f08`. Owner approved adapting the inspected DoorDash address dropdown/editing references. Implemented a 400px viewport-clamped popup beneath Deliver to, compact existing address search, current location and manual-map entry, deferred map mounting, saved-address list and management link. Saved choices initialize the existing editor and still require current coverage/pin confirmation. Native dialog retains dismissal and focus behavior; unchanged points still avoid catalog/cart refresh. Saved addresses read once per opening with abort on close and explicit retry/error/guest states. No new provider or business authority. Preserved unrelated changes.

Verification: focused formatting/lint and Web typecheck passed. AddressEditor/dialog tests passed (24), including deferred map initialization with no requests until needed and prior dismissal/refresh/confirmation coverage. In-app browser showed 400px popup 8px below trigger, no initial map, saved-address list loaded without error; popup closed without modifying an address or browsing location. A copy assertion initially failed and was resolved by preserving the saved-checkout-address distinction in clearer copy. No actual provider mutation or mobile viewport acceptance claimed. CA-7.37 complete. Next action: owner reviews dropdown/search/pin experience; earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.36 persistent product-card plus control (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner requests normal + on product cards even when already in cart. Main at `1edaac7b`. Removed card stepper rendering; retained cart-cache synchronization so + increments the existing quantity rather than resetting it. Cart controls unchanged. Preserved unrelated work.

Verification: Web typecheck, focused lint/format and hydration regression passed. Test seeds quantity two before hydration, verifies one button and no hydration error, then confirms + sends quantity three and remains one button without extra cart reads. No live cart changes made. CA-7.36 complete. Next action: owner review on localhost; prior Phase 7 obligations remain open.

## Latest owner request — CA-7.35 repair phone save rejection (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `edf7ee5b`. Owner reports single Save rejects phone/preferences. Root cause: removing the language control also omitted preferredLanguage, which both Web and Core still require. Fixed the form to submit the existing profile language while keeping the control hidden; this supersedes CA-7.30’s incorrect omission claim. Single Save and existing retry identities retained.

Moved the unchanged Web request validator into an importable module so the form regression exercises the actual route schema. Four profile component tests passed, including normalized phone and null/non-null preserved language accepted by that validator, plus existing partial-failure retry coverage. Web typecheck and focused lint/format passed. An initial attempt to import the Worker route directly under jsdom failed virtual-module resolution; the validator test resolves this without mocking validation. No real profile write performed; actual persisted acceptance remains for owner Save. CA-7.35 fix complete. Next action: owner retries Save; earlier Phase 7 obligations remain open. Preserved unrelated work.

## Latest owner request — CA-7.34 account popup links (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `51aea8b6`. Removed All account options from the popup and added a decorative UserRound icon to Account details. Existing profile destination retained. Focused oxfmt/oxlint and diff review passed; no behavior change requiring new tests. Preserved unrelated work. CA-7.34 complete. Next action: owner review on localhost; prior Phase 7 obligations remain open.

## Latest owner request — CA-7.33 account popup controls (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `796ca3e6`. Removed the profile Back to account link, popup close X and profile chevron. Added existing Staff invitation destination to the popup and matching icons for Reset password, Staff invitation, Help and support, and Sign out. Existing popover dismissal behavior retained. Preserved unrelated work.

Verification: focused oxfmt/oxlint and Web typecheck passed; in-app popup opened and DOM inspection confirmed the four icon-bearing actions and removed controls. No sign-out or outbound action executed. CA-7.33 complete. Next action: owner review on localhost; prior Phase 7 obligations remain open.

## Latest owner request — CA-7.32 single profile Save (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `71019235`. Owner requests one Save button. Combined name, read-only email, phone and promotional preference into one form with one submit action. Name remains owned by Better Auth and contact/preferences by the existing Core command. The UI sequences writes, reports partial failure explicitly, and retains the same contact idempotency key/body on uncertain retries without repeating a confirmed name write. No atomic cross-service guarantee is claimed. Preserved unrelated changes.

Verification: Web typecheck, focused formatting/lint, and 18 tests passed, including live phone input and confirmed-name/lost-contact-response retry coverage. In-app DOM confirmed one form, one Save button and read-only email; no live profile write performed. CA-7.32 complete. Next action: owner review and save desired profile changes; prior Phase 7 obligations remain open.

## Latest owner request — CA-7.31 profile field arrangement (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `db5f14bf`. Owner requests Name and Phone Number side by side with a read-only Email input below Name. Renamed labels, added labeled read-only email from the auth session and arranged the existing independent forms in two columns with a mobile stack. No profile writes or auth changes. Preserved unrelated working-tree state.

Verification: Web typecheck and focused formatting/lint passed. In-app DOM geometry confirmed Name/Phone Number aligned, Email below Name, and email readOnly true; no field values recorded. CA-7.31 complete. Next action: owner review on localhost; earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.30 unified profile and phone formatting (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Main at `57c9ceb5`. Owner supplied exact DoorDash updating-profile flow, requested one panel and Phone formatting, clarified no SMS, then requested live spacing and removal of Preferred language. Preserve unrelated dirty state.

Mobbin MCP returned the exact supplied flow. Combined existing name and customer forms inside one account panel, retained their independent save boundaries, renamed Account phone to Phone, added partial-input +63 grouping, normalization and inline format errors. Removed language control and omitted language from updates to preserve saved values. Core already validates Philippine mobile values; no Core/auth/SMS changes.

Verification: Web typecheck, focused formatting/lint and 16 phone-format tests passed; a React DOM input-event test passed for live formatting and language removal. In-app browser confirmed one panel and language removal. Automated browser fill repeatedly produced an empty input, so browser typing acceptance remains inconclusive despite the passing React input test; test edits discarded by reload, no saved profile writes. CA-7.30 implementation complete; next action: owner verifies typing on localhost, with browser automation input behavior unresolved. Earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.29 account reference adaptation (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner requested Mobbin MCP search for DoorDash profile and Saved Stores and adaptation to account surfaces. Main at `f53357b2`; preserve unrelated dirty state. Searched and inspected DoorDash profile/manage-account flow and populated/empty Saved Stores screens. Acceptance: apply reference presentation to existing account/profile surfaces with working destinations and retained forms.

Implemented account shortcut cards, grouped settings with Sign out after Help and support, storefront-wrapped profile panels with password action, and responsive saved-address cards. Existing data reads, writes, retries and fields retained. Owner explicitly clarified to use existing features only and not implement Saved Stores. No saved-store/product capability or navigation was added; delivery addresses remain the existing feature. Updated DESIGN with references and boundary.

Verification: focused oxfmt/oxlint and Web typecheck passed. In-app account displayed four shortcuts and existing settings, profile navigation loaded both actual profile forms within the storefront shell; no horizontal overflow at 1280px. No personal details recorded or profile/address writes performed. Mobile media rules inspected; mobile and address interaction acceptance not executed. CA-7.29 existing-surface presentation complete. Saved Stores is explicitly excluded by the owner. Next action: owner review of the existing account surfaces. Earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.28 branded login presentation (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner approved the supplied Tana reference with email/password together. Main at `2fee2c7b`; preserved unrelated config, generated types, archived-document deletions and checkpoint edits. Acceptance: centered branded login card, existing Google and email/password flow, responsive width and accessible controls.

Added a page-scoped responsive layout, FreshMarkets home wordmark, external h1, shadow-free rounded card, larger controls and existing recovery/registration links. SignIn supports hiding its internal title for this page; other consumers keep their existing title. Updated DESIGN with the approved direction. No provider/backend change.

Verification: Web typecheck, focused oxfmt/oxlint passed. In-app browser refresh showed the new heading and all auth controls, a 448px card without shadow or horizontal overflow at 1220px, and retained email/current-password autocomplete. Password visibility toggled. One submit entered pending and returned to the login form; no successful authentication or required-field validation acceptance claimed. Mobile media rules inspected but no emulated mobile browser evidence. CA-7.28 presentation complete; next action: owner review on localhost and complete a real sign-in if desired. Earlier Phase 7 obligations remain open.

## Latest owner request — CA-7.27 local Google OAuth secret loading (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner supplied local Google credentials and requested continuation of setup. Main at `93b071c9`; preserve unrelated staging configuration, generated types and checkpoint edits. Acceptance: local auth initiation loads supplied credentials and constructs the localhost callback; full Google login remains separate provider acceptance.

Both Google keys were present in ignored Core .dev.vars, but local POST /api/auth/sign-in/social returned 404 PROVIDER_NOT_FOUND. Installed Wrangler filters local secrets against secrets.required; the development list omitted Google credentials, BETTER_AUTH_SECRET and AUTH_EMAIL_FROM. Added those names, regenerated binding types and updated the typed health fixture. Actual credential values remain private. Restarted pnpm dev; the same request now returns 200, accounts.google.com, a client ID matching the local file, and callback http://localhost:3000/api/auth/callback/google. No Google consent or account login completed, no deployment or outbound email.

Verification on this working-tree scope: pnpm --filter @freshmarkets/core types passed; pnpm --filter @freshmarkets/core typecheck passed after updating the fixture; pnpm --filter @freshmarkets/core test src/index.test.ts src/auth/auth-flow.integration.test.ts passed (2 files, 8 tests). First isolated type-generation attempt failed due to a temporary-script argument error; corrected generation succeeded. Staged only this config/type change, preserving existing staging edits. CA-7.27 local configuration complete. Next action: owner completes browser Google sign-in to verify Google Console callback registration and credential exchange; prior Phase 7 obligations remain open.

## Latest owner request — CA-7.26 account sign-out placement (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner requests Sign out after Help and support. Main at `c3d075b6`; preserve unrelated state. Account popover already has this order for authenticated sessions. Updated the full account page to label its existing support link Help and support, put the existing Sign out link immediately after it and disable logout-route prefetch. Existing sign-out POST/confirmation flow unchanged; no session was signed out. Focused oxfmt/oxlint and diff review passed; no runtime/authentication acceptance claimed for this label/order change. CA-7.26 complete. Next action: include this verified UI change in the next authorized Web release; earlier obligations remain open.

## Latest owner request — CA-7.25 cart drawer motion and scrolling (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner approved implementing the proposed right-side cart animation, backdrop, background scroll lock, fixed header/summary and internally scrolling item list. Observed main at `68d15325`; preserved unrelated dirty state and prior checkpoint edits. Acceptance: open/close motion, reduced-motion behavior, scroll restoration and usable cart after reopening. No commerce logic, cart quantities, provider actions or deployment changed.

Implemented a 240ms right-side slide and backdrop fade with CSS starting styles; reduced motion removes the transition/delay. Native dialog remains modal until close animation completes, including Escape/backdrop/button dismissal. Scroll locking preserves/restores root/body inline styles and compensates scrollbar width. The viewport-height drawer clips outer overflow, the item list contains overscroll, and header/summary do not shrink. Reopening cancels a pending close; checkout sign-in opens after cart closure. Updated DESIGN's marketplace guidance.

Validation on this working tree: Web tests passed **449 / 111 files** (`pnpm --filter @freshmarkets/web test`), including four drawer tests for mutation request count, normal/reduced closing scroll restoration and reopen cancellation. Web typecheck, focused oxlint, oxfmt and diff checks passed. In-app localhost showed drawer height equal to the 720px viewport, 0.24s transform transition, hidden root/body/drawer overflow, auto item-list scrolling with contained overscroll, then restored empty inline overflow/padding and focus on the cart trigger after close. Recent browser warning/error log was empty. Browser actions only opened/closed the cart; existing items were preserved. No production build or deployed/long-cart/mobile-device acceptance claimed for this small UI slice.

CA-7.25 implementation and local acceptance complete. Earlier native-runtime crash and commerce/provider acceptance obligations remain open. Concrete next action: include the verified drawer change in the next authorized Web release.

## Latest owner request — CA-7.24 refresh hydration regression (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner reports repeated localhost hydration errors after the server restart. Observed `main` at `e1b12048`; preserve unrelated dirty files and older checkpoint edits. Acceptance: identify the actual hydration mismatch, preserve saved quantities without extra requests, and verify refreshed in-app behavior. No customer cart mutation, provider confirmation, deployment or subagent used.

In-app error overlay identified AddToCartButton: server HTML contained an Add button while the first client render contained a quantity-stepper div. The header can finish fetchCart before the streamed catalog hydrates; useState read cachedCart during render. CA-7.23 streaming exposed this existing cache-dependent initializer, so its earlier browser acceptance did not cover this saved-cart timing. Changed initial quantity to deterministic zero and moved cache adoption into the existing effect, retaining change-event subscription and SKU updates. No hydration-warning suppression or extra fetch was added.

Validation against the corrected working tree: `pnpm --filter @freshmarkets/web test` passed **446 tests / 111 files**. New renderToString/hydrateRoot regression fills the cache between server render and hydration, asserts no recoverable hydration error, verifies the saved quantity appears without a request, and verifies location invalidation returns the Add control. `pnpm --filter @freshmarkets/web typecheck`, focused oxlint, oxfmt and diff checks passed. In-app first refresh rendered the saved quantity without an overlay; historic console entries were distinguished by timestamp. A subsequent attempt encountered connection refusal because vinext exited with **3221226505**, after generic remote errors and concurrent-renderer warnings. Restarted the existing pnpm dev topology without config changes; first navigation exceeded the browser tool wait but server completed HTTP 200. Fresh load and subsequent full refresh then showed the saved quantity, no hydration overlay and no warning/error entries; Abiu quick view opened successfully. No cart quantity was changed during browser verification.

CA-7.24 hydration repair complete. Remaining at this request level: separately diagnose the recurring native dev-process exit/remote-binding failure; this client-state fix does not establish its cause or resolution. Deployed acceptance remains subject to authorized release. Concrete next action: capture and isolate the native crash if it recurs, keeping the restored localhost server and unrelated workspace state intact. Earlier commerce acceptance obligations remain open.

## Latest owner request — CA-7.23 storefront loading fixes (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner: “Go fix it” following CA-7.22 audit; use only in-app browser at localhost:3000. Observed `main` at `372614dd`. Preserved unrelated configuration, documentation, counted-stock browser-test changes, protected discussion and deletions. Acceptance: defer offscreen media, remember every address dismissal, reduce redundant product/cart reads and unnecessary navigation, bound presentation-read waits, and verify regressions without changing commerce authority. No deployment, actual provider confirmation/transaction, customer cart mutation, outbound send or subagent used.

Implemented all seven audit findings in the affected source paths. ProductMedia keeps four leading catalog images eager and withholds other sources until within a 200px IntersectionObserver margin; native lazy loading alone proved insufficient for these compact rails. Image dimensions and asynchronous decoding preserve layout. Address X/Escape/backdrop/Skip all remember dismissal before unmounting. Confirming the same point does no refresh; a changed point refreshes server content and invalidates/reloads cart presentation without a document reload. Cart reads, guest transfers and quantity commands serialize; location generations suppress obsolete views and prevent queued edits from crossing a location change. Existing pending command identities and write-outcome handling remain intact. Successful quantity commands return their authoritative view to the cart page/drawer instead of repeating coverage/cart reads. Product pages render Core detail in the server response, with a streamed loading state; home streams its shell and runs independent promotion/category reads alongside location resolution. Product/search/cart presentation reads have a 15-second deadline and explicit user retry; no automatic write retries added. Catalog batches public sale rows with price/stock hydration and projects prices using unchanged promotion rules; location-aware detail is one fresh context query plus one ten-statement batch. Home category/context reads run concurrently. Quick-view context now lives in one shared non-boundary module to avoid the observed mixed provider/hook module identity pattern.

Verified final source working tree based on `372614dd`: `pnpm --filter @freshmarkets/web test` passed **445 tests / 110 files**. Added regressions cover all four address dismissal paths, same/changed point refresh, discarded stale cart reads, mutation-response reuse (exactly three requests rather than five), stalled response bodies, retry-only-on-request, HTTP/RPC error handling and image source deferral. `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/catalog/service.integration.test.ts src/orders/application/instant-commitment.integration.test.ts src/promotions/application/evaluate-checkout-promotions.integration.test.ts` passed **51 tests / 3 files** against actual disposable Worker/D1 fixtures, including product sale/stock behavior and location-aware batch shape. Workspace typecheck, lint, architecture/readiness/naming guards, intended-source formatting and diff checks passed. Both Worker builds passed (`pnpm -r build`); Web rebuilt successfully after final source fixes. Existing build notices include large chunks, unclassified dynamic routes and the Core dry-run environment notice. During implementation, two old cart-result expectations, a jsdom loading-property assertion and a retry-button edit/typecheck failure were corrected and the relevant checks rerun successfully. No full commerce aggregate or Phase 7 completion claimed.

In-app localhost acceptance: home renders/interacts after hot updates; a measured initial viewport had **36 of 89 images sourced, 53 deferred**, compared with all 89 before the visibility gate. A subsequent home navigation had 26 sourced, increasing to 31 after scrolling the Fruits rail, with zero completed-image failures. Counts depend on viewport/scroll state and are not network transfer or cold-cache measurements. X dismissal stayed closed through Abiu quick view, full-product navigation and return home. Full product details and quantity controls rendered; no customer cart or address confirmation was submitted. Recent in-app warning/error log check returned none. HTTP read probes (three each, synthetic non-customer point): anonymous Abiu **710/361/370ms**, location-aware **1002/1006/1030ms**, all 200/ok with the expected context. Location-aware median **1006ms**, versus CA-7.22's **1414ms**; small local samples are not production percentiles. Direct product HTML contained the description and variant without a client detail request.

CA-7.23 implementation and local regression acceptance complete. Remaining at this request level: deployed verification requires a separately authorized release; changed-point and authenticated-cart behavior was tested with isolated local fixtures, not actual provider/customer actions. The earlier native dev-process exit and intermittent remote-binding errors are not proven resolved by these changes. Existing earlier commerce/provider acceptance obligations remain open. Concrete next action: release the verified Core/Web changes when authorized, then repeat deployed measurements and separately reproduce any remaining remote-binding stalls.

## Latest owner request — CA-7.22 deeper storefront loading investigation (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner requests investigation of long browser loading and unnecessary calls, particularly repeated address work. Latest correction: stop browser skills/Chrome tooling; use the Codex in-app browser on `http://localhost:3000`. This correction governs further browser work. Acceptance: trace the actual caller/read path, reproduce avoidable work where possible, distinguish current local evidence from prior/deployed behavior, and record prioritized findings without claiming unimplemented improvements.

Started on `main` at `f0356750` with pre-existing catalog/geography/prefetch edits; those landed separately as `25e90ef3` during investigation. Preserved unrelated deletions, deployment/config edits, browser-test work, protected discussion and older checkpoint changes. No application edits, business writes, provider confirmations, outbound sends, deployments or subagents. Documentation scope is this new section and `docs/operations/STOREFRONT_LOADING_INVESTIGATION.md`.

Executed Node HTTP probes: localhost Abiu without a browsing point 559/402/432ms, with a synthetic sample point 1414/2172/1303ms, standalone coverage 393/423/336ms; all nine HTTP 200/ok. Location-aware delta includes additional pricing/mode/stock/sale work, not only coverage. In-app browser confirmed 81 eager product images, immediate Abiu loading UI and completed detail (server log 424ms), X dismissal reopening the address/map on full-product navigation, and explicit Skip preventing reopening on return home. Code shows remaining serial geography/catalog stages, client-only full-product fetching, five-request ordinary authenticated cart quantity-change path, full reload on location confirmation, and no application deadline on key reads. No authenticated cart mutation or actual address confirmation was tested.

Local runtime caveat: initial hydration failed with a timestamped/unversioned quick-view context mismatch despite a provider in the component stack. The original identified dev process was restarted without changing resource configuration; first restart exited 3221226505, second recovered. A media request failed after 19.7s with a remote-binding error and later succeeded; generic remote errors continued. These failure causes are not fully isolated. Existing `pnpm dev` topology is restored on port 3000. Earlier Chrome/public measurements are separated in the report and were collected before the owner's correction; no further Chrome/public browser work followed it.

CA-7.22 investigation complete; seven optimization findings plus one development-runtime follow-up remain at the finding level. No source fixes or deployment acceptance claimed. Verification: `git diff --check`, `pnpm naming:check` and report finding-count/source-path/credential-marker checks passed. No application aggregate was run for this documentation-only change. Concrete next action: repair eager offscreen image loading and consistent address dismissal, validate in-app cold/warm navigation, then reduce redundant cart/product reads and profile remaining Core stages. Earlier commerce/provider/release obligations remain below.

## Latest owner request — CA-7.21 investigate product latency (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner rejects persistent click latency and requests investigation. Observed `main` at `f0356750`; preserve unrelated changes/deletions. Acceptance for this slice: measure anonymous and location-aware detail requests, remove unnecessary database round trips while preserving fresh geography/price/stock decisions, and verify catalog correctness. No browser skills/tools or deployments authorized/performed.

Confirmed anonymous detail previously made five D1 calls in three sequential stages. Catalog hydration now sends its statements as one batch; detail uses slug-scoped subqueries to fetch product, variants, details, customer notes and gallery in one anonymous batch. Shared home/search hydration also uses a batch. Location-aware detail retains fresh location validation and current sale evaluation. Geography resolution previously awaited five dependent queries; typed subqueries now send those five reads in one Drizzle/D1 batch, preserving all market/status/effective-date/capability predicates and polygon evaluation. Product card links disable separate full-page prefetch because primary activation opens quick view instead. No caching of commerce decisions.

HTTP evidence: baseline anonymous warm requests were 691–761ms locally and 752–772ms deployed; first requests were 2927ms local and 2241ms deployed. After final catalog batching, five localhost anonymous requests returned 200/ok in 446,369,381,420,329ms. A supplied non-customer sample Cebu point produced location-aware requests of 2449/3493ms before geography batching and 1354/1270/1287/1290ms after it. Anonymous and location-aware response values matched the deployed Abiu endpoint. Timings are small samples affected by network/runtime warming, not a production percentile guarantee. A standalone remote SELECT 1 reported APAC/KIX primary, 0.1036ms SQL, zero rows written; replication is disabled. An earlier getPlatformProxy latency probe stalled establishing its session and was stopped; no result inferred from it.

Validation across this slice: 52 catalog/media/counted-stock tests, 27 geography/confirmation/admin-serviceability tests, and two new actual-D1 geography batching tests passed. Regression asserts anonymous detail uses one five-statement batch; geography uses one batch and cannot borrow another market. Final catalog integration rerun passed 17 tests after fixing the test wrapper's generic signature. All workspace typechecks, architecture/readiness guards, focused lint, naming/diff checks and both builds passed; existing build notices remain. Initial unused-spread warnings were fixed. No full commerce aggregate or browser acceptance claimed.

CA-7.21 investigation and measured query improvements are complete. Remaining performance obligations: location-aware localhost detail is still around 1.3s; deployed acceptance awaits authorized Core/Web deployment and HTTP remeasurement. Do not describe all lag as resolved. Concrete next action: deploy these verified changes when authorized, measure the resulting live path, then profile the remaining fresh location/price/sale boundaries if needed. Earlier obligations remain below.

## Latest owner request — CA-7.20 product-click latency (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner reports Abiu clicks lagging. Observed `main` at `7926cd18`; preserve unrelated changes. Acceptance: product selection opens feedback before awaiting remote details; closing/loading/error/race states remain correct. No browser skills/tools used.

Found `ProductQuickView` called showModal only after its detail fetch completed. Three command-line requests to localhost `/api/catalog/product?slug=abiu` returned 200/ok in 1110, 1463 and 1312ms against the shared remote Core resources. This was an invisible wait despite the component containing loading UI. Moved dialog opening ahead of the fetch, renders already-loaded name/photo during loading, adds loading close/status, validates HTTP/RPC success, and ignores late aborted responses. No caching of product prices/availability, business writes or API changes; the measured detail latency itself is unchanged.

Three jsdom regression tests pass: immediate open while fetch pending, visible request failure and no reopen after aborted completion. Initial harness failed because jsdom lacks native dialog methods; explicit test-only shims fixed it. Web typecheck passed. Web build passed with existing notices; focused lint, formatting, naming and diff checks passed. CA-7.20 interaction fix complete; remaining release action is authorized Web deployment, with actual browser acceptance excluded by owner preference. Next action: deploy when authorized; investigate Core/D1 query round trips separately if detail completion remains slow. Earlier obligations remain below.

## Latest owner request — CA-7.19 image caching (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner requests caching all images. Acceptance: successful public Product/promotion image reads reuse cached bytes; version changes select a new key; expiry revalidates Core; missing/error responses are not cached; static image assets have cache headers. Observed `main` at `bcb5731e`; preserve unrelated deployment/checkpoint changes and deletions. No browser skills/tools used.

Implemented a named Cloudflare Cache API cache for anonymous versioned media, five-minute browser/edge freshness, Age preservation, ETag list/weak/wildcard handling and origin fallback on cache failures. Product/promotion routes use it only after version validation. Errors retain no-store. Core publication is checked on misses/expiry; removal or promotion expiry can leave cached bytes visible up to five minutes, replacing the former every-request publication policy as part of this owner caching request. Version replacement has a distinct URL. Static category-icons/illustrations/produce/promos use one-day revalidating Workers Assets headers. Vite intentionally keeps static development files no-cache. No private/admin media policy changed; caching is populated on demand, not a preload of every image.

Evidence: nine focused helper/Product/promotion tests passed, including reuse, conditional requests, version isolation, expiry/removal and cache failures. Web typecheck, architecture/readiness guards and focused lint passed. Web build passed with existing notices. Command-line localhost media checks: first request 200/38830 bytes in 747ms, second cached 200 in 43ms, conditional request 304/zero bytes in 33ms, max-age=300 and Age observed. Built Wrangler preview on port 3013 parsed four header rules; category SVG, produce WebP and promotion PNG each returned 200/max-age=86400. Vite static responses remained no-cache as expected. These are local runtime checks, not deployed Cloudflare edge acceptance; no deployment or live business writes performed.

CA-7.19 implementation complete. Remaining at this request level: authorized Web deployment and deployed edge-cache verification. Next action: deploy the verified Web change when authorized, then verify repeated image requests by HTTP. Earlier obligations remain below.

## Latest owner request — CA-7.18 enable department availability pages (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner enables Health and Alcohol links to availability pages like Retail/Pantry. Acceptance: both sidebar entries navigate to named unavailable-yet pages with return to groceries. Observed `main` at `9360b9cc`; preserve unrelated deployment/checkpoint changes and deletions. This supersedes prior disabled-department instructions.

Implemented links and two availability pages; no catalog writes or deployments. Web typecheck, two focused navigation tests, focused lint, naming and diff checks passed. Web build passed with existing notices. Before the latest owner correction, browser checks verified Health and Alcohol pages and both enabled sidebar links at 1280x850. Owner then instructed: stop using browser skills. No browser tools were used after that instruction; honor this preference for subsequent work.

CA-7.18 source scope complete. Remaining release action at this request level: authorized Web deployment. Next action: deploy verified navigation when authorized, using non-browser verification. Earlier obligations remain below.

## Latest owner request — CA-7.17 Pantry and Meat & Seafood (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner adds Pantry and Meat & Seafood to the sidebar. Acceptance: both entries open named availability pages like Retail; Health/Alcohol remain disabled and produce shortcuts remain excluded. Observed `main` at `7e585ba8`; preserve unrelated deployment/checkpoint edits and deletions.

Implemented the two sidebar links/icons and availability pages with return to groceries; no catalog writes, auth changes or deployments. Web typecheck, two focused navigation tests and focused lint passed. Browser verified Pantry and sidebar navigation to Meat & Seafood at 1280x850; both destinations render the intended availability state. Web build, naming and diff checks passed with existing build notices. CA-7.17 source scope complete; remaining release action is authorized Web deployment. Catalog stocking is not part of this navigation request. Next action: deploy verified navigation when authorized; earlier obligations remain below.

## Latest owner request — CA-7.16 sidebar categories (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Owner initially requested produce shortcuts, then explicitly removed them: only Retail, Health and Alcohol are added to the original sidebar. Acceptance: no produce shortcuts in the sidebar; Health/Alcohol have no destination and native disabled behavior; Retail has an honest availability destination. This is the current request; earlier remaining obligations are preserved below.

Observed `main` at `ed10b60f`; preserve unrelated deletions, deployment edits and older checkpoint changes. Implemented navigation metadata, disabled sidebar controls, scrollable existing rail and a Retail availability page with return to groceries. Removed the unconditional Home highlight so category pages do not falsely mark Home active. No catalog/schema/business writes or deployment. DESIGN records this owner correction.

Verification: two focused navigation tests passed; Web typecheck and focused lint passed. Initial browser at 1280x850 showed muted native-disabled Health/Alcohol with no href and the Retail availability page. After the owner correction, produce shortcuts were removed and navigation tests/typecheck passed again. Final browser DOM confirmed Home, All groceries, Retail, Health, Alcohol, Deals, Orders and Account only; Health/Alcohol remained disabled. Web build passed with existing notices; naming/lint/diff checks passed. CA-7.16 source work complete; one remaining release action at this request's level is authorized Web deployment. Retail catalog remains unavailable. Next action: deploy verified sidebar when authorized; earlier obligations remain below.

## Latest owner request — CA-7.15 account popup (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**, owner follow-up authorizing the Mobbin DoorDash account popup for FreshMarkets. Acceptance: Account opens a contextual popup on desktop/mobile; existing destinations work; identity/loading/error states are honest; dismissal restores focus. Current task supersedes CA-7.14's next action only.

Observed `main` at `f9845d2e`; preserve unrelated deletions, deployment edits and older checkpoint changes. Inspected Mobbin Account flow `fbfed5fc-e0f2-499a-ab01-530425a50e64` and Account Settings flow `98b9ef46-4a86-4a1f-97b7-b99278c05533` inline screens: sidebar-anchored panel, profile row, grouped links/settings, profile navigation. Adapted to existing FreshMarkets destinations and tokens using the existing Radix Popover primitive. Desktop sidebar/mobile Account now open the popup; no header shortcut restored. Core writes and auth implementations are unchanged.

Verification: four jsdom interaction tests pass for guest open/close/focus, authenticated identity/sign-out link, loading and error/retry; authenticated state uses a test fixture, not a live customer session. Web typecheck and focused lint passed after correcting the test's DOM append method for Worker/DOM typing compatibility. Browser at localhost with shared data: popup inspected at 390x844 and 1280x850; Escape closed it and returned focus to Account; Account details navigated to existing profile route. No live account writes or outbound sends. `pnpm --filter @freshmarkets/web build` passed with existing chunk-size/classification notices; focused formatting, naming and diff checks passed.

CA-7.15 source implementation complete; one remaining release action at this request's level is Web deployment. Concrete next action: deploy the verified popup when authorized. Earlier Google configuration, Farm eggs image and phase/provider obligations remain open.

## Latest owner request — CA-7.14 shared localhost resources (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**, owner follow-up to use freshmarkets.ph's Wrangler variables/resources for `pnpm dev`. Acceptance: local Web/Core source reloads with the deployed catalog and R2 images; browser auth stays localhost; secrets remain private; deployments and isolated test/build configuration remain unaffected. This supersedes the prior next action for the current task only.

Observed `main` at `fb303b59`. Preserve unrelated deletions, protected discussion, prior deployment type/secret changes and older checkpoint edits. Commit scope: Vite dev configuration, README, ARCHITECTURE, this new section and the already-provisioned staging D1 ID correction needed by this configuration. No migrations, live business writes, provider sends or deployments were performed for CA-7.14.

Implemented: default `pnpm dev` loads both staging variable sets, overrides browser/auth origins to localhost, and runs local Web/Core with remote staging D1, R2 and EMAIL. A new private random localhost signing secret was saved only in ignored Core `.dev.vars`; startup rejects a missing, short or known development fallback key. Deployed secrets cannot be downloaded; existing local provider credentials are used, but Google credentials are absent and Google login is not accepted. `FRESHMARKETS_DEV_DATA=local` retains isolated storage; builds and explicit `CLOUDFLARE_ENV` selections retain their configuration.

Runtime findings: returning binding arrays from the Vite customizer appended old local bindings; replacing arrays in place fixes this. Remote Queue binding caused Cloudflare 1105 even with EMAIL local. D1/R2/EMAIL remote with Queue removed works. Local Core therefore has no queue bindings or scheduled triggers; ordinary commands persist shared notification outbox intent and deployed Core remains responsible for scheduled publication/delivery. No simulated Queue success or email fallback is configured. Actual email/payment/OAuth delivery was not exercised.

Verification on this working tree: `pnpm typecheck` passed all workspaces; `pnpm architecture:check`, `pnpm readiness:check`, `pnpm naming:check`, focused oxlint/oxfmt and `git diff --check` passed. `pnpm --filter @freshmarkets/web check:vinext` reported 15 supported/0 issues. `pnpm -r build` passed Core dry-run and Web build, retaining existing build notices. Focused Web runtime/auth-proxy tests passed 13; Core runtime tests passed 17. Actual localhost HTTP checks: homepage 200, Core health 200, anonymous auth session 200/null, Zucchini media 200/image-webp with SHA256 identical to uploaded source. Browser showed catalog/photos and no header Account shortcut (81 media images in DOM; 39 loaded at inspection, others lazy). Live-data writes and full commerce/provider journeys remain untested.

CA-7.14 shared-data dev setup is complete; dev server remains on port 3000. Remaining at this request's level: Google credentials/callback configuration for localhost and actual provider acceptance. Concrete next action: supply Google OAuth values in ignored Core `.dev.vars` and authorize localhost callback in Google configuration if Google login is needed. Earlier Farm eggs, header deployment and phase/provider obligations remain below.

## Latest owner requests — CA-7.12 images and CA-7.13 header (2026-09-10)

Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**, deployed storefront/media acceptance. The owner authorizes programmatic upload of the 226 matching produce images, followed by Mobbin research of DoorDash's account flow and removal of the account icon beside the cart. These requests supersede the older diagnostic/reset next actions below. Acceptance: R2-backed images linked through D1 and verified publicly; header shortcut removed while Account remains reachable through existing navigation. No additional account redesign is requested.

Observed `main` at `07cc8940`. Preserve the existing deployment/config/checkpoint edits, unrelated deletions and protected discussion. No Worker deployment or commerce/provider transaction was performed in these tasks. New verified scope: Core seed importer, its five tests, seven-line Web header removal, DESIGN reference note and this checkpoint section. The earlier deployment edits below remain uncommitted and excluded.

### CA-7.12 — complete live image import

Target: D1 `freshmarkets-core-staging` (`48aaa957-2be1-4883-9998-5321a49d2825`) and R2 `freshmarkets-product-media-staging`. Initial diagnosis: 227 products, zero media records/objects; 226 exact, unique local asset matches, with Farm eggs lacking an image. Files were already available statically, but the current storefront uses versioned Core media URLs.

`apps/core/scripts/import-produce-media.mjs` is bounded offline seed tooling, authenticated using existing Cloudflare operator credentials and exact resource checks. No fabricated staff session or public endpoint. It preserves existing photos, creates durable per-product intent before create-only R2 storage, and atomically commits media, Product version, audit and frozen receipt. Four independent products overlap network I/O; failure stops new dispatch and awaits in-flight operations. Normal Admin CRUD remains unchanged.

Actual execution: `node apps/core/scripts/import-produce-media.mjs --apply --verify --first` published Abiu and passed public byte verification. The initial serial run was stopped and safely resumed with bounded concurrency. `node apps/core/scripts/import-produce-media.mjs --apply --verify` published all 226 and verified the first 225 public images before a final TypeError interrupted verification (exit 1, not a clean full-command pass). A separate read of Zucchini's recorded public URL returned HTTP 200/image-webp with SHA256 identical to its local source. Thus all 226 images have executed public byte verification. Wrangler emitted intermittent internal-reference errors; final receipt and HTTP evidence determines acceptance.

Final remote Wrangler D1 SELECTs: 226 active media records for 226 distinct Products, 226 ATTACHED upload intents, 226 SUCCEEDED receipts in `catalog.seed.produce-media.v1`, and 226 `CATALOG.PRODUCE_MEDIA_IMPORTED` audit events. No duplicate image publications. Live browser screenshot showed imported photos rendering. Every public image remains served through `/media/products/{id}/{version}` by Core reading R2, not a static-file fallback. Farm eggs alone remains without a supplied image; visual subject accuracy of the original files was not independently reviewed.

Local checks: five Node/SQLite tests against all 95 actual migrations pass (replay, unknown storage outcome, concurrent Product edit, existing-image preservation, audit rollback); `pnpm harness:test` passed 31 tests; architecture/naming and focused format/lint checks passed. Initial test migration application lacked per-migration transactions and failed foreign keys; the fixture was corrected without changing migrations. No full commerce aggregate was rerun for this bounded operational import.

### CA-7.13 — complete source change, not deployed

Mobbin MCP returned DoorDash web Account, Account Settings, Managing an account and Profile flows. Inspected the inline reference screens: Account sits in the left navigation and opens its menu/settings; no account shortcut beside the header cart. Source reference: https://mobbin.com/flows/fbfed5fc-e0f2-499a-ab01-530425a50e64. Removed only the duplicate header link in `apps/web/components/storefront/storefront-shell.tsx`; desktop sidebar/mobile bottom Account remain. DESIGN records the owner correction and reference boundary; no DoorDash assets or extra account features were copied.

`pnpm --filter @freshmarkets/web typecheck`, focused formatting and `pnpm --filter @freshmarkets/web build` passed. Build retains chunk-size/static-route-classification notices. Local two-Worker browser check on port 3012: the existing local homepage database is outdated (missing promotion_media and stock_pool_id), so homepage acceptance is not claimed and local data was not changed. The shared header was instead inspected on the rendered cart at 1280x850 and 390x844: zero header Account links, cart present, desktop sidebar/mobile bottom Account visible. Existing choose-location cart feedback remains. Preview viewport was reset and tab closed.

Completed task IDs: CA-7.12 live media import and CA-7.13 source/header verification. Remaining at these requests' level: one unsupplied Farm eggs image and one Web deployment to publish the header change. Earlier phase/provider obligations remain below. Concrete next action: publish the verified header change when Web deployment is authorized; use normal Admin upload for a subsequently supplied eggs image.

Updated: 2026-09-10. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-7.11 — Clean staging deployment to freshmarkets.ph** is the sole active slice. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete journeys and activation evidence**, deployment/environment acceptance.

Owner explicitly authorizes deploying all current work to `freshmarkets.ph` and deleting previous-version FreshMarkets data without preserving it. This supersedes the earlier retained-staging/backup/cutover restriction for the exact FreshMarkets resources below. Preserve service credentials needed for the current deployment and unrelated projects/repository changes. No payment, refund, courier booking or unrelated outbound message is part of this reset.

Acceptance: current Core/Web deployed to existing staging Worker names and `freshmarkets.ph`; clean D1 at all 95 migrations with no old accounts/orders/payments; empty prior uploaded media and no stale FreshMarkets queued work; native email and existing Mapbox/auth/payment credentials configured; live health/readiness, public storefront and auth/setup boundaries verified; prior D1 copies/private exports removed as authorized. Actual paid/courier and owner sign-in/setup observations remain distinct acceptance.
Owner correction, 2026-09-10: defer the customer-facing account-closure option. Its uncommitted Core/contracts/Web draft was removed; no migration/data changes occurred. Existing staff closure and retained history remain. PRODUCT, plan section E and guidance audit preserve this deferral. Support destination supplied by owner: support@freshmarkets.ph.
All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD and origin/main `cb693e60` at CA-7.11 start. CA-7.10 setup was based on `db56b5b3`; prior CA-7.9 tested base was `dad5de26` plus its committed 39-file scope. Preserve all excluded owner changes.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- CA-7.11 reset scope: remote D1 `freshmarkets-core-staging` (`989a3663-0d73-4f58-a58d-012ab02843a5`) and obsolete copy `freshmarkets-core-acceptance` (`29e5e67b-37f6-427b-966f-e0e3564e6567`); R2 objects in `freshmarkets-product-media-staging`; only FreshMarkets staging queues if present; prior private copy directory `C:/Users/reggi/.codex/private/freshmarkets-ca710`. Workers are `freshmarkets-core-staging` and `freshmarkets-web-staging`, with verified Web -> Core/D1/R2 bindings. Account `120b2ec8b5b4a99351d860d22cf51243`. Other Cloudflare projects and repository changes remain excluded. No reset of unrelated local state; no subagents.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

CA-7.11: staging types, migrations, architecture/readiness checks, Core dry run, staging Web build and vinext passed; 18 focused Core readiness/initial-admin tests passed. Created the two required FreshMarkets staging notification queues. Deleted the old staging D1 and obsolete remote acceptance copy under the new authorization. New clean `freshmarkets-core-staging` ID `48aaa957-2be1-4883-9998-5321a49d2825` has all 95 migrations applied. R2 reset via a remote binding verified `freshmarkets-product-media-staging` empty (0 old objects). Configured the verified owner identity for one-use administrator setup and the proven email sender as staging secrets; existing service secrets retained. Current Core/Web deployment command session37083 is running; verify its result and live site before claiming completion. No live payment/refund/courier operation executed.

Actual blockers: Cloudflare zone ruleset inspection returned HTTP 403/code 10000 for the current Wrangler identity; WAF/rate-limit verification is not claimed. Automatic approval review rejected both recursive and narrower exact-file deletion of `C:/Users/reggi/.codex/private/freshmarkets-ca710` with only “blocked by policy”; its four private copy files remain locally. No alternative deletion mechanism attempted. This does not block the authorized remote deployment/reset.

Prior CA-7.10 evidence below is historical; its retained-data restriction is superseded by the owner-authorized CA-7.11 reset above.

CA-7.10: actual Mapbox v6 temporary forward and permanent reverse requests using Core `.dev.vars` both returned HTTP 200 with usable address results; no token/address payload logged or persisted. Wrangler 4.127.1 enabled Email Sending for `freshmarkets.ph`; public DNS-over-HTTPS confirms bounce MX/SPF, DKIM and DMARC. Existing Core EMAIL implementation is retained; `AUTH_EMAIL_FROM=no-reply@freshmarkets.ph` was appended to the ignored local `.dev.vars` without changing credentials. Owner supplied a controlled recipient and explicitly authorized one test message. Wrangler `email sending send` completed with exit 0 and `Queued for` that redacted recipient. Exactly one message submitted; no retry. The owner then provided the received message showing it in their Inbox, confirming actual receipt from the configured FreshMarkets sender. No Worker deployed; this is provider-send acceptance, not a deployed auth/reset journey.

Chosen D1 target: isolated `freshmarkets-core-acceptance` (`29e5e67b-37f6-427b-966f-e0e3564e6567`, APAC); no Worker is bound to it. Existing staging (`989a3663-0d73-4f58-a58d-012ab02843a5`) has active writes and retained records, so it remains unchanged at 0055. Protected export/config files are under `C:/Users/reggi/.codex/private/freshmarkets-ca710`, outside Git; never print or commit their data. Original snapshot `staging-0055-20260910.sql` SHA256 `2C18F1431A4379E48430B0C58C0FDB280F0FC1917862C6400F6B37C3FD7097AD`. Initial raw import failed with missing parent table; schema-first import failed with a foreign-key constraint. Both rolled back. Parent-first import preserves every SQL statement, passes immediate foreign-key enforcement locally, and imported successfully into remote acceptance. All 40 migrations 0056–0095 applied successfully, with 95 migration records now present. Read-only remote counts still match the snapshot (9 customers/addresses, 18 order items, 13 payment intents, 3 payment refunds, 1 staff identity, 227 products); foreign-key checks and individual quick checks on all 159 tables pass. The whole-database quick check fails with Cloudflare `SQLITE_NOMEM`; do not report it as passed. This is a verified remote upgrade rehearsal, not cutover/deployed-application acceptance. No application source changed. All owned commands finished; no local Worker stack is running.

Prior completed CA-7.9 acceptance:

CA-7.9 completes current storefront/account/Admin acceptance and removes stale minimum-order copy. The lazy geocoder factory is an instance function, internal to Worker RPC; the strict contract-conformance guard remains unchanged. No schema or public contract changed. Verified scope: 13 Core/Web source/test files, 19 reviewed visual baselines, Product/API/Data/plan/guidance-audit updates and this checkpoint/history (39 files). No unfinished CA-7.9 implementation files remain after this commit; excluded owner changes above remain untouched.

Final local evidence: 60 focused Core tests/4 files for the geocoder correction; 27 storefront/account/Admin/reconciliation browser cases; two Scheduled paid-addition/changeover/fulfillment journeys; four permanent-location/carryover/customer-support cases; one connected Admin-site/customer-confirmation journey; three Admin visual cases across 1440x1200, 1024x1366 and 390x844. These total 37 browser cases. The 19 changed PNGs were inspected; the visual suite then passed without snapshot updates. Visual fixtures establish presentation, not real provider/financial success.

**Final aggregate96327 passed, exit 0**, `ca79-aggregate-final.log`, against `dad5de26` plus the complete CA-7.9 application/test scope: 1675 Core tests/199 files, 418 Web/103, 68 contracts/19, six shared-package tests and 26 harness tests; all root static/schema/type/catalog checks, both builds and vinext (15 supported/0 issues). Worker binding freshness and local readiness checks also passed. Guidance preservation verified 27 archived hashes, all 21 decision mappings, A–I/eight phases/five final journeys and 92 active local links. Exact commands, intermediate failures and fixes are recorded once in history. All owned browser stacks and verification processes are stopped; no application changes followed the final gate.

## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** still need external acceptance, alongside the earlier retained-environment/identity checks below. Local implementation is complete through CA-7.9; CA-7.10 environment setup/verification is complete with the limits above; CA-7.11 clean deployment is active. Customer self-service closure is owner-deferred.

| ID                  | Current acceptance and remaining obligation                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-0-2              | Local setup/scope/recovery evidence remains below. CA-7.10 rehearsed all pending migrations on an isolated remote copy of actual staging records, preserving checked counts and passing foreign-key/per-table integrity checks. Original staging remains at 0055; whole-database quick check, eventual cutover and pre-fix provider-address retention review remain open. Actual owner identity/email/OAuth acceptance remains a release input. |
| CA-7.9              | Locally complete: final aggregate, connected journeys, current visual acceptance and documentation/preservation verification passed. External acceptance remains assigned to CA-0-2/6/7 below.                                                                                                                                                                                                                                                  |
| CA-7.11             | Active: prepare staging build/config, reset the identified old FreshMarkets data, deploy both Workers and verify the live site.                                                                                                                                                                                                                                                                                                                 |
| CA-7.10             | Actual Mapbox temporary/permanent requests passed; email domain/DNS/local sender configured; isolated D1 upgrade through 0095 verified with the limits above. Cloudflare accepted the single authorized email test and the owner confirmed it reached their Inbox. CA-7.10 is complete; deployed auth/reset/OAuth and release acceptance remain under CA-7.                                                                                     |
| CA-6                | Local preparation/automatic booking, normalized events/recovery, immutable promises/charge, Scheduled-only manual and membership retirement covered. Actual Lalamove sandbox/account operations and provider-event acceptance remain open.                                                                                                                                                                                                      |
| CA-7                | Local customer/operator/support/refund/reorder/report/notification/recovery journeys covered. Actual Mapbox permanent request acceptance is now demonstrated by CA-7.10. Actual PayMongo payment/refund, deployed auth/reset email and OAuth, retained-address review, deployment and a clean setup-to-delivery demonstration on the owner-configured target remain open.                                                                       |
| Approved follow-ups | D01/D21: CA-7.2–8; D03/D10: delivery milestones and Instant/Scheduled journeys; D05: CA-3.3; D06–07/D08: CA-3.4 and small-cart checkout; D11/D13: Problems and CA-7.1; D14/D17–18: CA-4/5; D15: CA-7.9 outstanding Scheduled goods after paused Instant changeover. Their actual provider/release limits remain assigned above.                                                                                                                 |

### Plan coverage and earlier acceptance gaps

This maps every section of `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`; evidence remains local unless explicitly stated. Prior accepted revisions are retained in the completed-slice table/history, not relabeled as fresh browser runs.

| Section / phase             | Concrete local evidence and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A / 0–2 setup               | Location/service-area/pickup/schedule/cycle Worker suites; prior location, service-area, hours, pickup and cycle browser acceptance; CA-7.9 creates/activates a new site through Admin, configures pickup/hours/polygon/readiness and confirms the customer's exact assigned site. `customer-site-setup.integration.test.ts` additionally connects new-site cycle, confirmed address and explicit staff scope without business SQL. Synthetic operational values only.                                                      |
| B / 3 media/catalog         | CA-3.1–3.3: Global catalog/category/variant CRUD, anonymous R2 publication/replacement/removal/deactivation and five-image gallery; permission/invalid-upload/metadata and object-recovery tests. Dedicated product/promotion media browser evidence remains in history.                                                                                                                                                                                                                                                    |
| C / 3 prices/promotions     | CA-3.2/a–d and CA-3.4: exact-location Global price authority, local selling/read-only prices, immutable paid terms, sale/code/delivery allocation, overlap/usage/allowance/eligible-cancellation recovery; real local paid-sale browser journey.                                                                                                                                                                                                                                                                            |
| D / 4 physical goods        | CA-4/4.1–3: 100000 -> 60000/20000/20000 conservation, holds/reservations, concurrent transfer claims, scoped partial receipt, damage/missing/loss/inspected return and actual counts. Worker/D1 and prior transfer/count browser evidence; no new route/forecasting feature.                                                                                                                                                                                                                                                |
| E / 2,6,7 identity/customer | Prior initial administrator, staff/customer invitation/access/closure Worker/browser acceptance; CA-7.6–8 account/profile/address/access/contact; CA-7.9 customer-support exact retry and actual membership retirement. Valid reset-token/reuse/password behavior executes in Core; browser covers request/error/logout. Deployed auth/reset email, Google OAuth and actual initial-owner setup remain external; CA-7.10 separately verifies direct-provider test inbox receipt. Customer self-service closure is deferred. |
| F / 1,7 checkout/money      | Guarded commitment, full hold sets, distinct ledger identities, canonical event replay/recovery and coordinated refund suites; CA-7.2–4 cart/reorder/paid conversion; actual local Instant/Scheduled signed test-provider journeys, immutable paid Instant items, additions/cutoff, partial cancellation/refunds and provisional summary. No live payment/refund or official invoice acceptance.                                                                                                                            |
| G / 5 Scheduled             | CA-5.1–9: configured week, exact original/addition paid demand, pending-payment purchase gate, consolidated destination totals, actual receiving/counts, replacement/shortage financial resolution, cycle packing and inspected surplus. CA-7.9 completes outstanding Scheduled goods while new commerce is paused in Instant.                                                                                                                                                                                              |
| H / 6 delivery              | Existing Instant automatic readiness booking, Scheduled future pickup/manual fallback, packed handover, signed local courier observations, rematch/old-event/unknown/cancel recovery, revised promise and inspected-return/customer agreement; missed delivery does not automatically refund. Full-order grams and actual-versus-accepted costs tested. Test adapters are not provider acceptance.                                                                                                                          |
| I / 7 operations/release    | Durable outbox/Queue/retry/DLQ Worker tests, Problems workflow, CA-7.1 reports/scopes/dates, redacted telemetry and fail-closed environment checks; CA-7.9 current Admin visual archetypes. Actual provider delivery, edge/deployment configuration and real staffed operations remain unaccepted.                                                                                                                                                                                                                          |

All 12 original audit findings remain accounted for: (1) multi-pool keys, (2) packing/cancellation/consumption, (4) delivered-work/retired capacity, (5) missing holds and (7) held adjustments/release ledger are covered by `instant-commitment.integration.test.ts` and associated inventory/cancellation suites. (3) courier cancellation, (10) booking prerequisites and (11) searching/webhook/refresh/inbox normalization are covered by delivery application/HTTP/operations suites and signed browser events. (6) rejected receiving, (8) reachable purchasing and (9) cycle-versus-physical goods are covered by procurement/receiving/surplus Worker suites and CA-5.9/CA-7.9 connected journeys. (12) warehouse/readiness, pickup-versus-arrival and full-order shipping constraints are covered by setup/delivery suites and both customer modes. Actual provider constraints remain in the external gate.

Final journeys 1–2 map to F/G/H, journey 3 to G/H, journey 4 to F/G/H/I, and journey 5 to the current scoped Core tests across A–I. Phase 0 guidance/schema and Phase 1 recovery are not reopened from the historical starting assessment. Clean schema/representative retained upgrades are tested locally; CA-7.10 adds the isolated actual-staging-copy remote rehearsal above. The original shared deployment remains protected and unaccepted for the new release.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs                                                | Result / commit                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA-7.10                                            | Actual Mapbox temporary/permanent API acceptance; Cloudflare sending/DNS and owner-confirmed inbox delivery; remote retained-data copy upgraded 0055–0095 with checked counts preserved, foreign-key and 159 per-table checks passed. Whole-database quick check remains limited by provider memory. Setup evidence `ebd248a6`; receipt evidence accompanies this record. |
| CA-7.9                                             | Locally complete in the commit accompanying this record; aggregate 1675 Core/199, 418 Web/103, 68 contracts/19, six shared tests and 26 harness tests; 37 browser cases, static/schema/type checks, builds/vinext and preservation checks. Tested base/scope above; exact commands in history.                                                                            |
| CA-7.8                                             | Account recovery/contact/sign-out accepted at dad5de26; auth 5/1, static/types/build, both browser widths. Customer closure deferred by owner.                                                                                                                                                                                                                            |
| CA-7.7                                             | Address create/edit safeguards locally accepted at 4ba6f214; 41 Core/26 Web/68 contracts, runtime checks/builds and both exact-retry browser widths.                                                                                                                                                                                                                      |
| CA-7.6                                             | Account name/phone/default address/removal locally accepted at 99e97b96. Schema/133 Core/25 Web/68 contracts, final 112 Core, runtime checks/builds and both browser widths; older create/edit gap assigned CA-7.7.                                                                                                                                                       |
| CA-7.5                                             | Permanent browsing confirmation locally accepted at 9decade6; Core 74/5, Web 35/4, contracts 68/19, runtime checks/builds/vinext and both browser widths. Closes local CA-7.3 retention gap; actual provider acceptance remains open.                                                                                                                                     |
| CA-7.4                                             | Paid-Cart lifecycle locally accepted at c435d720; aggregate, 64/3 focused Core and four browser journeys passed.                                                                                                                                                                                                                                                          |
| CA-7.3                                             | First-visit location/guest carryover locally verified at 701b587d; aggregate and six browser journeys passed. Provider-result retention implementation corrected and locally accepted in CA-7.5; actual provider acceptance remains open.                                                                                                                                 |
| CA-7.2                                             | Cart names/current-price Buy again locally accepted at 43f7a7e6; Core 8/2, Web typecheck and both real local browser widths passed.                                                                                                                                                                                                                                       |
| CA-7.1                                             | Approved commerce reports locally accepted at e54d0cb3; aggregate plus final focused 45/4, three Admin browser tests and two real local desktop/mobile journeys. Exact evidence in history.                                                                                                                                                                               |
| CA-3.4                                             | Selected-item sales/allowance/stacking locally accepted; 9dd13ed1. Aggregate 1639 Core/196, 402 Web/101, 68 contracts/19; final Core 71/4 and both desktop/mobile paid-sale cancellation journeys passed.                                                                                                                                                                 |
| CA-3.3                                             | Five-image Add/Edit/replacement/gallery locally accepted; e3d4180a. Aggregate 1635 Core/196, 402 Web/101, 68 contracts/19; focused Core 31/2 and both desktop/mobile galleries passed.                                                                                                                                                                                    |
| CA-5, CA-5.9                                       | Section G local acceptance completed through CA-5.1–5.9; final connected customer journey and aggregate pushed as `9138860b`. Provider/delivery and newer approved product obligations remain open above.                                                                                                                                                                 |
| GD-1                                               | Guidance consolidation and approved decisions; pushed `83854bd`.                                                                                                                                                                                                                                                                                                          |
| CA-3.1, CA-3.2, CA-3.2a, CA-3.2b, CA-3.2c, CA-3.2d | Phase 3 local gate completed; final aggregate and 28-browser matrix at `0d14da0`, evidence `ab276df`. Children include `60f348d`, `092a0ad`, `0d14da0`. New owner-approved product changes above remain separate obligations.                                                                                                                                             |
| CA-4, CA-4.1, CA-4.2, CA-4.3                       | Stock/transfers/discrepancies/counts locally verified; CA-4.2 `406a405`, CA-4.3 `010b8af2`.                                                                                                                                                                                                                                                                               |
| CA-5.1                                             | Delivery-week workspace and exact purchase: `e6afa560`.                                                                                                                                                                                                                                                                                                                   |
| CA-5.2                                             | Shortage/replacement receiving: `2f11e609`.                                                                                                                                                                                                                                                                                                                               |
| CA-5.3                                             | Scheduled receipt weight and actual size counts: `61d1299b`.                                                                                                                                                                                                                                                                                                              |
| CA-5.4                                             | Inspected surplus: `c0e7ed7c`.                                                                                                                                                                                                                                                                                                                                            |
| CA-5.5                                             | Late-payment purchase readiness: `bad66079`.                                                                                                                                                                                                                                                                                                                              |
| CA-5.6                                             | Consolidated destination purchase totals: `49d75d3a`.                                                                                                                                                                                                                                                                                                                     |
| CA-5.7                                             | Shortage-linked Order review/cancellation: `75e2105b`.                                                                                                                                                                                                                                                                                                                    |
| CA-5.8                                             | Audited supplier-exception resolution after cancellation: `19f409a1`. Aggregate **1577 Core/194 files, 403 Web/101, 68 contracts/19**, shared/harness/migrations/static checks/both builds; 2 browser journeys; vinext 15 supported/0 issues. Original browser financial state was synthetic, so it does not close CA-5.9.                                                |

Older implementation anchors `b8e32b2`, `f7f17dc`, `d14de2c`, `762a18e`, `f6f8c88`, `e50ef9a`, `012b5db` and their evidence remain in history. Their absence from active instructions is not permission to rebuild them.

## External blockers and one next action

Clean FreshMarkets deployment/reset is explicitly authorized; no additional approval is needed for its named resources. Payment/courier sandbox transactions, real pickup/service/hour/promise/catalog/accounting values and owner OAuth/setup observations remain separate release inputs. Customer self-service closure remains deferred. The old pre-launch data is explicitly disposable for this reset; normal future commerce records retain the approved retention policy.

**One next action:** finish staging configuration/build verification, reset the exact named D1/media resources, deploy Core/Web and verify `freshmarkets.ph`. Record the new D1 and Worker versions and actual public checks. Do not apply the obsolete retained-copy migration/cutover plan.
