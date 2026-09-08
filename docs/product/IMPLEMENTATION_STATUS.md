# FreshMarkets Implementation Status

2026-09-08 fulfillment continuation: reachable fulfillment commands now atomically guard current IAM, claim, order/stock/fulfillment effects, audit and frozen replay results. Focused Worker and Web adapter checks, types/lint and Core dry-run build pass; this is an additional Phase 1 repair, not complete phase acceptance.

2026-09-08 commerce continuation: location address permanent finalization, Global versioned service-area editor/preview and atomic geography routing safeguards are implemented. Aggregate checks passed (890 Core, 367 Web, 68 contracts); later focused guards and four real local Web/Core/D1 browser cases passed. Details and remaining setup/operational work are in docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md. No commerce phase is accepted; live provider acceptance and retained-environment upgrades were not executed.

Location setup milestone, 2026-09-07: Global location list/create/details/activation/deactivation and explicit warehouse purpose are implemented with guarded Core effects, audit/replay and a responsive Web workspace. Actual local Web/Core/D1 browser flows pass at 1440px and 390px using a new disposable E2E state directory. Aggregate checks passed (874 Core, 364 Web, 68 contracts); final additional origin/quote/deactivation checks passed 16 focused Worker tests, workspace types/lint, Core build and 26 harness tests. Map/provider address finalization, serviceability authoring/readiness and cycle setup are still incomplete; no phase acceptance or provider acceptance is claimed.

Commerce continuation, 2026-09-07: selling-state/mode commands now atomically persist configuration, quote invalidation, audit and replay evidence, with current IAM/readiness/committed-work guards. Focused Worker suites pass 21 tests; Core types, lint, architecture/readiness and naming checks pass. Full phase acceptance and location setup remain open. See COMMERCE_ALIGNMENT_EXECUTION checkpoint.

## Commerce alignment execution — 2026-09-07

**Global price-authority slice (following `e95e0e5`):** Migration 0070 defines prices.read/manage without automatic grants. Global Product detail now provides an exact-location price editor and bounded version history; local Product detail retains selling controls and read-only prices. Core validates the dedicated Global authority and rechecks it with active target/currency in the complete price batch. Twenty focused Worker/D1 tests pass, including revoked-scope/deactivated-target rollback, local and capability rejection, exact missing-price behavior, replay and competing writes. New UI recovery tests and existing adapter tests pass; two executed desktop/mobile browser cases use controlled RPC responses and are not live D1 acceptance. Migration/verifier, harness, types/lint, vinext and catalog checks pass. Final aggregate `pnpm check` passed: 861 Core tests, 362 Web tests, shared/contract/harness suites and both builds. Final focused Core/Web tests, workspace types/lint and desktop/mobile Global-editor/local-read-only browser cases passed after cleanup. The temporary browser server was stopped. This does not accept the complete setup, catalog or commerce phases.

**Resumed from `619df3c`, initially clean working tree:** Scheduled quote creation, pre-payment revalidation, compatibility eligibility and paid commitment no longer consult membership. A Worker/D1 regression reaches quote -> payment initiation/replay -> test-provider reconciliation -> exact paid demand/commitment/replay with no subscription and zero physical stock. It asserts no pre-confirmation Order, unchanged stock and one demand effect. Existing commitment/promotion failure and race tests now run without subscription fixtures. Focused results: 30 checkout/commitment tests, then all 16 commitment tests after strengthening payment reachability; Core types/lint and 15 Web checkout/adapter tests passed. Aggregate `pnpm check` passed: 857 Core tests, 360 Web tests, 68 contract tests, shared/harness suites, conventions, migrations, lint/types and both builds. No browser/provider acceptance is inferred. Active enrollment/jobs and broader phase acceptance remain pending. Recovery: [execution checkpoint](../operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).

The owner authorized all phases of `COMMERCE_ALIGNMENT_E2E_PLAN.md`. Work is on `main`; existing uncommitted documentation edits are preserved. No deployment, persistent database reset, live payment or live booking has been performed. The 2026-09-06 reports below remain historical evidence.

The owner additionally authorized committing and pushing each verified slice before continuing. The initial correctness/documentation slice is committed and pushed as `6c11b2f`; this is not acceptance of all Phase 1 work.

**Next Phase 1 slice — shared delivery observations:** Webhook, Admin refresh/confirmed cancellation and scheduled local inbox recovery now use `applyProviderObservation`. Admin observation evidence is persisted before application; its immediate application, command result and audit share the guarded transaction. Regressions and terminal conflicts remain reconciliation-required, including conflicting terminal events at the same timestamp. Migration `0066_delivery_observation_recovery.sql` adds bounded recovery metadata, with a populated 0065 upgrade assertion. The registered job replays at most 25 observations per run, at most five automatic attempts each, without courier API calls. Focused webhook/Admin/scheduler tests and Core types/lint passed. The frozen-source aggregate `pnpm check` passed: 827 Core, 355 Web and 74 shared-package tests, conventions, migration verification, lint/types and both builds. No browser or provider sandbox acceptance is implied. The following command-recovery slice handles cancellation intent and interrupted Admin results; provider lookup/replacement and distinct searching/attempt state remain open.

**Verified Phase 1 slice � provider command recovery:** Migration `0067_delivery_provider_command_recovery.sql` adds the authorized command journal and a partial unique pending-cancellation constraint. Core persists cancellation uncertainty before submission, rejects simultaneous or fresh-key resubmission, and completes the original idempotency result/audit from confirmed provider evidence. An interrupted refresh application recovers without another provider GET; stale unobserved refresh reads can be reclaimed after five minutes, while cancellation uncertainty cannot. Admin offers refresh and labels pending confirmation instead of offering another cancel. Worker tests cover returned/thrown timeout, concurrent cancellation, confirmation/replay, local projection failure, and original audit/result recovery. `pnpm check` passed with 830 Core, 355 Web and 74 shared-package tests, migration verification, conventions, lint/types and both builds. This remains part of Phase 1, not release/provider/browser acceptance.

**Phase 1 identity-recovery slice:** Admin can submit a provider order number for an uncertain booking with no saved identity. Core retrieves and verifies merchant metadata, preserves scope/version guards, and atomically records the association, original booking result, audit and observation. Worker/D1 tests cover mismatches, authorization, injected audit failure/rollback, competing recovery and original booking replay without another create. Web adapter validation passed. The frozen-source `pnpm check` passed with 831 Core, 356 Web and 74 shared-package tests, conventions, migration verification, lint/types and both builds. This is not provider sandbox or browser acceptance.

**Verified Phase 1 paid-addition slice:** Amendment commitment now validates stored canonical payment/owner evidence and atomically guards the open Scheduled window, eligible Order, amendment claim, exact demand and reaction success. Instant additions remain unavailable. Worker tests use payment initiation and mock-provider reconciliation to create the actual reaction, then cover canceled Order, insufficient stored payment, zero-row claim rollback and concurrent exactly-once commitment. Nine focused amendment/recovery tests, Core types and lint passed; this source change has not yet received a new aggregate or browser/provider run.

**Verified Phase 1 payment-redrive slice:** Automatic payment reactions claim a bounded attempt before application, preserve work after Worker termination, isolate application/provider lookup exceptions with safe codes, and complete replayed successes. Worker regressions cover concurrent sweep claims, an in-flight final-attempt lease, poison-reaction isolation, five-attempt exhaustion with one case, and provider failure without batch starvation. Nine focused tests and Core types/lint passed. The aggregate passed its convention/migration/type/lint/Web/shared stages, but Core exited with Windows status `3221226505` without an assertion report. Rerunning all Core tests with `--maxWorkers=4` passed 834 tests across 155 files; both builds then passed. This verifies the paid-addition slice too. No browser/provider acceptance is claimed.

- **Phase 0: reconciliation/design in progress.** Canonical AGENTS, architecture, domain, state, data, contracts, scope and design guidance now incorporate pay-as-you-go in both modes, Lalamove pricing, Scheduled-only manual fallback, Global price authority, warehouse transit/receipts, cycle goods, publication and onboarding requirements. `docs/architecture/COMMERCE_ALIGNMENT_DECISIONS.md` records actual source gaps and the retained-baseline strategy. Final consistency review and customer closure/retention policy remain open. No irreversible erasure policy is assumed.
- **Phase 1: partial implementation, not accepted.** Reproduced Worker/D1 defects and repaired receiving start mutation-before-validation, requirement-version guarding, completion/start success ownership, manual adjustments ignoring checkout holds, multi-pool ledger-key collision, absent/malformed hold commitment, cancellation lost-claim partial writes, missing cancellation-release ledger effects, and courier cancellation writing grocery Order cancellation. Preparation now coordinates the Order lock; Instant packing consumes reservations and stock with per-effect ledger evidence. Quote expiry/selling pause no longer rejects an otherwise valid already-started payment. Delivered Orders are excluded from the commitment outstanding-work count.
- Lalamove webhook dispatch/job/stop/Order/inbox application now commits as one guarded D1 batch. Unapplied inbox events retry after projection failure or late dispatch creation; concurrent duplicate and older events do not repeat projection. Early pickup remains `RECONCILIATION_REQUIRED` until packed/eligible evidence exists. Order lookup follows the DeliveryJob relationship rather than assuming the merchant reference is the Order ID. Courier failure/cancellation does not directly mutate the paid Order.
- Concurrent `MARK_PACKED` commands now have Worker/D1 regression evidence: exactly one succeeds, replay is stable, and both pools are consumed once. The focused 12-test commitment suite, Core types, lint, naming and diff checks passed after this test-only extension.
- Additional Worker regressions cover incomplete reservation-set rollback, customer cancellation versus preparation with one winner, delivered work freeing a later commitment slot, and customer ownership on successful cancellation replay. Packing validates the original commitment ledger's pool quantities, avoiding mutable catalog joins.
- Receiving's retained RPC now requires explicit start and honors the supplied expected receipt version. Its previously permissive RPC test now requires rejection with unchanged totals. No shared contract shape or migration has changed in this slice.
- Focused Worker tests pass for the changed receiving, commitment, cancellation, adjustment and webhook paths. The reachable Instant application test goes through Quote, synthetic canonical payment reaction, preparation and two-pool packing, with unauthorized and early-handover rejection. It is not browser/provider acceptance.
- Final aggregate `pnpm check` passed with 825 Core tests, 355 Web tests, 74 shared-package tests, formatting/naming/terminology, clean/retained-baseline migration verification, architecture/readiness, lint, all workspace types, Core dry-run build and Web vinext build. The historical Admin fixture using noncanonical Order `PAID` was corrected to `FULFILLMENT_PENDING`. The commitment suite also passed separately (12 tests) after isolating its capacity count from unrelated concurrent-test outcomes. Final diff whitespace and naming checks passed. No browser or provider sandbox acceptance is claimed.
- **Phase 2: partial implementation, not accepted.** Staff invitation creation with explicit saved role/scope grants, verified-identity acceptance, Core RPCs and Web acceptance UI are present. Remaining setup/access, location administration and cycle authoring still require implementation and end-to-end acceptance.
- **Phases 3-7: not accepted.** R2 publication and price authority, warehouse transfers, complete Scheduled purchase/receipt/allocation/surplus, normalized delivery/manual fallback, membership removal and complete browser/provider journeys remain in the plan. Schema primitives and existing screens do not establish phase completion.

Remaining Phase 1 work includes full paid-operation acceptance, Scheduled goods separation and purchase reachability, and bounded end-to-end paid-operation recovery. Missing-identity recovery requires a provider order number and matching provider-returned merchant metadata; it cannot discover an unknown booking automatically. Later-phase dependencies must be reconciled before accepting the phase. Only fresh Worker/verifier test databases are classified disposable; existing local and remote environments remain preserved.

Status date: 2026-09-06. This file is descriptive evidence only. The canonical documents named in
`AGENTS.md` remain authoritative.

## Commerce and external-delivery realignment — Phase 11 compatibility cleanup (2026-09-06)

- Deployed development and E2E Worker configuration now fails closed for payments; PayMongo sandbox
  is the only supported development runtime. The deterministic adapter remains an internal test
  fixture only. The mock-payment RPC, BFF route, page, and browser journey were removed.
- Active checkout quote/payment contracts and customer/Admin configuration screens no longer expose
  FreshMarkets Service Fee values. Historical committed Order and transaction-summary DTO fields
  remain nullable and render only when an old positive snapshot exists.
- Internal Rider navigation, assignment, batch, map, route-preview, manual delivery-advance, and
  simplified operations-board contracts and implementations were removed. The location-scoped
  external-courier queue, profile, book, refresh, cancel, tracking, and provider reconciliation
  surfaces remain active.
- Scheduled cycle reads and abandonment results no longer expose capacity. Legacy sourcing values
  are fixed persistence compatibility only and cannot be selected through active contracts or Admin.
- Operational guidance now covers authoritative pause/switch/reopen behavior, address incidents,
  external dispatch, uncertain provider outcomes, refresh/cancel, and production activation gates.

## Commerce and external-delivery realignment — Phase 4 catalog and availability (2026-09-06)

- Active catalog authoring now permits only `MASS`/`COUNT` base units. Migration `0060` preserves
  historical volume definitions while marking them inactive, and packaged liquids are authored as
  count-based products.
- Non-gram sell variants require a positive per-sold-unit shipping weight; gram variants derive it
  from exact base consumption. Quote lines snapshot canonical base unit and multiplied shipping
  grams, including large Scheduled quantities without floating-point conversion.
- Storefront and checkout use only positive exact-location SKU prices, active Product/SKU/local
  selling status, and mode-derived availability. Instant consults physical stock; Scheduled uses an
  active open pre-cutoff cycle-zone-location and never reads legacy inventory or capacity authority.
- Catalog seed generation no longer selects sourcing behavior. Legacy required sourcing columns
  receive a fixed compatibility value while the global fulfillment mode determines active behavior.

## Commerce and external-delivery realignment — Phase 3 selling gate (2026-09-06)

- Core now owns one `GlobalCommerceConfiguration` query plus explicit audited
  `PauseSelling`, `ActivateGlobalFulfillmentMode`, and `OpenSelling` commands. Each mutation is
  expected-version guarded and stores its exact successful result for idempotent replay; changed
  key reuse conflicts and concurrent writers cannot both advance the singleton.
- Mode activation fails while selling is open. A paused mode change supersedes only active Quotes
  for which payment has never started, preserves started-payment and committed-Order evidence, and
  leaves provider-event reconciliation/commitment runnable. Reopening evaluates controlled
  mode-specific location/capability/window readiness blockers.
- New fulfillment-option, Quote, and checkout-payment initiation paths fail closed while selling is
  paused. Exact Quote and payment-command replay is still resolved before the mutable selling gate.
  Active Core callers now read `global_commerce_configuration`; the older mode table remains
  historical compatibility data until the cleanup phase.

## Commerce and external-delivery realignment — Phase 2 persistence (2026-09-05)

- Forward migrations `0056`-`0059` establish the separate versioned global selling state and
  fulfillment mode, capacity-free Scheduled cycle eligibility, immutable provider quotation and
  delivery-finance evidence, exact paid-line Scheduled demand/procurement fields, refund
  processing/reconciliation metadata, Cloudflare Queue outbox publication/lease/dead-letter
  evidence, and deterministic missing historical Order numbers.
- Exact location/SKU prices remain the only retail-price authority. Historical Service Fee
  configurations and snapshots remain readable but are explicitly inactive for new commerce.
  Legacy capacity/allocation, Rider/fleet, old refund, and mock-payment rows are preserved for
  compatibility while later phases remove their active callers.
- The migration verifier covers both a fresh database and a populated `0055` upgrade, validates
  exact-demand and courier-variance guards, and proves compatibility rows survive unchanged.
  Runtime commands and customer/Admin surfaces still require their separately authorized later
  phases before the new persistence becomes active application behavior.

## Provider-priced checkout and Lalamove capability layer (2026-09-06)

- Core now composes an ordered, closed external-delivery provider registry. Instant fulfillment
  options expose only public-safe partner/service metadata and keep the opaque option ID as
  authority; the selected partner is retained in the Quote fulfillment snapshot. Scheduled
  checkout exposes only its cycle/window while Lalamove supplies the internal future quotation;
  location operations later select the external provider used for dispatch.
- The Lalamove v3 Worker-native adapter implements exact HMAC-SHA256 request signing, bounded
  responses, quotation-to-order creation within the short quote lifetime, returned stop-ID contact
  mapping, E.164 phone and labeled instruction forwarding, one generic bag/box remark,
  proof-of-delivery requests, exact decimal-string-to-minor-unit conversion, get/cancel, provider
  status translation, safe telemetry, and uncertain mutation quarantine. It sends no Lalamove
  thermal-bag, COD/autodeduct, or purchase-service option; FreshMarkets owns the customer payment
  and separately pays the courier.
- SKU logistics data now supports an estimated shipping weight per sold unit for non-gram products.
  Gram-based Quote lines use their exact base consumption; all new paid Order and paid-addition
  lines snapshot canonical base-unit code and resolved shipping grams. The packing rule is one bag
  below 10 kg and one box from 10 kg. Lalamove receives no `item`, dimensions, or grocery handling
  flags. Instant and Scheduled provider-priced options fail closed when any cart line lacks a
  resolvable weight.
- Liter and milliliter units are retired from active catalog authoring. Existing rows remain inactive
  for historical compatibility; packaged liquids are configured and sold as piece-based SKUs.
- `POST /webhooks/delivery/lalamove` verifies the documented payload-level `apiKey`, `timestamp`,
  and `signature` over the signed `data` object and exact callback path, deduplicates Lalamove
  `eventId`, applies ordered status observations, and retains
  authenticated non-status events for reconciliation. Migration
  `0061_lalamove_delivery_provider.sql` adds Lalamove to the closed dispatch/inbox vocabulary while
  preserving existing GrabExpress records and constraints.
- Runtime selection exposes only Lalamove; GrabExpress remains disabled until Cebu access, pricing,
  authentication, webhook, and sandbox gates are verified. An authenticated city lookup and signed
  PH/MOTORCYCLE sandbox quotation with two synthetic Cebu stops succeeded on 2026-09-06, returning
  PHP 40.00, request/expiry evidence, and no special requests. Live booking still requires secrets outside source
  control plus wallet/account readiness, webhook registration, sender/location profiles, and the
  operator dispatch command. Active checkout no longer reads legacy distance-rate delivery fees or
  FreshMarkets Service Fee configuration: the provider amount is snapshotted in integer minor units,
  quote expiry caps Checkout expiry, and payment readiness re-quotes before creating a payment.
  Move It is not advertised because no public developer API contract has been verified.

## GrabExpress provider-dispatch foundation (2026-09-03)

- The saved-address boundary now normalizes accepted Philippine mobile formats to one `+63...`
  E.164 value in Core. The address editor explains that the number is shared with the delivery
  rider and submits the normalized value while exact pin/serviceability ownership remains
  provider-neutral.
- The storefront `Deliver to` control now opens the DoorDash-inspired address search, exact-pin,
  and serviceability flow in a responsive modal. A confirmed serviceable location updates the
  header for the browser session while checkout continues to require an authoritative saved
  address and Core revalidation.
- Delivery now has a provider-neutral quote/create/get/cancel port and a bounded GrabExpress OAuth
  adapter. It maps the recipient's full name, phone, complete destination, exact coordinate,
  building/access/delivery guidance, and measured parcel data to the Grab request; it does not
  depend on a Grab city/barangay dictionary. Grab exponent-based money is converted to integer
  minor units at the boundary.
- Migration `0055_delivery_provider_dispatch.sql` and the guarded
  `requestProviderDelivery` application service persist one immutable outbound snapshot/hash per
  DeliveryJob. Exact replay returns the existing booking; a changed replay conflicts; and any
  possibly accepted create is quarantined for reconciliation instead of being created twice.
- The authenticated GrabExpress webhook boundary durably deduplicates provider observations,
  retains verified payloads as protected reconciliation evidence, prevents delayed events from
  regressing the current provider observation, and deliberately stops short of inventing canonical
  delivery milestones from provider vocabulary.
- Focused Core and Web tests prove delivery payload mapping, safe diagnostic event shape, contact
  normalization, request replay/conflict/unknown-outcome behavior, address persistence, and editor
  behavior. Production booking and canonical webhook lifecycle mapping remain fail-closed pending Grab
  Cebu enablement, a configured sender profile, measured packed parcels, authenticated webhook
  acceptance, and confirmation of which recipient instruction fields appear to the driver.

## Architecture and security hardening (2026-08-30)

- Shared contracts are decomposed by bounded context and paired with an exhaustive runtime method
  manifest. Core conformance tests prove the implemented Service Binding surface exactly;
  Web's sole opaque generated-binding cast is localized and tested.
- The TypeScript-scanner architecture gate rejects forbidden Web/Core, contract/infrastructure,
  layer-direction, provider, entrypoint-SQL, and row-contract dependencies. Non-Admin/non-Maps RPC
  transport is composed through bounded auth, catalog, membership, checkout, Payments, Orders, and
  Operations adapters over one cached Core dependency context. Admin and Maps transport remains
  behaviorally pinned in the entrypoint pending its independent owner-approved mechanical move.
- Auth, payment-webhook, and authorized non-Maps customer command bodies are byte-bounded before
  parsing; exact webhook signature text is retained. Web uses one validated UUID correlation ID
  through Core and back, including provider-webhook ingress. Direct Admin/Maps body reads remain an
  explicit owner follow-up under the user's exclusion.
- Web security headers now include a complete request-nonce CSP and browser hardening policy with
  deployed-only HSTS. vinext receives the same cryptographically random nonce through the supported
  Next 16 proxy path and applies it to every inline RSC/bootstrap script; no environment permits
  `script-src` inline/eval wildcards. The approved Mapbox worker/image/connect directives are
  unchanged, and live auth, Admin, and serviceability hydration passes under the nonce policy.
- Core liveness is dependency-free; readiness safely probes runtime configuration, D1, payment
  provider code/capabilities. Structured telemetry redacts sensitive
  fields, a static security gate blocks unsafe log calls, and both Workers explicitly retain all
  logs while sampling five percent of traces.
- Wrangler 4.125.0 regenerated and verified both Worker binding declarations. Architecture,
  readiness, lint, focused adapter/domain, type, vinext, and build gates pass for this batch; the
  final repository-wide acceptance evidence is recorded only after the full matrix runs.

## Mapbox Customer Address Flow (2026-08-30)

- Customer address search now uses a private POST/no-store Web adapter and Core's provider-neutral
  Mapbox Geocoding v6 port. Temporary candidates remain interaction-only; Core performs permanent
  reverse finalization before persisting provider-derived coordinates, metadata, or structured
  components. Component provenance is tracked independently from coordinate confirmation, so
  moving a candidate pin or accepting device coordinates retains `USER_PIN`/`DEVICE_LOCATION`
  coordinate provenance without treating temporary provider text as first-party. Updates carrying
  temporary provider components require the exact final coordinate pair and confirmation source.
  Unchanged saved provider components preserve their exact permanent metadata without another
  provider call; moving them re-finalizes at the new coordinate. Logs contain only operation
  timing/result categories and stable error codes.
- Migration `0042_mapbox_address_confirmation.sql` additively preserves legacy addresses while
  adding structured components, geocoder provenance, coordinate-confirmation provenance,
  delivery instructions, and resolver indexes. Owner scoping, optimistic address versions,
  authoritative serviceability, and immutable committed Order snapshots remain enforced in Core.
- The reusable accessible address editor supports search, current location, exact draggable-pin
  confirmation, textual map fallback, and unavailable-address correction without raw coordinate
  inputs. It now powers the saved-address book, serviceable-only Checkout selection, and anonymous
  non-persisting public Serviceability flow; customers never select a fulfillment hub.
- Local fixture verification covers provider mapping/finalization, migration preservation,
  ownership and serviceability, map/editor lifecycle, address-book and Checkout integration, and
  the managed vinext + Core/D1 Playwright journey. Production still requires origin-restricted Web
  token configuration, the Core Mapbox secret, permanent-geocoding entitlement, and approved
  production serviceability polygons outside source.

## Delivery Map Dispatch and Rider Navigation (2026-08-30)

- Core now exposes purpose-built, location-scoped Delivery map/detail and eligible-Rider reads,
  provider-neutral preview of the submitted manual stop order, and one atomic guarded
  create-and-assign command for one to 24 deliveries. Operational batches are exactly `INSTANT`
  or `SCHEDULED`; unresolved historical evidence remains non-operational. Migration
  `0043_delivery_batches_and_map_stops.sql` preserves historical jobs/batches/stops while adding
  canonical context, immutable stop coordinates, Rider references, versions, events, and indexes.
- The Admin Delivery workspace synchronizes accessible table and map selection, rectangle
  selection, protected detail, manual pointer/keyboard ordering, warning-only route preview,
  Rider workload, explicit final review, idempotent replay, and stale/conflict recovery. Mapbox
  never optimizes or authorizes the order, and the table workflow remains available when the map
  cannot render.
- Core resolves the authenticated active canonical Rider and returns only assigned batches. The
  first unfinished immutable stop is current; later stops are ordered upcoming work. Rider Web
  opens only the current coordinate through a keyless Google Maps universal driving URL with no
  origin or waypoints. FreshMarkets lifecycle actions remain explicit, Core-derived, versioned,
  and idempotent; session recovery stores bounded job/action command evidence without address,
  contact, instruction, coordinate, or token data.
- Fresh whole-program local acceptance passed 17 focused contract, 208 focused Core, and 261
  focused Web tests; the full recursive suite passed 1,096 tests in 169 files. Managed serial
  Playwright passed all five address/Checkout/serviceability flows, the Admin dispatch flow, and
  four runnable Rider navigation/advancement flows. One Rider empty-state flow remains skipped
  because the local run has no configured auth-email transport. Formatting, naming, migrations,
  lint, type checks, vinext compatibility, Worker builds, and diff checks passed; lint retains 19
  existing warnings and the Web build retains its non-fatal large-chunk advisory.
- Production still requires restricted public/server Mapbox token configuration, permanent-
  geocoding entitlement, and an approved versioned serviceability polygon release mechanism. The
  current runbook intentionally records production polygon change as blocked rather than
  inventing deployment or rollback authority.

## Admin Operations UI Phase 12 (2026-08-30)

- The approved Admin screen inventory is implemented through the typed Web-to-Core Service Binding: Core-authorized hierarchical navigation; Catalog Product and Category list/create/detail/edit/lifecycle; canonical R2-backed Product media administration; complete Order and Payment workspaces; and the existing Customer, Membership, Promotion, Inventory, Procurement/Receiving, Fulfillment, Delivery, exception, Analytics, Staff/Role, Audit, and fulfillment-mode surfaces. The privacy/account-closure schema, service, lifecycle, and audit evidence remain implemented, while the standalone Admin page and customer-detail controls are deferred pending an approved operational procedure.
- Migration `0041_admin_catalog_authoring.sql` adds guarded Category hierarchy/version fields and the canonical `product_media` association. Product media bytes are validated and stored through Core's `PRODUCT_MEDIA` R2 binding; Web has no D1 or R2 authority. The version-controlled storefront image metadata path remains compatibility-only until public Catalog delivery consumes canonical R2 media.
- Order detail composes immutable quote/order financial and item snapshots, Payments, amendments, fulfillment, delivery, exceptions, timeline, Core-derived actions, and Audit. Payment overview/detail composes canonical intent, attempt, refund, provider-safe event, reaction, and reconciliation projections; provider references, provider-event identifiers, hashes/payloads, and reconciliation JSON do not leave Core.
- Shared Admin compositions provide Core-derived breadcrumbs, typed responsive tables, explicit loading/empty/filtered/scope/error states, cursor controls, exact-impact confirmations, detail/timeline layouts, and live command results. The complete deterministic Admin Playwright set passed against the managed vinext + Core/D1 stack; exact final evidence is recorded in `docs/superpowers/reports/ADMIN_DASHBOARD_PHASE_12_FINAL.md`.

## Admin Shadcn UI Kit redesign (2026-08-31)

- The approved clean-room redesign is complete: Admin remains light-only with FreshMarkets orange accents, defaults to a 72 px icon rail, and composes shared overview, list, detail, editor, settings, chart, metric, command, and explicit-state primitives from shadcn/ui foundations. Existing Admin routes remain stable; `/admin/commerce-configuration` is the only added workspace route.
- Core now supplies purpose-built, capability- and location-scoped overview workload, exception, audit, freshness, catalog-readiness, pricing-context, Payment-series, and bounded Analytics-series read models. The UI renders unavailable evidence explicitly and does not synthesize operational, financial, or historical values.
- Product administration exposes authoritative readiness and price context plus private Core-owned R2 media delivery without disclosing storage keys. Payment and Analytics charts use canonical series, while workspace tabs and actions remain Core-derived. Fully privileged Global Administrators retain every workspace, market/location, Admin-safe record, and legal action.
- Commerce configuration presents the global effective-dated Membership price and Instant-only FreshMarkets Service Fee streams through typed reads and guarded replacement commands. Capability checks, global scope, stable idempotency keys, expected versions, explicit confirmation/reason evidence, conflict recovery, and immutable audit/history remain authoritative in Core. No schema migration was required.
- Final local verification passed formatting, naming, migrations, architecture/security/readiness checks, lint, type checks, 1,458 tests across 260 files, Core Worker dry-run build, Web vinext build and compatibility (`100%`, 14 supported, 0 partial, 0 issues), and all 56 deterministic Admin Playwright tests. Visual regression covers eight approved archetypes at desktop, tablet, and mobile viewports for 24 committed baselines. Production deployment acceptance remains external; the Web build retains its non-fatal large-chunk advisory.

## Admin workflow simplification (2026-09-01)

- Categories now appear inside the Products workspace rather than as a separate top-level navigation item. Operations primary navigation is reduced to Inventory and Delivery; Procurement, Receiving, and Fulfillment retain their independent Core state machines and contextual advanced routes without burdening the default operator path.
- Inventory now exposes explicit Add stock and Remove stock actions using a positive base-unit quantity. The Web adapter maps those actions to Core's signed, capability-scoped, version-guarded, idempotent adjustment command, and the UI shows immutable dated stock activity with the reason and actor evidence preserved.

## Global fulfillment and location commerce alignment (2026-09-02)

- Migration `0052_global_fulfillment_location_commerce.sql` replaces per-location customer fulfillment modes with one versioned global `SCHEDULED`/`INSTANT` switch and separates location dispatch readiness. New Quotes follow the current global mode; committed Orders retain their mode, location, zone, promise, and cycle snapshots.
- Catalog Product and Variant definitions remain global. Variant selling activation, exact authoritative price, and shared Product inventory are location-scoped. Market/global price fallback and active sourcing-mode configuration were removed from runtime contracts, Core decisions, and Admin UI.
- Scheduled commerce ignores physical stock and creates committed procurement demand. Instant commerce uses exact-location shared Product inventory plus holds/reservations; locally active priced products remain visible with per-Variant Out of stock state when stock is short.
- Overlapping geofences are assigned by exact Haversine distance with stable location-ID ties. Operational readiness/capacity may fall through to the next closest eligible location, while stock never reroutes or splits an Order.

## Admin performance stabilization pass (2026-09-01)

- Phases 1–6 of `ADMIN_PERFORMANCE_STABILIZATION_PLAN.md` are locally implemented: correlated
  Web/Core/D1 timing, disabled dense Admin prefetch, one typed bootstrap read, request-scoped IAM
  reuse, bounded set-based Overview/Product reads, and data-conditional chart loading. Core remains
  the sole authentication, authorization, scope, business, and D1 authority.
- Local evidence proves one browser bootstrap request, one Better Auth session resolution per
  bootstrap RPC, one set-based exception statement across multiple locations, one Product readiness
  statement, and no Recharts or storefront-font request for an empty Admin Overview. No index,
  projection, cache, infrastructure, schema, or migration change was approved.
- Integrated verification passed formatting, naming, terminology, migration upgrades,
  architecture/readiness checks, zero-warning lint, all workspace type checks, vinext compatibility
  (`100%`, 14 supported, 0 partial, 0 issues), 1,503 tests across 265 files, Core dry-run and Web
  production builds, and 90 managed Web/Core/D1 Playwright flows with two environment-gated skips.
  Full-page Admin visual baselines remain stale against unrelated shell changes in the dirty
  worktree and were not silently replaced.
- Production cold/warm p50/p95/p99, rows-read evidence, transfer/parse timing, and resulting budgets
  remain external because the authenticated Cloudflare account has no configured production Worker
  for this repository. The pass therefore makes no production latency or SLO claim.

## Runtime and persistence reliability remediation (2026-08-30)

- The populated `0020 -> 0021 -> current` migration path now preserves commerce history and foreign-key integrity; the verifier exercises that real pre-`0021` boundary as well as fresh, Analytics, and cart/inbox upgrade paths. Retired inventory triggers remain absent.
- Core and Web parse one closed typed runtime configuration. Unknown deployed environments, insecure origins, weak/missing auth secrets, incomplete OAuth pairs, unapproved payment adapters, and renewal ownership without a provider fail closed.
- Migration `0046` deterministically reconciles duplicate active carts, enforces one active cart per customer, and adds provider-inbox normalized observations, retry availability, and conditional leases. Cart mutation is idempotent and version guarded; missing SKU/price is explicit and never displayed as zero.
- Migration `0054_paymongo_subscription_webhook_audit.sql` retains every signature-verified bounded raw webhook body with its hash and verification time, adds Payments-owned PayMongo plan/subscription/invoice mappings, and migrates historical `PAUSED` memberships to intentional `CANCELED` history. Raw provider bodies remain absent from logs and ordinary Admin DTOs.
- The Membership scheduler now expires only FreshMarkets-owned introductory trials. It cannot initiate or retry a paid renewal, run local dunning, or expire a local grace timer; PayMongo Scheduled Subscriptions is the approved paid billing/retry owner.
- The production PayMongo adapter now implements Payment Intents, direct browser card tokenization, refunds, provider Customers, immutable scheduled monthly Plans, paid Subscription provisioning, immediate/effective-period cancellation, exact raw-body HMAC webhook verification, payment/refund/subscription/invoice mappings, verified-delivery audit, inbox redrive, and fifteen-minute provider-state reconciliation. `UNPAID` is applied only from verified or retrieved provider truth. Live account capability activation, secrets, webhook registration, and live-money acceptance remain deployment evidence rather than repository claims.
- Catalog generation is owned by its pre-`0025` schema boundary and reproduces the committed migration byte-for-byte. Storefront card assertions cover identity/price while quick view owns fixed-variant assertions. A parent-scoped pnpm override replaces the vulnerable legacy esbuild with `0.25.12`; `pnpm audit` reports no advisories.

## Admin and Platform Readiness Slice 9 (2026-08-29)

- Shared Admin accessibility/state hardening, Web/Core boundary regression coverage, static security verification, Worker-local smoke checks, and deployment/recovery/auth-email runbooks are implemented.
- The deterministic Playwright fixture starts an isolated port-3100 Web/Core stack, uses Core's existing test-only email adapter, provisions verified Better Auth accounts and application-owned Staff access in local D1, and exercises real authorized and capability-denied routes. No production auth bypass or public test endpoint exists.
- The Slice 7 atomicity finding and the complete Slices 1–9 review set are remediated. Final evidence is recorded in `docs/superpowers/reports/ADMIN_READINESS_SLICE_9_FINAL.md`.
- Browser Web Vitals are outside the approved API/business-logic release gate. They remain optional evidence for a future Admin UI optimization pass; no performance claim is made here.

## Produce catalog storefront rollout

- All 226 public produce assets are D1-backed products across seven controlled categories
  (migration `0025`, generated from the typed manifest in `apps/core/src/catalog/seed/`). 415 fixed
  sellable SKUs use `G`/`KG`/`PC` controlled units; assembled packs/bunches keep exact internal gram
  recipes with customer-facing approximate contents notes and staff packing instructions stored in
  OPERATIONS-only SKU detail rows.
- Every launch SKU carries positive versioned Metro Cebu STANDARD pricing and Central Cebu
  `AVAILABLE` state through `sku_location_availability`; Scheduled display ignores on-hand inventory.
- Storefront browsing uses Core's bounded `getMarketplaceHome` rails and database-side cursor
  pagination; Web renders Core media/details with no slug-image map and placeholder fallback.
- Launch storefront binaries remain version-controlled Web assets as a compatibility path; canonical Admin-managed Product media now uses the Core-owned R2 `product_media` association from migration `0041`.

## Admin Analytics Slice 8 (2026-08-29)

- Versioned Analytics definitions are persisted in Core through migrations `0032` and additive
  `0033`; formula metadata is descriptive and dispatch is a closed named-query registry.
- Core exposes capability- and scope-checked definition, Overview, and metric-series reads. It
  returns typed `UNAVAILABLE` results whenever canonical event timestamps, accounting policy, or
  source attribution are not instrumented; no inferred timestamps or client formulas are used.
- Web adds thin same-origin Analytics BFF routes and an `/admin/analytics` workspace with numeric,
  unavailable, freshness, loading, empty, permission, validation, and error states.
- Reconciliation coverage verifies all blocked catalog metrics remain unavailable and source reads
  are read-only. Deterministic authenticated Playwright coverage exercises the real Analytics route
  and its capability-denial path through Web and Core.

## Admin Foundation Slice 1 (2026-08-27)

- Canonical dot-form admin capabilities are seeded by `0026_admin_foundation.sql` with additive
  legacy colon-form mapping; production authorization recognizes only canonical capabilities, and
  historical permission rows remain untouched compatibility data.
- Core exposes `getAdminContext`, `listAdminScopes`, `listAdminAuditEvents`, and
  `getAdminAuditEvent` through the shared `AdminFoundationService` contract. Audit reads are
  `audit.read`-gated, resource-scope filtered, cursor-bounded (limit 1–100, opaque base64url
  cursor, `VALIDATION_FAILED` on malformed cursors), and recursively redact credential-shaped
  keys; invalid historical JSON sanitizes to an empty object with a logged warning.
- Web adds thin same-origin BFF routes (`/api/admin/context`, `/api/admin/scopes`,
  `/api/admin/audit`, `/api/admin/audit/[audit-event-id]`) that forward session headers to the
  Core Service Binding with no Web-owned authorization and no D1 access, plus a layout-owned
  capability-aware admin shell that renders only Core-provided navigation and an Audit workspace
  covering loading, empty, filtered-empty, permission, and error states with request references.
- Deviation (owner-gate): the shadcn CLI was not run because `apps/web/app/globals.css` carries
  owner-owned uncommitted storefront changes. The six required primitives (alert, breadcrumb,
  input, sheet, skeleton, table) were added as shadcn-source components themed to the existing
  `--fm-*` tokens; `@radix-ui/react-dialog` is the only new runtime dependency. `globals.css` was
  not modified and no owner-owned file was staged.
- Route-segment deviation: the Audit detail path uses kebab-case `[audit-event-id]` because
  repository naming conventions reject uppercase route directories.
- Deterministic authenticated Playwright journeys exercise the real Staff shell, non-Staff state,
  permission-filtered navigation, and responsive keyboard behavior through Web/Core and local D1.

## Admin Staff & Access Slice 2 (2026-08-27)

- Migration `0027_staff_administration.sql` adds `staff_invitation`, `staff_identity.version`, and
  role administration metadata (`description`, `ACTIVE|ARCHIVED` status, `version`). Roles are
  archived, never deleted; archived roles fail closed on assignment.
- Core implements `AdminStaffAccessService`: staff reads, invitations, rename, activate/suspend,
  atomic role/scope replacement (version-guarded D1 batches), session revocation, role CRUD with
  canonical-only capabilities, and the capability vocabulary read model. Authorization is
  `staff.read`/`staff.manage` plus a global scope; every material command is idempotent,
  version-guarded, and audited with before/after snapshots.
- Session revocation deletes the authentication authority's own session rows (the minimal Better
  Auth build exposes no admin revoke API); integration tests prove a live session dies.
- Web adds twelve thin BFF adapters under `/api/admin/{staff,roles,capabilities}` and the Staff
  workspace (`/admin/staff`, detail, roles list/detail) with invite, atomic editors, reason-gated
  destructive actions, and loading/empty/permission/error states with request references.
- Invitation acceptance/provisioning of a new identity is explicitly deferred to the slice that
  implements the public acceptance flow; no password input exists anywhere.
- Deterministic authenticated Playwright coverage exercises the real Staff workspace plus a real
  invitation command under both authorized and capability-denied principals.

## Admin Customer CRM Slice 3 (2026-08-27)

- Migration `0028_customer_crm.sql` adds `customer_invitation` and the `privacy_request` queue with
  closed request-type and status vocabularies. No hard-deletion surface exists; completion records
  resolution only and retention-backed anonymization stays gated on approved policy.
- Core implements `AdminCustomerService` and `AdminPrivacyService`: composed customer list/detail
  (principal access status, membership state, order counts, sanitized recent audit), invitations,
  commerce access disable/restore through the `customer_principal` gate with the customer version
  guard, session revocation, closure requests, and the legal privacy lifecycle
  (`ILLEGAL_TRANSITION` otherwise). Authorization is `customers.read`/`customers.manage` plus a
  global scope; commands are idempotent, version-guarded, reason-gated, and audited.
- A cross-cutting fix guards versioned batch audit rows so a stale command can never leave orphaned
  audit evidence (`fix(admin): guard audit rows against stale versions`).
- Web retains the thin privacy BFF adapters for the preserved Core capability. The current Customers
  workspace provides list/search + invite and detail access/session actions with an audit table;
  the former standalone privacy queue and customer-detail privacy controls are deferred pending an
  approved intake, identity-verification, retention, and escalation procedure.
- Deferred: `admin.customers.update` (no approved application-owned mutable profile fields),
  support notes and segments (unapproved good-to-haves), invitation acceptance/provisioning.
- Deterministic authenticated Playwright coverage exercises the real Customer workspace plus a
  real invitation command under both authorized and capability-denied principals.

## Admin Catalog & Inventory Slice 5 (2026-08-27)

- No schema change was required: the admin surface composes the existing catalog, unit, price
  version, availability, balance, and ledger tables.
- Core implements `AdminCatalogService` (category/unit creation, product list/detail/status, SKU
  create/update with same-dimension validation, version-guarded availability upserts, versioned
  market `STANDARD` price inserts) and `AdminInventoryReadService` (location balances and bounded
  keyset ledger). Catalog authorization is `catalog.read`/`catalog.manage` + global scope;
  inventory reads are `inventory.read` + operational location scope; the existing
  `inventory.adjust` command keeps its own guards.
- Phase 12 adds canonical R2 media administration plus Product/Category detail authoring and
  hierarchy. Bulk import remains deferred; purchase/receiving surfaces remain owned by
  Procurement/Receiving.
- Web adds ten thin BFF adapters and the Catalog workspace (categories/units/products + product
  detail with SKU authoring, versioned pricing, availability toggles) and the Inventory workspace
  (location balances, guarded adjustments, ledger inspection).
- Deterministic authenticated Playwright coverage exercises the real Catalog workspace plus a
  real category command under both authorized and capability-denied principals.

## Admin Promotions Slice 4 (2026-08-27)

- Migration `0029_promotion_administration.sql` rebuilds the `promotion` seam into the canonical
  definition shape (closed order/delivery benefit types, DRAFT/ACTIVE/INACTIVE/ARCHIVED lifecycle,
  usage limits, version) and adds `promotion_grant.customer_id`. Legacy WELCOME50 copies forward as
  an active fixed-discount definition. No delete path exists.
- Core implements `AdminPromotionsService`: list/get, draft-only definition updates, lifecycle
  transitions with `ILLEGAL_TRANSITION` rejection, read-only deterministic preview, targeted grants
  through the canonical grant table (ACTIVE promotions only), and redemption inspection joined by
  promotion code with `INTRO_TRIAL` excluded. Authorization is `promotions.read`/`promotions.manage`
  plus a global scope; commands are idempotent, version-guarded, reason-gated, and audited.
- Deferred: membership fee waivers (owned by the introductory-trial authority), delivery benefits
  and non-MINIMUM_SUBTOTAL rule types (until Quote consumes them), and redemption application at
  checkout (owned by the checkout/Quote domain, not this admin slice).
- Web adds seven thin BFF adapters and the Promotions workspace (list + draft creation, detail with
  lifecycle actions, read-only preview, grants, redemptions).
- Deterministic authenticated Playwright coverage exercises the real Promotions workspace plus a
  real promotion command under both authorized and capability-denied principals.

## Reconciled implementation state

### Admin finance and lifecycle administration Slice 6 (2026-08-28)

- Core exposes global-scope Orders, Payments/Refunds, reconciliation, Membership lifecycle, and
  customer order-issue read models and commands. Order cancellation delegates to the canonical
  command; refunds remain `REQUESTED` until provider confirmation; Membership recovery remains
  deferred.
- Phase 12 completes the Order and Payment operational projections and dedicated Payment Overview,
  Transactions, Detail, and Reconciliation routes. Allowed actions now combine lifecycle policy
  with the caller's actual command capability, and raw provider/reconciliation storage is withheld.
- Migration `0030_order_issues.sql` and its integration coverage are present. Issue actions use a
  closed lifecycle and never authorize refunds.
- Web provides thin BFF adapters plus Orders/detail, Payments, Memberships/detail, and Issues
  workspaces with loading, empty, error, retry, and command-result states.
- Focused contracts, Core integration, Web route tests, typechecks, and builds pass. Deterministic
  authenticated Playwright covers a real order cancellation under both authorized and
  capability-denied principals.

### Payments and paid-order recovery

- The deterministic `mock` provider is the only runtime payment adapter. It is selected explicitly
  and is limited to `development` and `test`; every other environment fails closed.
- Core and Web can execute a local Instant checkout through quote acceptance, mock payment intent,
  an authenticated same-origin simulator, signed provider event, durable payment and settlement
  observations, and exactly one committed order. The simulator derives all financial/identity
  fields in Core and accepts only success, failure, or expiry.
- Managed vinext + Core/D1 Playwright proves approval commits only after the verified event, browser
  return without an event cannot commit, and decline remains uncommitted. Preview, staging, and
  production reject mock registration and expose neither simulator page nor route.
- Duplicate commands, provider events, and redrives cannot create a second canonical payment or
  order.
- If payment succeeds and commitment fails, the same reaction is retried. Bounded failures create a
  reconciliation case while preserving the payment. No automatic production refund policy exists.
- Financial-safety remediation now centralizes exact-instant Membership entitlement, enforces the
  PHP market minimum on pre-discount merchandise in Instant and Scheduled paths, and persists
  explicit quote/order monetary components. Payment readiness recalculates without superseding the
  accepted Quote; identical replay resolves before Quote state checks and returns the same durable
  unexpired redirect/SDK continuation.
- Provider-customer mappings are executed before provider calls. Recurring authorization claims its
  idempotency key before the external call. Thrown/locally ambiguous payment and authorization
  outcomes remain processing with reconciliation rather than being mislabeled failed.
- Introductory trials now start from the Promotions redemption without a payment authorization,
  create no Payment or paid-price agreement, and expire at their exact calendar-month boundary.
  They never convert in place. A customer-selected paid enrollment creates a separate `PENDING`
  Subscription at the then-current price, and only provider-confirmed payment activates it.
- Migration `0049_payment_settlement_observations.sql` records immutable provider-neutral gross,
  processing-cost, withholding, adjustment, and net observations only after verified exact
  arithmetic and Payment/Refund amount/currency agreement. Actual provider processing cost remains
  separate from the customer-facing FreshMarkets Service Fee.
- Paid Order commitment aborts atomically on a lost Quote or Scheduled-capacity compare-and-swap,
  recording stable finance exceptions. Refund requests reserve captured value with one guarded
  insert across REQUESTED/APPROVED/PROCESSING/ESCALATED/SUCCEEDED states. Provider availability is
  resolved before a new claim, orphaned REQUESTED replays escalate visibly, and successive partial
  successes recompute the payment aggregate through `REFUNDED`.
- PayMongo Scheduled Subscriptions is the owner-approved recurring-membership direction and owns
  invoice generation and retries. Production is still fail-closed because account capability
  activation, credentials, the live adapter, signed fixtures, and end-to-end provider acceptance are
  not yet implemented. The deterministic mock remains development/test-only.

### Checkout and delivery pricing

- Catalog prices are admin-managed. Cart display prices neither lock price nor reserve inventory.
- Instant checkout is authenticated pay-as-you-go and no longer requires membership. Scheduled quote,
  payment revalidation, and commitment retain the exact-instant Membership entitlement gate.
- Migration `0048_membership_and_service_fee.sql` adds one global effective-dated Membership price
  stream, agreed price snapshots on paid Subscriptions, and one global effective-dated Instant-only
  FreshMarkets Service Fee configuration. Existing paid Subscriptions retain their agreed amount
  and currency; ordinary price changes affect only new paid enrollment. Trial Subscriptions carry
  no agreed paid-price snapshot.
- The Service Fee supports `FLAT`, `PERCENTAGE`, and `MIXED`; the percentage basis is the complete
  payable amount before the Service Fee and uses exact integer ceiling arithmetic. Quotes and Orders
  snapshot its configuration and calculation. Payment-time revalidation returns `PRICE_CHANGED`
  when fee evidence is stale. Scheduled checkout records no Service Fee.
- Core publishes global-scope `memberships.read`/`memberships.manage` and
  `payments.read`/`payments.manage` configuration RPCs. The separate Admin Dashboard UI workstream is
  unchanged.
- Instant quote creation accepts an explicit null cycle and uses a transaction-local D1 guard so
  concurrent carts cannot hold the same final inventory units. Scheduled commitment preserves the
  quoted delivery date independently from its cutoff.
- Core recalculates price, promotions, stock, serviceability, and delivery fee before payment. A
  changed total returns `PRICE_CHANGED` and requires explicit customer acceptance of a new quote.
- Delivery configuration is versioned per market/location and stores integer minimum and
  per-kilometer minor-unit rates. There is no production seed value.
- Core's provider-neutral route-distance port has a Mapbox `mapbox/driving` adapter. External route
  failure fails checkout closed; no straight-line or fabricated fallback exists.
- Quotes and committed orders persist immutable provider-neutral delivery calculation snapshots,
  including distance meters, minimum, rate, calculated fee, configuration version, and calculation
  method/profile.
- Migration `0022_delivery_pricing_reconciliation.sql` restores indexes lost by `0021`, restores
  one-order-per-payment enforcement, adds delivery configuration/snapshot storage, and is covered by
  fresh and populated-0021 upgrade checks.

### Authentication email

- Better Auth verification and reset callbacks use the existing Core auth-email port.
- The runtime adapter uses Cloudflare Email Service's Core-only `EMAIL` binding. Sender configuration
  has no production default, missing configuration fails closed, and bearer URLs/recipients are
  redacted from logs.
- Tests use injected fakes. Sending-domain onboarding remains external deployment work.

### Marketplace storefront home

- The `/` marketplace home is server-rendered against Core read models (`searchCatalog`,
  `listCategories`) through the Service Binding inside the vinext RSC page; the former
  client-side catalog fetch was retired.
- The composition follows the approved storefront design: hero heading, real-category pill rail,
  two restrained marketing modules, merchandising rails per category, membership-context strip,
  server-filtered search/category grid, and a quick-view product dialog with fixed-variant
  selection. Demo-only prototype concepts (pickup toggle, multi-store hub selection, ratings,
  tips, invented promotion codes) are intentionally absent.
- `migration 0023` seeds 17 additional Cebu produce products with fixed 250 g/500 g/1 kg SKUs,
  market-scoped standard prices, and Central Cebu selling status so rails render with real data.
- Cart interaction is Core-authoritative through `/api/commerce/cart`; add-to-cart for anonymous
  visitors presents a sign-in affordance and preserves browsing context. Pre-authentication
  add-to-cart remains an approved design decision without a Core anonymous-cart capability and is
  future backend work.
- Anonymous browse, category/search filtering, quick-view, and the sign-in boundary are covered
  by Playwright (`tests/storefront-home.spec.ts`) on a provisioned local stack.

### Customer cancellation

- Migration `0050_coordinated_order_cancellations.sql` persists one Orders-owned cancellation
  aggregate and the exact original/amendment Payment refund set. Canonical verified Refund
  observations advance each member; partial success does not mark the Order canceled.
- Customer cancellation is exposed through the typed Service Binding and thin Web route. Instant
  locks at `FULFILLMENT_PENDING` and retains the snapshotted FreshMarkets Service Fee. Scheduled
  locks at the earlier of cutoff or fulfillment start and coordinates every committed addition.
  FreshMarkets-caused cancellation refunds the applicable set in full.
- Core supplies the exact current refund/retained-fee preview to the accessible customer confirmation
  flow. Existing unrelated refunds route to financial review. Global-scope `refunds.manage` retains
  the separately audited, required-reason staff exception path after the customer lock.
- Cancellation/refund transitions project durable, deduplicated notification intents. Delivery
  failure never changes Order, cancellation, Payment, or Refund state.

### Provisional transaction summary

- Core publishes an ownership-scoped summary over immutable Order/item/address/financial,
  Payment/Refund, amendment, and invoice-readiness snapshots. The printable customer page says
  `NOT AN OFFICIAL BIR INVOICE` and does not invent seller/TIN, official serial, or tax facts.
- `notifications@freshmarkets.ph` is the intended transactional sender but is not enabled:
  `freshmarkets.ph` is not currently onboarded for Cloudflare Email Sending. Missing sender
  configuration remains a retryable fail-closed delivery condition.

### Operations exception convergence

- Admin operational exceptions converge procurement, receiving, fulfillment, and delivery source
  records into a typed, location-scoped queue exposing policy-derived severity, source age where
  timestamps exist, owner, reason, and source-derived permitted actions. Resolution remains owned
  by each source command and its immutable audit event; unsupported actions are explicitly
  unavailable in the convergence view.

### Scope-aware Admin navigation

- Admin Context navigation entries now carry Core-owned `GLOBAL`, `MARKET`, and `LOCATION`
  applicability in addition to capability, section, and parent metadata. Web only narrows this
  already-authorized set when the operator changes scope.
- Central Cebu and other Location selections retain scoped Overview, Orders, Products, Inventory, Delivery,
  Analytics, Audit, and Fulfillment Mode destinations when authorized. Global Products, Customers,
  Memberships, Promotions, Payments/Pricing, and Staff administration are removed from both the
  desktop sidebar and mobile navigation.

### Location delivery execution

- Each active fulfillment/store location can own a versioned sender and structured courier pickup
  profile; its authoritative coordinates remain on the location itself.
- The active Delivery workspace is an external-courier queue with immediate/future Lalamove booking,
  manual provider refresh/cancel, and tracking links. Rider assignment, delivery batches, route
  planning, and live-driver maps are absent from active Admin delivery UI. Instant external booking
  is checked against the provider selected by the customer at checkout.
- Core assembles the provider request from committed Order/stop snapshots and total shipping grams,
  persists client idempotency and immutable dispatch evidence, and atomically prevents the same job
  from being concurrently claimed by compatibility internal-assignment data.

### Financial and promotion safety

- New Instant and Scheduled checkout totals contain merchandise, controlled discounts, provider-
  priced delivery, delivery discounts, and tax only; Service Fee and provider processing cost are
  not customer charges. Historical committed fee snapshots remain renderable.
- Provider-confirmed refund state drives coordinated Order cancellation across the original payment
  and every committed paid addition. PayMongo processing cost remains internal settlement evidence
  with exact integer reconciliation.
- Promotion commitment revalidates definition/version and applies at most one merchandise benefit
  plus one delivery benefit. D1 write guards enforce global, per-customer, and grant usage limits at
  the concurrency boundary.

### Notification Queue delivery

- D1 remains the source of notification intent. The scheduled recovery job publishes stable outbox
  identities to an environment-scoped Cloudflare Queue; it recovers failed publication and expired
  publication leases without changing source domain state.
- The Queue consumer isolates every message, explicitly acknowledges or retries, records conditional
  delivery-attempt evidence, deduplicates completed sends, and quarantines unknown send outcomes to
  avoid duplicate customer email. Retry exhaustion is visible in D1 and the configured DLQ.

### Commerce and external-delivery realignment (2026-09-07)

- Phases 1–11 of the approved realignment are implemented in separate commits: canonical documents,
  forward migrations, global selling/mode authority, PayMongo-only payment direction, Instant and
  Scheduled checkout separation, exact Scheduled demand, external delivery execution, financial and
  promotion safety, notification Queue delivery, and compatibility cleanup.
- Phase 12 repository verification passes on the current tree: structural/security checks, all
  typechecks, 68 contract tests, 355 Web tests, 804 Core tests, shared-package tests, Worker dry-run
  build, and vinext production build.
- Authenticated managed-stack browser coverage proves exact store/SKU pricing and the canonical
  pause/switch/reopen sequence through Web, Core Service Binding, Better Auth, and local D1. The
  final snapshot-update-disabled run passed all 86 browser tests, including 24 Admin visual
  comparisons and 390px document-overflow assertions.
- The former Admin fulfillment-mode compatibility RPC/route has been removed. Product edit reads now
  preserve the explicit global or exact-location scope required by the active Product contract.
- Runtime payment and delivery providers remain disabled locally. PayMongo and Lalamove sandbox
  transactions, Cebu/account acceptance, credentials, webhooks, and reconciliation rehearsal remain
  external activation gates; production continues to fail closed. Grab remains disabled.
- Detailed evidence and activation requirements are in
  `docs/superpowers/reports/COMMERCE_EXTERNAL_DELIVERY_REALIGNMENT_VERIFICATION_2026_09_07.md`.

## Maturity by area

| Area                       | Current evidence                                                                                                                                                                                                      | Not established                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Repository/Core boundaries | Monorepo, Core authority, Service Binding contracts, D1 ownership tests                                                                                                                                               | Production deployment acceptance                                               |
| Auth and IAM               | Better Auth Core ownership, RBAC boundaries, fake email-flow tests                                                                                                                                                    | Production sender/domain and OAuth configuration                               |
| Catalog/geography          | SKU/base-unit/pricing foundations; route-price adapter tests                                                                                                                                                          | Approved production polygons/geocoder and Mapbox secret                        |
| Checkout/orders            | Opaque Core fulfillment options, Instant holds, capacity-free Scheduled exact demand, provider-priced delivery, PayMongo event reaction, immutable history, coordinated cancellation, provisional transaction summary | PayMongo/Lalamove sandbox and production acceptance; official invoice issuance |
| Membership                 | Customer experience plus provider-neutral trial/authorization/renewal state                                                                                                                                           | Approved production mandates and automatic charges                             |
| Operations                 | Scoped procurement/receiving/fulfillment commands, exact Scheduled aggregation, external-provider delivery operations, authenticated Admin flows, and local integration tests                                         | Real Lalamove Cebu sandbox/account acceptance                                  |
| Notifications              | Durable email outbox/attempts, leases, retry, cancellation/refund projections, and safe templates                                                                                                                     | Production sender/domain and delivery acceptance                               |
| Commerce realignment       | Phases 1–12 implemented; repository gate, authenticated managed-stack flows, and responsive Admin visual regression verified locally                                                                                  | Provider sandbox activation and production deployment                          |

## Verification truthfulness

Focused Vitest suites and migration checks are implementation evidence. A skipped or gated
Playwright journey is still skipped and does not satisfy an acceptance criterion. Plan 08 / Program
1 and the broader product-program spine must remain open until their written authenticated browser
and operational acceptance criteria actually run and pass. Historical commit messages, reviews, and
ledgers do not override that boundary.

The final verification results for this reconciliation belong in the task report after current-tree
formatting, naming, migration, lint, typecheck, test, build, vinext, and runnable Playwright gates
have been executed.

## Remaining decisions and deployment work

- Complete PayMongo sandbox/production acceptance and Lalamove Cebu account, wallet, pickup-profile,
  webhook, quotation, dispatch, status, cancellation, and reconciliation acceptance.
- Decide membership-cancellation customer UX and effective timing before exposing a command.
- Configure an onboarded transactional email sender/adapter and the Core Mapbox secret outside source.
- Approve BIR seller/tax/serial/retention policy before invoice issuance.
- Treat the Customer launch implementation as locally verified product behavior only after the current-tree completion report gates pass; production deployment acceptance remains external.
- Provision production secrets/bindings and run environment-specific provider and deployment smoke
  tests only after explicit owner activation approval.

## Schema audit remediation — 2026-09-07

The schema-audit corrections are implemented in the working tree: migration 0069, the affected Catalog/Inventory/Delivery/Orders callers, paginated order-history contracts and Web UI, and reproducible migration/fixture checks. The single shared Product pool is explicit; financial status/provider identity and exact Scheduled quantities have database guarantees. Delivery persistence supports historical external/manual attempts with one active/uncertain attempt; this does not complete manual delivery commands/UI or the remaining warehouse/cycle/media phases.

`pnpm check` passed (846 Core tests, 358 Web tests, shared/harness tests and both builds). Additional final checks passed for delivery identity/recovery, route/page interactions, the populated Worker/D1 upgrade and rollback, and desktop/mobile browser pagination with controlled DTOs. Existing databases were not migrated/reset and nothing was deployed. See [schema remediation checkpoint](../operations/checkpoints/SCHEMA_REMEDIATION.md) for exact evidence, remaining product scope and retained-deployment precautions.

Owner policy-placement follow-up (2026-09-07): 0069 no longer enforces Scheduled-only manual eligibility, manual-specific lifecycle statuses or completion-triggered handover evidence. These remain required Core policies in alignment Phase 6 before manual commands/UI are exposed. Assignment structure, timestamp consistency, immutable history and duplicate/unresolved-attempt defenses remain in storage. The saved plan and engineering guides record this boundary and other phase-owned policy reviews. Fresh/upgrade migration checks, 19 focused Worker/D1 tests, Core typecheck, lint, formatting, naming, architecture/readiness and 25 harness tests passed. No existing database was migrated/reset; see the schema remediation checkpoint for scope and validation history.

Additional policy placement completed (2026-09-07): 0069 replaces component stacking constraints with benefit/redemption identity, removes promotion usage-count triggers and mode/cadence coupling CHECKs, and removes the retired fee-activation flag. Core preserves current stacking, atomic global/customer/grant limits, supported cadence and zero new Service Fee. The saved commerce plan records remaining phase acceptance. Final pnpm check passed (857 Core tests, 360 Web tests, 68 contract tests, 25 harness tests, migrations, lint/types and both builds). No existing database was migrated/reset and nothing was deployed; see the schema remediation checkpoint for evidence and rollout limits.


2026-09-08 commerce continuation (in progress): receiving now batches current IAM/context/version guards, receipt events, cycle goods, audit and frozen replay; Scheduled packing consumes allocation rather than physical inventory. Migration 0073 preserves historical physical receipts as marked evidence without inferred allocation. Named receiving actions and exact unknown-response recovery are implemented. Focused Worker/Web and populated migration checks pass; full Core/browser verification is running. Purchase confirmation, surplus release and complete phase acceptance remain open. See docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md.

Receiving slice verification completed: 910 Core tests, final 34 focused Worker checks, nine schema/retained-upgrade checks, six Web checks and 68 contract checks pass. Executed managed desktop/mobile receiving journeys and builds pass. No whole commerce phase, provider sandbox or retained deployment acceptance claimed.

Procurement aggregation now guards operational cutoff, exact demand, current IAM, run/receipt state and every dependent effect with frozen replay. Focused Worker checks pass. Purchase confirmation and supplier/workspace authoring remain incomplete; no commerce phase accepted.

Inventory correction now guards current IAM, exact stock, reservations/holds, ledger, audit and original replay in one transaction. The stock workspace supports first balances and lost-response recovery; final desktop/mobile local Web/Core/D1 flows passed. No schema change or whole-phase acceptance. Cancellation/refund recovery and all remaining setup/operations phases continue; see the execution checkpoint.

Refund projection recovery now verifies canonical payment/refund identity, amounts and status; member/cancellation/Order completion is atomic, unlinked refunds recover by stable key, and inbox completion follows projection. Forty-five focused Worker tests pass, including verified refund ingress failure/replay and competing member completion. This does not complete cancellation admission, durable refund submission recovery, Admin replay or Phase 1.

Cancellation admission now atomically saves current authority, paid-set/cutoff guards, stock release, audit and frozen acceptance. Customer/Admin Web retain unknown requests; Admin returns a purpose-built operation receipt. Registered bounded recovery submits saved members, protects them from unrelated refunds, and reconciles existing Refund identities without blindly resubmitting. Full Core suite passed 946 tests; final focused guards and three local browser cases pass after mobile reload/layout correction. Generic Admin refund execution, remaining-refund handling and provider unknown-outcome lookup still prevent complete finance/Phase 1 acceptance.


### 2026-09-08 — Admin refund admission and provider execution (commerce Phase 1 partial)

Admin refunds now invoke Payments after atomic current Global authority, captured payment/version/provider evidence, cancellation exclusion, refund budget, audit and immutable acceptance. AdminRefundRequest requires expectedVersion; AdminPaymentDetail includes refundUnavailableReason. Core submits only the new Refund identity; PayMongo timeout/server/malformed success remains unresolved and reserved. Web validates exact amounts and acceptance, preserves unknown requests and supports exact retry. No schema change.

Evidence: 76 affected Worker tests, 33 final adapter/refund tests, 68 contracts, 10 Web tests, workspace types/lint/static/format, 26 harness tests and Core dry-run build pass. Two managed Web/Core/D1 browser journeys passed at desktop/mobile, including lost response and persisted single Refund/audit, using isolated test-provider configuration. Mobile screenshot inspected. This is not live provider or whole-phase acceptance. Reconciliation identity/amount/state/projection guards, unknown Refund lookup and remaining-balance cancellation remain next; later setup/catalog/warehouse/Scheduled/delivery/membership removal and complete journeys are still pending.


### 2026-09-08 — Guarded payment and Refund observations (commerce Phase 1 partial)

Provider lookups/signed payment observations now validate current provider/reference, exact amount/currency and Payment subject through the whole transition transaction. Lost conditional updates or ignored required effects cannot commit an attempt/reaction/continuation/settlement independently. Same-state capture repairs a missing reaction without a version bump and preserves retained reaction identities. The test provider now returns actual created amount/currency instead of fabricated zero.

Refund ingress constrains provider ownership and unique reference mapping, preserves successful financial evidence under delayed/conflicting events, and atomically updates successful Refund, settlement and Payment totals. Duplicate successful observations recover retained incomplete totals and coordinated Order cancellation before inbox application. No schema or public RPC change. Residual canonical paid-Membership/navigation wording is corrected; active Membership UI/job removal is still pending.

Evidence: full Core 980 tests/166 files pass, followed by 62 focused tests after the retained-key refinement. Workspace types/lint/format/static checks and Core dry-run build pass. No additional browser or live-provider acceptance. Unknown Refund lookup, guarded exception resolution, remaining-balance cancellation and later commerce phases remain open.


2026-09-08 commerce continuation: Refund unknown-outcome recovery now has a typed read-only provider port, bounded Payments scheduler, exact evidence/atomic financial projection and audit, and Global versioned/idempotent Web recheck. No replacement Refund POST is issued by recovery. 112 affected Worker tests, 68 contracts, two Web response tests, desktop/mobile local browser recovery, workspace types/lint/static checks and Core dry-run build pass. Browser verifies queue acceptance, not live PayMongo lookup. Existing schema fields reused; retained databases untouched. Reconciliation-case resolution, remaining-balance cancellation and all whole commerce phases remain open. See COMMERCE_ALIGNMENT_EXECUTION.md for limits and next work.


2026-09-08 financial review continuation: reconciliation resolution now uses current Global authority, expected case version, linked completed financial evidence, required audit and immutable replay; Web supplies guarded recovery and unavailable reasons. Forward 0074 preserves retained case evidence while adding versions. Full Core 1,012/168 files, full Web 374/96 files, 68 contracts, 26 harness, desktop/mobile local browser resolution, migration checks/types/lint/builds pass; final recovery-audit refinement has 28 focused Worker tests. No retained environment migrated or reset and no live-provider acceptance. Remaining-balance cancellation and all whole commerce phases remain pending; see the execution checkpoint.


2026-09-08 remaining-balance cancellation verified: canonical prior successful Refunds now reduce each original/addition member, while fully refunded payments remain in the complete current version/status/identity/balance guard. Pending/uncertain/unfinished refund recovery blocks admission. Customer preview matches remaining value. Historical fee plus prior-refund component ambiguity remains explicit financial review. Zero-balance admission completes Order/cancellation/release/required audit/frozen receipt atomically, without another Refund. Registered cancellation recovery can complete retained accepted zero-refund intents in legal Order states; the existing domain notification reconciliation projects persisted completion after interruption.

Evidence: final 44 focused Worker tests pass across cancellation and customer detail, including real Refund request/read-only provider-observation recovery, original plus additions, full prior refund, lost completion audit rollback, concurrent prior refund, registered legacy recovery and customer preview. Earlier affected Admin run passed 60 tests before the final validation/source-identity refinement. Six local Web/Core/D1 browser cases pass at 1440/390 for zero/partial/full prior refunds, lost response and identical replay (2.5 minutes). Mobile completed screenshot inspected. Browser fixture prior financial states are explicit test seams, not provider acceptance. Workspace types/lint/format/naming/architecture/readiness, diff check and Core dry-run build pass; browser setup executes Web build. Logs: remaining-cancellation-final-worker.log, remaining-cancellation-browser.log, remaining-cancellation-core-build.log. No schema change or retained DB reset/migration. Whole phases remain open.


Final payment lookup slice: full Core passed 1,027 tests in 169 files (265.80 seconds); 16 focused Worker/scheduling tests, 374 Web tests, 68 contracts and 26 harness tests pass. Types/lint/format/naming/architecture/readiness, fresh/populated migrations, retained Payment identity preservation, Core dry-run and Web build pass. Final browser desktop/mobile run passed both cases in 2.0 minutes with zero retries: new lookup and exhausted lookup recheck, lost response, identical saved body/key replay, versioned acceptance, current progress/audit after reload and no overflow. Mobile screenshot inspected. First browser setup timed out before tests; subsequent complete runs passed under the unchanged startup limit. Logs: payment-lookup-full-core.log, payment-lookup-worker.log, payment-lookup-web-tests.log, payment-lookup-browser-final.log, payment-lookup-core-build.log, payment-lookup-harness.log.

0075 is authored/tested only. New Core/Admin RPC recheckAdminPayment uses current Global payments.manage and both expected versions, guards active lease/state/audit/receipt, and only queues read-only recovery. Exhaustion is a visible reviewed condition, never financial failure or authority to charge again. Existing databases remain untouched. No whole commerce phase or provider acceptance is claimed. Continue the confirmed creation-persistence guard/missing-reference recovery defect, then the remaining authorized phases; external account capability/operational inputs remain final activation gates.


Final creation adoption evidence: full Core passed 1,032 tests in 169 files (266.27 seconds). The final focused four-suite run passed 46 Worker tests; earlier overlapping creation/reconciliation/lookup/commitment run passed 54. Covered ignored Payment/Attempt/continuation/audit effects, immutable receipt, concurrent same-key adoption, identical continuation replay, and actual registered 15-minute provider lookup after lost local persistence, with one provider create. Types/lint/format/naming/architecture/readiness, clean/populated migrations and Core dry-run build pass. No new Web/RPC or browser/provider acceptance; prior browser evidence remains separate. Logs: payment-creation-regression.log (expected negative proof), payment-creation-final-worker.log, payment-creation-full-core.log, payment-creation-core-build.log. 0076 is authored/tested only; retained deployments untouched.

Next confirmed Phase 1 recovery gap: listDueInbox only selects RECEIVED/RETRY_REQUIRED, so a verified event marked RECONCILIATION_REQUIRED with INTENT_MAPPING_AMBIGUOUS or REFUND_UNMAPPED cannot recover automatically when the mapping appears. Unmapped Payment cases also retain null linkage, preventing later finance resolution. Repair narrowly bounded replay of mapping-related exceptions and guarded case association after verified application; do not reopen mismatched financial/illegal-transition or exhausted cases indiscriminately. Continue setup and remaining authorized phases after correctness dependencies. Unknown creation with no durable provider reference and historical case-only linkage remain explicit evidence limitations; never resubmit blindly.


2026-09-08 provider inbox recovery in progress after 081a1aa: mapping-only INTENT_MAPPING_AMBIGUOUS/REFUND_UNMAPPED exceptions now remain due within bounded replay. Lease claims durably consume attempts before application; both ingress and scheduled claims enforce ten attempts and 24-hour age. Expired final leases escalate without an eleventh application. Per-event application failure retains controlled retry and allows other due events to run. APPLIED/DUPLICATE evidence cannot be downgraded by late failure. Scheduled replay validates signature-verification evidence, normalized provider/event/hash, exact money and settlement before application. Verified unique mappings link previously unlinked matching reference cases through versioned required-audit transactions; cases remain OPEN. Failed association retries after canonical financial work without repeating it.

Evidence: 45 focused Worker tests passed before the final shared-claim bound; final 54 Worker tests across inbox, Refund and registered scheduling pass. Tests include real signed early Payment/Refund callbacks during provider creation, later mapping recovery, ignored required case-link audit rollback, abandoned final lease, repeated application failure with healthy queue progress, terminal preservation and malformed/unverified replay rejection. Types/lint/naming/architecture/readiness and diff checks pass. Full Core suite still running in provider-inbox-full-core.log; no result claimed yet. No schema/RPC/Web change, retained DB migration/reset, browser or live provider acceptance.

Next: inspect full suite, build/diff review and commit this slice. Exhausted inbox operator recovery is still missing and exhaustion cases can be unlinked; add a guarded, versioned, audited action and observable Web workflow without treating a reason as financial evidence. Continue remaining Phase 1 and all authorized commerce phases; no whole phase accepted.


Final provider inbox recovery evidence: stable full Core run passed 1,042 tests in 169 files (261.75 seconds). Final focused run passed 54 Worker tests. Types/lint/format/naming/architecture/readiness, diff check and Core dry-run build pass. Logs: provider-inbox-full-core-final.log, provider-inbox-final-worker.log, provider-inbox-core-build.log. The earlier mixed-source run failed the newly added retry-limit assertion; no checks were weakened. No schema/RPC/Web changes or new browser/provider acceptance. Retained databases untouched. This completes the bounded mapping-recovery slice only; whole commerce phases remain open. Continue guarded exhausted-event operator recovery and pending-inbox case-closure validation, then remaining authorized phases.


2026-09-08 provider inbox closure guard: shared Payments resolution eligibility now excludes pending/retry/reconciliation inbox work linked through current provider attempts or the case provider/event identity. A terminal Payment cannot hide unapplied event work. Worker test reaches FAILED through real provider lookup, seeds an explicit retained inbox seam, verifies closure rejection, then executes actual redrive and successful resolution. Added transaction-time inbox arrival test proves no partial closure/audit/idempotency result. Forty affected Worker tests pass across resolution, inbox and Admin finance; workspace types/lint/naming/architecture/readiness and diff checks pass. Log: inbox-resolution-worker.log. No schema/RPC/Web change or new browser/provider acceptance. Prior full 1042-test result belongs to f9f6922 before this focused refinement. All phases remain open; continue exhausted-event operator recovery.


IN PROGRESS after d069d98: 0077 adds nullable provider inbox recovery_started_at without changing original received_at. Payments retryProviderEvent requires Global payments.manage, current case version, exact verified financial event, exhausted state, no active lease, reason/key; case version, new bounded window/attempt reset, prior-attempt audit and frozen receipt share one guarded batch. Scheduler/ingress age bounds now use explicit recovery window or original receipt time. Exact replay retains receipt even after application; rejected authority/lease/evidence/transaction writes roll back. Verified application now links formerly unlinked exhausted-event cases by exact provider/event identity, leaving OPEN.

Typed retryAdminProviderEvent RPC/Admin wrapper/Web route and reconciliation-card retry component are wired. Read model validates private normalized evidence but exposes only progress/eligibility; UI retains exact body/key after unknown response. Six new command tests plus existing inbox/closure tests pass (28 Worker tests total), including old event recovery, concurrent retries, audit rollback, revoked replay, current lease/evidence changes and case linkage. Types/lint/naming/architecture/readiness and clean/populated migration checks pass. Upgrade verifier explicitly seeds retained exhausted event and compares all original columns/row identity; new recovery timestamp remains NULL.

Managed browser tests/provider-event-retry.spec.ts is currently running at 1440/390 with session 66654 and provider-event-retry-browser.log. Source freeze until it completes. No browser acceptance yet. Only named disposable e2e-commerce-alignment-20260907 state is reset; retained DBs untouched. No commit/phase acceptance. Pending: browser outcome/visual review, test missing required audit specifically (current forced batch rollback is broad), review replay-window boundedness and normalization guards, contracts/Web affected tests, final builds/static/diff checks, canonical docs and status. Then continue all authorized phases.


Final reviewed provider-event retry slice: 57 affected Worker tests pass in five suites, including eight new retry tests, ignored mandatory audit rollback, exact 24-hour reviewed-window expiry, old receipt replay, competing/revoked requests, transaction-time lease/evidence/authority changes and exhausted-case association. 68 contract tests, 374 Web tests, types/lint/format/naming/architecture/readiness, clean/populated migrations and Core dry-run build pass. Browser passed both 1440/390 cases in 2.4 minutes with zero retries: actual Web/Core/D1 queue acceptance, lost response, identical body/key replay and persisted progress after reload. Mobile screenshot inspected without overflow. Browser proves queue acceptance; Worker tests execute the actual redrive. Live provider acceptance remains separate. Final Core-only receipt/window snapshot guard was checked in the 57-test run after browser completion.

Logs: provider-event-retry-final-worker.log, provider-event-retry-browser.log, provider-event-retry-contracts.log, provider-event-retry-web-tests.log, provider-event-retry-migrations.log, provider-event-retry-core-build.log. 0077 authored/tested only; no retained DB migration/reset. New RPC retryAdminProviderEvent and safe optional providerEventRecovery read projection are documented canonically. A queued retry does not resolve a case or repeat provider creation. No whole commerce phase accepted; reassess remaining Phase 1 call paths, then continue setup and all remaining authorized dependencies.


IN PROGRESS reaction retry after ee91e64: Payments retryPaymentReaction now validates Global payments.manage, case and Payment expected versions, exact commerce reaction subject/type/purpose, canonical SUCCEEDED, no active/successful/unfinished refund exposure, current ESCALATED state/attempts and expired lease. Case version, PENDING/reset budget, prior-attempt audit and frozen receipt are guarded atomically. Typed retryAdminPaymentReaction RPC/Admin read projection/Web route/card are wired; unknown responses preserve body/key. No schema change. Reaction escalation now guards required case and audit, and recognizes benign concurrent successful application.

31 focused Worker tests pass: real Instant quote/two-pool workflow with explicit captured-payment fixture, actual injected commitment failure/escalation, direct authenticated Core retry and actual applier success once; plus real createPayment/provider lookup followed by retained exhaustion-count fixture, command races/revocation/refund reservation/retired membership rejection/transaction-time payment version, lease, authority and ignored audit. Types/lint/naming/architecture/readiness pass.

Runtime source freeze: managed browser tests/payment-reaction-retry.spec.ts is running (session 87936, reaction-recovery-browser.log), and full Core suite is running (97223, reaction-recovery-full-core.log). Contracts/Web aggregate tests session 55214. No new browser/full-suite success yet. Only named disposable browser state reset; retained DBs untouched. Next inspect all results, mobile screenshot, final docs/build/diff, commit. Pending beyond retry: explicit finance-reviewed compensation completion for fully refunded uncommitted reactions, preserving actual Refund evidence and no fabricated Order/reaction success; then remaining Phase 1/setup and all authorized phases.


Final reviewed reaction retry evidence: full Core passed 1,062 tests in 171 files (379.88 seconds). Focused 31 Worker tests, 68 contracts, 374 Web tests, types/lint/format/naming/architecture/readiness, Core dry-run and Web build pass. Browser passed both widths in 2.5 minutes with zero retries and mobile visual inspection. Logs: reaction-recovery-full-core.log, reaction-recovery-worker.log, reaction-recovery-contracts.log, reaction-recovery-web-tests.log, reaction-recovery-browser.log, reaction-recovery-core-build.log. No schema change in this slice, retained database mutation or live-provider acceptance. New retryAdminPaymentReaction uses the existing commerce appliers; a missing Quote remains an exception. Reaction escalation now cannot persist without its required case and audit. Whole phases remain open; continue refunded uncommitted cleanup/compensation and recovered exception projection, then setup dependencies and all authorized phases.


2026-09-08 commitment financial-race repair after e6accad: reproduced three Instant defects in actual Worker/D1 batch interception: after prevalidation, a REFUNDED Payment, changed reaction subject or newly reserved Refund still produced applied:true. Reproduced amendment commitment after Payment version change or reserved Refund. Checkout now checks matching reaction before replay and atomically guards Payment version/purpose/subject/customer/money/captured state, reaction PENDING identity and no active/successful/unfinished refund exposure before dependent effects; final reaction update is also guarded. Amendment applies the same current financial/refund checks and exact reaction binding. No database policy triggers or schema changes.

47 affected Worker tests pass across Instant, Scheduled checkout, paid amendments and reviewed reaction retry. Types/lint/naming/architecture/readiness and diff checks pass. Negative proof logs: commitment-financial-race-regression.log (3 expected failures), amendment-financial-race-regression.log (2 expected failures). Passing log: commitment-financial-guard-worker.log. The earlier full 1062-test/browser evidence belongs to e6accad; this Core-only refinement has focused Worker verification, no new browser/provider claim. Continue refunded uncommitted cleanup/compensation and recovered exception projection, then setup and remaining phases.


Refunded commitment continuation: final focused run passed 56 Worker tests across Instant, amendments, financial resolution and Admin finance. Added protection for another active quote payment (holds and ACTIVE Quote preserved), actual paid-addition creation/payment/provider refund/lookup followed by failed-addition closure without changing original Order/demand, and retained FAILED reaction cleanup. Legacy capacity cleanup now guards missing balance, underflow and ignored balance update in the composed transaction. All 374 Web tests pass; types/lint/naming/architecture/readiness pass.

Managed browser tests/refunded-commitment-resolution.spec.ts is running in session 50249, log refunded-commitment-browser.log; hold source fixed until completion. No browser result yet. Canonical API/state/domain now describe explicit CONFIRM_REFUNDED_COMMITMENT under the existing versioned Global refunds.manage resolution action. No new schema/RPC or retained DB mutation. Pending: browser result/mobile inspection, contracts result, final build/format/diff review and commit. Then repair recovered finance_exception projection after successful commitment and remaining Phase 1/setup; all phases remain open.


2026-09-08 refunded commitment slice verified: 56 affected Worker tests, 68 contracts, 374 Web tests, types/lint/naming/architecture/readiness, Core dry-run build and format/diff checks pass. Both managed browser journeys passed at 1440/390 in 2.6 minutes, including explicit confirmation, lost response/exact replay, resolved-case removal after reload and mobile visual inspection. Added three retained Scheduled-capacity compatibility scenarios through the Checkout-owned transaction helper: release once/replay, ignored balance update rollback and underflow rollback; all eight tests in abandon-checkout-attempt.integration.test.ts pass. This helper fixture is retained compatibility evidence, not an active Scheduled capacity workflow. Logs: refunded-commitment-final-worker.log, refunded-commitment-contracts.log, refunded-commitment-web-tests.log, refunded-commitment-browser.log, refunded-commitment-core-build.log, refunded-capacity-worker.log. No schema/RPC addition, retained database mutation or live provider acceptance. No whole phase accepted. Next: recovered finance_exception projection after successful commitment, then remaining commerce dependencies.


2026-09-08 after 2a471b9: fixed successful commitment exception projection. Orders now requires the exact committed Order/payment/reaction/quote relationship before resolving matching finance_exception rows and writing one stable ORDER.COMMITMENT_RECOVERED audit per exception. New commitment includes this in its transaction; replay and existing versioned Global financial-case resolution repair retained stale projections. Late failure diagnostics cannot create an exception after a matching committed winner. 53 affected Worker tests pass, including actual failed commitment/reviewed retry/redrive, retained projection seam through authenticated Core resolution, ignored audit/projection rollback and replay without duplicate Orders/audits. Types, architecture and readiness pass. No schema/RPC/Web change or new browser/provider claim. Log committed-exception-final-worker.log. Final late-diagnostic guard validation pending; all commerce phases remain open. Next checkout abandonment financial race/terminal cleanup, then remaining setup and commerce dependencies.

Final successful-commitment projection verification: all 53 affected Worker tests pass after the late-diagnostic guard; lint and diff checks pass. No retained data changed. Ready to commit this slice and continue checkout abandonment.


IN PROGRESS after pushed 6830004: reproduced abandonment admission race (Worker test returned ok:true after concurrent INITIATED Payment). Reworked abandonCheckoutAttempt into one guarded transaction: current active Customer/owned Quote/version, financial exclusion including committed link, exact held count, idempotency claim, shared Checkout entitlement release, required CHECKOUT.ABANDONED audit and frozen result. Expired/superseded Quotes release residual holds with the same financial guards. Same-key recovery after ignored required effects and competing-key serialization tested. Renamed release-refunded-checkout.ts to release-uncommitted-checkout.ts for reuse; reviewed refunded completion still passes. No schema change. 57 Worker tests pass across abandonment, real Instant quote creation-to-release and commitment/refund recovery. Types/lint/naming/architecture/readiness pass. Negative log abandon-payment-race-regression.log; positive abandon-guard-worker.log.

Web now awaits release before changing address/window/promotion or replacing the Quote; unknown release retains exact quote/body/key and retry, and concurrent payment confirmation is blocked while release is in flight. Promotion entry awaits acceptance before claiming the code was added. Focused Web tests including lost-response retry pass. Managed browser checkout-abandonment.spec.ts currently running in session 83362, log abandon-browser.log; runtime source frozen until completion. Browser uses real auth/cart/address/quote/release with explicit operational stock/readiness setup and mock delivery pricing; only named disposable e2e-commerce-alignment-20260907 is reset. No new browser/provider acceptance yet. Pending browser diagnostics/visual review, aggregate affected Web/contracts and final checks, then commit and continue remaining Phase 1/setup. No phase accepted.

Browser configured acceptance: both 1440/390 journeys passed with zero retries in 2.5 minutes (abandon-browser-configured.log), using real local authenticated Web/Core cart/address/quote/abandon commands, mock provider fee and explicit operational stock/pickup setup. Unknown release response preserves the Quote, and exact body/key replay returns the original one-hold release. Mobile screenshot inspected; no horizontal overflow. Existing membership banner/customer provider labeling remain known later alignment work, not accepted UX.

Moved the four PayMongo unknown-creation tests to payment-creation-outcome.integration.test.ts to isolate their pending fixtures from the older bounded scheduler test. All 37 payment creation/adapter tests now pass without changing the scheduler assertion. Added explicit 422-rejection coverage before starting the fresh standalone full Core run, session 41645, commerce-recovery-full-core-final.log. Keep runtime/test source fixed until completion. Latest full Web 376/96, contracts 68/19, types/lint/format/static gates pass; whole commerce phases remain open. No retained DB migration/reset/provider call/deployment.

Final current recovery verification: standalone full Core passed 1092 tests in 172 files (418.62 seconds), commerce-recovery-full-core-final.log. This includes explicit PayMongo 422 rejection plus four unknown-response cases, corrected scheduling identities and checkout/refund recovery. Full Web 376 tests, contracts 68, types/lint/format/naming/architecture/readiness and Core dry-run build pass. Managed checkout browser passes both widths in 2.5 minutes with actual Web/Core commands, injected lost response and stable replay; mock delivery and synthetic pickup/stock are documented setup, not live provider acceptance. Native-crashed earlier full run is not counted as passing. No schema change, retained DB mutation or deployment. Save the slice on main, then continue missing setup/identity workflows and remaining commerce dependencies; no whole phase accepted.

Read-only next findings: createPayment currently replays an unresolved INITIATED/no-provider-reference intent as ok:true/action NONE, producing a misleading browser pending message; preserve unresolved failure on that replay. Existing staff invitation acceptance needs current verified-email validation in the batch and guards for every required staff/grant/audit effect. A clean installation lacks initial Global administrator enrollment; implement configured owner identity plus verified sign-in, one-use durable grant/audit and explicit roles/scopes, never infer the owner from Git or widen existing staff access. Actual configured owner identity is a deployment input.

2026-09-08 after pushed 0f34b40: reproduced four unknown-creation replays returning success/action NONE, then fixed createPayment replay to retain PAYMENT_OUTCOME_UNRESOLVED while the original intent remains INITIATED after recovery. No second provider call or fake ready action. All 20 affected Worker tests across payment creation/unknown outcome and commerce flow pass, as do types/lint. Negative log payment-unknown-replay-regression.log; positive payment-unknown-replay-worker.log. Earlier full 1092-test evidence belongs to 0f34b40; this refinement has focused verification. No schema/RPC/UI change or new browser/provider claim. Continue setup/access dependencies; whole-phase acceptance remains open.

2026-09-08 staff invitation acceptance hardening: Core now rechecks the current verified authentication email inside the batch, claims idempotency atomically, and requires every staff identity, role, scope, audit and successful receipt write. Suppressed required effects roll back the invitation and all access; retained PROCESSING/FAILED claims with identical intent recover safely. Current identity changes reject before grants. No new schema/RPC or retained database mutation.
Validation: 28 staff Worker/D1 tests; 12 Web adapter tests; workspace types/lint, changed-file formatting, naming/architecture/readiness checks pass. Managed browser admin-staff-access.spec.ts passed all seven tests with zero retries in 2.9 minutes, including actual role/invitation creation, authenticated acceptance, lost-response identical-key retry, local-reader denial and desktop/mobile review. Mobile screenshot inspected. Auth verification and initial manager grants use explicit isolated test fixtures; email/provider delivery and initial Global setup are not accepted. Logs staff-acceptance-final-worker.log and staff-acceptance-browser.log. The added retained-claim test initially used the creation DTO for a missing version; corrected it to read the actual invitee offer and reran successfully. Continue initial administrator setup and remaining plan dependencies; no whole commerce phase accepted.
2026-09-08 initial administrator setup verified: complete local Web/Core workflow at /setup, configured verified identity, immutable one-use evidence (migration 0078), explicit non-membership Global grants, atomic required effects and replay after configuration removal. Added another-account Global-scope race rejection and Worker retained-upgrade empty-setup check. All 19 focused setup/conformance/upgrade tests pass. Standalone full Core passed 1116 tests / 173 files in 434.15 seconds (initial-admin-full-core.log); full Web 376 / 96, contracts 68 / 19, harness 26, migrations, types/lint/format/naming/terminology/architecture/readiness and both builds pass. Managed browser initial setup passed with zero retries in 2.8 minutes: desktop/mobile access review, wrong-account denial, lost-response exact replay and real Staff administration without seeded Staff grants. Mobile screenshot inspected. Email verification is an explicit test fixture, not live delivery or OAuth acceptance. No retained DB upgrade/reset/deployment; real initial owner configuration remains a deployment input.
Next within alignment Phase 2: harden older staff role/invitation administration, which still has pre-read-only authority and incomplete required-effect guards, before complete onboarding acceptance. Then customer invitation/profile/closure intake and remaining location/cycle setup. Prior invitation acceptance is preserved; do not restart that fix. No whole commerce phase accepted. Continue all authorized plan phases.
2026-09-08 staff creation verification complete: all eight combined initial setup/staff browser journeys passed with zero retries in 2.8 minutes (staff-creation-browser.log). This exercises the current guarded role/invitation commands and verified acceptance/replay at desktop/mobile widths. Fifty-seven Worker tests, types/lint/format/naming/architecture/readiness and Core dry-run build pass. Earlier full 1116-test Core evidence belongs to c1de93f; this incremental creation change has focused verification. No schema/RPC changes or retained DB mutation. Continue versioned atomic invitation revocation and remaining staff lifecycle commands, then customer and location/cycle setup; no whole phase accepted.
2026-09-08 staff invitation revocation verified: current Global authority, reviewed version, transition, audit and original receipt are guarded in one transaction. Acceptance/revocation races have one winner; ignored required effects roll back and retry safely. Legacy successful receipts remain readable. Staff UI preserves the exact unconfirmed request through explicit retry, including after editing the reason. All 63 affected Worker tests, 17 Web adapter tests, 68 contracts and 376 full Web tests pass; nine managed browser journeys passed with zero retries at desktop/mobile widths. Types/lint/format/naming/architecture/readiness, Core dry-run build and diff checks pass; managed browser performed the Web build. Logs staff-revocation-final-worker.log, staff-revocation-browser.log and staff-revocation-core-build.log. No schema or retained database changes, no live provider acceptance. No whole phase accepted. Next: remaining staff lifecycle atomicity, customer setup, location/cycle setup and later authorized phases.

2026-09-08 staff lifecycle slice verified: 54 affected Worker tests, 381 Web tests, types/lint/format/naming/architecture/readiness and Core dry-run build pass. All nine managed staff browser journeys passed with zero retries in 2.9 minutes, including real invitation acceptance then rename, suspension/lost response/exact retry and reactivation at 1440/390 widths; mobile screenshot inspected. Managed stack performed Web build. Logs staff-lifecycle-final-worker.log, staff-lifecycle-web.log, staff-lifecycle-browser.log and staff-lifecycle-core-build.log. No schema/RPC changes, retained database changes or live provider acceptance. No whole phase accepted. Continue role/scope/session command guards and full setup acceptance, then all later authorized phases.

2026-09-08 role/scope assignment slice verified: all nine managed browser journeys passed with zero retries in 3.0 minutes after correcting the click action; both widths preserve an off-page assigned role through a real limit-one picker, retry the exact lost role update and change Global/location scope through Core. Mobile screenshot inspected. 73 affected Worker tests plus retained-snapshot compatibility selection, 68 contracts, 381 Web tests, types/lint/format/naming/architecture/readiness and Core dry-run build pass; managed browser performed Web build. No migration/retained DB change or provider acceptance. Complete AdminStaffDetail.roleIds is the only contract addition. No whole phase accepted; continue session revocation/role definitions and remaining setup/commerce.

2026-09-08 role/session slice verified: 85 affected Worker tests, 381 Web tests, types/lint/format/naming/architecture/readiness and Core dry-run build pass. The combined managed startup exited before tests without a useful cause. Its Web build passed; separately reran named disposable-state preparation and all 78 migrations successfully, started the exact configured vinext/Core test topology, then ran the same nine browser tests with E2E_AUTHENTICATED=1 and APP_BASE_URL=http://localhost:3100. All nine passed with zero retries in 1.1 minutes; desktop/mobile form role creation, capability selection, invitation/assignment/lifecycle, lost session response/exact replay, actual invitee logout, role rename/capability/archive recovery. Mobile archived-role screenshot inspected. Test runtime session 15582 stopped after completion. Logs staff-role-session-final-worker.log, staff-role-session-web.log, staff-role-session-startup.log, staff-role-session-runtime.log, staff-role-session-browser-final.log, staff-role-session-core-build.log. No retained database migration/reset, schema/RPC addition, provider acceptance or whole-phase acceptance. Continue remaining setup UX/customer onboarding/operational configuration and later commerce phases.

2026-09-08 customer provisioning slice verified: full Core 1155/173 passed (440.68s), types/lint/format/naming/architecture/readiness and Core dry-run build pass. Both managed checkout browser journeys passed with zero retries in 2.5 minutes, exercising real authenticated first cart/address access, quote/hold creation and lost-response release recovery at 1440/390. Operational stock/readiness are explicit disposable fixtures and delivery pricing uses the configured test adapter; this is not provider acceptance or full setup acceptance. Web build ran as part of managed setup. No schema/RPC/Web source change or retained DB mutation. Continue verified customer invitation creation/acceptance/revocation and remaining customer/setup/commerce work; no whole phase accepted.

2026-09-08 customer invitation workflow verified after 66f5bdb: added verified-identity offer/acceptance RPCs and Web page, plus versioned Global revocation and the operator invitation queue. Acceptance composes first-access provisioning with current verified email, expiry, pending version, active customer access, required audits and frozen receipt in one transaction. Creation/revocation now guard current Global customers.manage authority and all effects; legacy creation reference receipts remain readable. Exact replay, distinct-key races, acceptance/revocation races, withdrawn verification, expiry boundaries and ignored required writes are covered. Operator creation/revocation and customer acceptance retain exact unconfirmed bodies/keys; queue pagination is exercised with one-row pages. Shared Web command hook renamed use-admin-command for its actual Staff/Customer consumers.
Validation: 41 focused real Worker/D1 tests in three files (customer-invitation-race-worker.log); 385 Web tests, 68 contracts, types/lint/format/naming/architecture/readiness passed. Final managed browser run: six tests passed, zero retries, 2.8 minutes, including desktop/mobile creation, acceptance and revocation after lost responses and paginated review (customer-invitation-browser-final.log). Mobile customer page inspected. Core dry-run build passed; managed run built Web and created/migrated only named disposable e2e-commerce-alignment-20260907. No new schema/migration, retained database changes, live email/provider acceptance or whole-phase acceptance.
Next: customer access/session command atomicity and replay, remaining profile/support and privacy-policy boundaries, invitation notification delivery, then location/cycle setup and all later authorized phases. Invitation email delivery remains explicitly unavailable in the operator UI; creation is not presented as email delivery. Normal customer self-registration is independent of invitation acceptance.
2026-09-08 customer access/session administration verified after a0ff070: reproduced both old commands returning success when required audit insertion was ignored (customer-access-regression.log, two failing tests). Replaced them with current Global customers.manage admission, in-transaction claims, required complete effects/audit/receipts and original-result replay. Access changes guard the exact Customer/principal identity, state and positive version; both writes and the frozen committed-order summary are atomic. Session revocation guards target identity/version and the reviewed complete session set; a concurrent login rejects before deletion, and successful replay preserves later logins. Legacy reference/count receipts remain readable. Web detail uses the shared exact-request retry hook and validated BFF payloads. Customer audit history now follows Customer/accepted-invitation/privacy resource ownership, showing staff actions while excluding unrelated actions authored by a staff user who also has a Customer.
Validation: 53 focused real Worker tests passed (customer-access-audit-worker.log), 389 Web tests passed, types/lint/format/naming/architecture/readiness and Core dry-run build passed. Six managed browser tests passed with zero retries in 2.7 minutes (customer-access-browser-final.log): desktop/mobile invitation journey followed by lost-response disable/restore/session revocation, actual address denial/restoration, actual sign-out, and visible staff audit rows. Mobile layout inspected. Web build and disposable database setup were executed by the managed harness; retained databases were untouched. No schema change, live provider acceptance or whole-phase acceptance.
Next: remaining customer profile/support/closure work, invitation notification delivery, location/cycle administration and later authorized commerce phases. Notification muting policy was asked asynchronously: mandatory transactional emails versus customer-muted transaction updates remains unanswered; continue independent work without inventing that policy. Retention/irreversible anonymization and actual provider/account activation remain external acceptance inputs.
2026-09-08 closure recovery verified after 19f5d51: reproduced COMPLETED closure leaving customer commerce access active (customer-closure-regression.log). Privacy creation and lifecycle commands now recheck current Global customer authority and Customer identity/version, require all writes/audits/receipts in one transaction and replay original results before later state rejection. CLOSURE completion atomically disables the principal, advances Customer version, revokes the reviewed session set and records distinct closure/action audits. A later explicitly authorized restoration is preserved on closure replay. Existing historical completed requests are not backfilled with invented effects. ANONYMIZATION completion is rejected until approved retention/field policy exists; ACCESS/CORRECTION remain explicitly manual-response tracking, not implemented export or arbitrary field updates. Added Core availableActions and exact-customer filtered privacy reads, a customer-detail privacy panel, validated BFF bodies and guarded customer-detail read generations.
Validation: all 1210 Core tests in 173 files passed standalone in 377.34 seconds (customer-onboarding-full-core.log). Focused privacy/CRM tests passed (61 plus corrected competing-winner assertion rerun); 389 Web tests and 68 contracts passed; types/lint/format/naming/architecture/readiness and Core dry-run build passed. Six managed browser journeys passed with zero retries in 2.7 minutes (customer-closure-browser.log), including desktop/mobile identity review, approval, processing, lost-response closure completion, actual sign-out and visible closure audit. Mobile layout inspected. Managed tests built Web and used only the previously identified disposable database. No schema or retained database change, live provider acceptance or whole-phase acceptance.
Next: preferred-language profile editing and author-attributed append-only support notes with a retained-safe forward migration; invitation notification delivery; location/cycle setup; remaining catalog, warehouse, purchasing, preparation/delivery, membership-removal and final journeys. Notification muting policy is still unanswered; leave that dependent behavior pending and continue independent implementation. All sessions from this checkpoint are complete/stopped.
2026-09-08 customer preferences verified after 0f0948e: owner answered that transaction updates always send and promotions are optional. Canonical decision/domain/API records updated. Migration 0079 adds only nullable preferred_language and promotional_emails (0/1, no recorded opt-in by default), preserving old columns/rows. Authenticated profile read provisions through the existing guarded resolver; profile updates never provision on rejection and atomically require active identity/version, preference write, sanitized audit and frozen replay receipt. The account preferences page retains exact unknown requests and supports language edits and promotional opt-in/withdrawal. No transaction mute setting exists. Corrected stale Product Scope text to reflect implemented closure controls while retaining the anonymization policy gate.
Validation: 70 focused Worker/D1 tests including retained-0068 forward upgrade passed; populated-0078 upgrade verifier preserves every retained column/row and tests new bounds. Migration, types, lint, conventions, architecture, readiness, formatter, 26 harness tests, 68 contract tests and 389 Web tests passed. Two managed desktop/mobile browser journeys passed with zero retries (customer-preferences-browser.log), including lost-response exact replay, persisted edits and opt-out; Web production build and Core dry-run build passed. First Worker run exposed an overly broad test count (other test receipts); narrowed to the tested request/customer. Initial migration verifier assumed no future columns after 0078; split its old-migration check and added full retained-column preservation for 0079. No retained database was migrated/reset, no live messages/provider calls, no whole-phase acceptance. Next: Global profile editing and append-only staff support notes, invitation delivery, then remaining setup and commerce phases. Notification policy no longer blocked.
2026-09-08 Global profile/support slice verified after 12465ef: Global customer readers get profile and bounded exact-customer support-note pages; managers can reasonedly change approved preferences with expected Customer version and append notes. Current Global authority, all required writes/audits and frozen replay results share the complete transaction. Notes append independently without advancing Customer version, retain stable staff identity plus creation-time display name, and have immutable update/delete protection in migration 0080. The customer workspace shares its existing unknown-request controller across access/privacy/profile/notes, prevents paging from silently changing a draft's expected version, and displays loading/errors/empty/history states. Browser testing reproduced a valid long-email customer search crashing on D1 LIKE limits; literal case-insensitive instr matching fixes it and treats wildcard characters literally.
Validation: 83 customer Worker tests passed after the search fix; retained upgrade Worker test also passed in the preceding 82-test run. Coverage includes Global/local/customer denial, ignored writes/audits/receipts, lost authority before commit, same/distinct-note races, immutable author evidence, wrong foreign key, bounded inputs, customer-vs-staff profile race and search regression. Migration verification, types/lint/format/naming/architecture/readiness, 68 contracts and 389 Web tests passed. The combined browser run passed eight existing customer journeys and exposed the two new search failures; after reproducing/fixing the defect both new desktop/mobile support journeys passed with zero retries (customer-support-browser-final.log). These verify profile visibility to the customer, lost-response exact retries for profile/notes, paginated notes and mobile layout; screenshot inspected. Web build and Core dry-run passed. No retained database was migrated/reset and no live email was sent. Phase 2 remains incomplete.
Next: invitation delivery through durable notification intent, first correcting ambiguous email-error retry and atomic send-attempt evidence. Email skill read; read-only wrangler email sending list confirms an enabled domain in the account, and existing EMAIL binding remains configured. Actual FreshMarkets sender/domain acceptance is still a deployment/provider check. No email implementation edits yet. Continue remaining location/cycle, catalog/media, warehouse, purchasing, delivery, membership removal and final acceptance work.
2026-09-08 notification recovery verified: full standalone Core suite passed all 1243 tests in 173 files in 343.83 seconds (customer-notification-full-core.log); Core dry-run build also passed (notification-send-core-build.log). Earlier 19 focused notification tests and static/type gates passed. No browser/provider acceptance is claimed for this internal send-recovery change. Session 74198 completed. Continue by implementing the drafted retained-safe invitation outbox migration and full invitation intent/status/link flow; draft remains external until that step begins.