# FreshMarkets Implementation Status

Status date: 2026-08-31. This file is descriptive evidence only. The canonical documents named in
`AGENTS.md` remain authoritative.

## Architecture and security hardening (2026-08-30)

- Shared contracts are decomposed by bounded context and paired with an exhaustive 136-method
  runtime manifest. Core conformance tests prove the implemented Service Binding surface exactly;
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
  provider code/capabilities, and renewal initiation. Structured telemetry redacts sensitive
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

- The approved Admin screen inventory is implemented through the typed Web-to-Core Service Binding: Core-authorized hierarchical navigation; Catalog Product and Category list/create/detail/edit/lifecycle; canonical R2-backed Product media administration; complete Order and Payment workspaces; and the existing Customer/Privacy, Membership, Promotion, Inventory, Procurement/Receiving, Fulfillment, Delivery, exception, Analytics, Staff/Role, Audit, and fulfillment-mode surfaces.
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

## Runtime and persistence reliability remediation (2026-08-30)

- The populated `0020 -> 0021 -> current` migration path now preserves commerce history and foreign-key integrity; the verifier exercises that real pre-`0021` boundary as well as fresh, Analytics, and cart/inbox upgrade paths. Retired inventory triggers remain absent.
- Core and Web parse one closed typed runtime configuration. Unknown deployed environments, insecure origins, weak/missing auth secrets, incomplete OAuth pairs, unapproved payment adapters, and renewal ownership without a provider fail closed.
- Migration `0046` deterministically reconciles duplicate active carts, enforces one active cart per customer, and adds provider-inbox normalized observations, retry availability, and conditional leases. Cart mutation is idempotent and version guarded; missing SKU/price is explicit and never displayed as zero.
- Provider events persist no raw webhook body. Webhook delivery and scheduled redrive share one normalized, leased application path; expired leases are reclaimable, bounded exhaustion creates one reconciliation case, and resumable provider actions have an every-minute expiry sweep.
- Renewal initiation is disabled by default behind the explicit runtime ownership gate. Confirmed outcome application, dunning, and grace expiry continue while initiation is disabled.
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
- Every launch SKU carries positive versioned Metro Cebu STANDARD pricing and Cebu Central
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
- Web adds eight thin BFF adapters and the Customers workspace (list/search + invite, detail with
  access/session/closure actions and audit table, privacy queue with per-status legal actions).
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
- Migration `0049_payment_settlement_observations.sql` records immutable provider-neutral gross,
  processing-cost, withholding, adjustment, and net observations only after verified exact
  arithmetic and Payment/Refund amount/currency agreement. Actual provider processing cost remains
  separate from the customer-facing FreshMarkets Service Fee.
- Paid Order commitment aborts atomically on a lost Quote or Scheduled-capacity compare-and-swap,
  recording stable finance exceptions. Refund requests reserve captured value with one guarded
  insert across REQUESTED/APPROVED/PROCESSING/ESCALATED/SUCCEEDED states. Provider availability is
  resolved before a new claim, orphaned REQUESTED replays escalate visibly, and successive partial
  successes recompute the payment aggregate through `REFUNDED`.
- PayMongo or another production grocery payment provider, production recurring mandates, automatic
  renewal charging, and real-provider retry ownership are not selected or implemented. Existing
  membership renewal and authorization code is a provider-neutral mock-tested seam, not a production
  billing capability; no guessed PayMongo payload, credential, or processing-cost behavior exists.

### Checkout and delivery pricing

- Catalog prices are admin-managed. Cart display prices neither lock price nor reserve inventory.
- Instant checkout is authenticated pay-as-you-go and no longer requires membership. Scheduled quote,
  payment revalidation, and commitment retain the exact-instant Membership entitlement gate.
- Migration `0048_membership_and_service_fee.sql` adds one global effective-dated Membership price
  stream, agreed price snapshots on Subscriptions, and one global effective-dated Instant-only
  FreshMarkets Service Fee configuration. Existing Subscriptions retain their agreed amount and
  currency; ordinary price changes affect only new enrollment.
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
  market-scoped standard prices, and Cebu Central availability so rails render with real data.
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
- Cebu Central and other Location selections retain scoped Overview, Orders, Inventory, Delivery,
  Analytics, Audit, and Fulfillment Mode destinations when authorized. Global Products, Customers,
  Memberships, Promotions, Payments/Pricing, and Staff administration are removed from both the
  desktop sidebar and mobile navigation.

## Maturity by area

| Area                       | Current evidence                                                                                                                                                                                    | Not established                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Repository/Core boundaries | Monorepo, Core authority, Service Binding contracts, D1 ownership tests                                                                                                                             | Production deployment acceptance                          |
| Auth and IAM               | Better Auth Core ownership, RBAC boundaries, fake email-flow tests                                                                                                                                  | Production sender/domain and OAuth configuration          |
| Catalog/geography          | SKU/base-unit/pricing foundations; route-price adapter tests                                                                                                                                        | Approved production polygons/geocoder and Mapbox secret   |
| Checkout/orders            | Opaque Core fulfillment options, accepted quotes/promotions, mock payment reaction, immutable detail/timeline, reorder/issues/amendments, coordinated cancellation, provisional transaction summary | Production payment provider and official invoice issuance |
| Membership                 | Customer experience plus provider-neutral trial/authorization/renewal state                                                                                                                         | Approved production mandates and automatic charges        |
| Operations                 | Scoped commands/read models and local integration tests                                                                                                                                             | Complete staff/rider authenticated Playwright acceptance  |
| Notifications              | Durable email outbox/attempts, leases, retry, cancellation/refund projections, and safe templates                                                                                                   | Production sender/domain and delivery acceptance          |
| Phase 12 Admin UI          | Complete plan, contract/Core/Web tests, vinext build, authenticated Admin Playwright                                                                                                                | Production deployment acceptance remains external         |

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

- Select and approve a production grocery/recurring payment provider and define its mandate, retry,
  reconciliation, and refund policies.
- Decide membership-cancellation customer UX and effective timing before exposing a command.
- Configure an onboarded transactional email sender/adapter and the Core Mapbox secret outside source.
- Approve BIR seller/tax/serial/retention policy before invoice issuance.
- Treat the Customer launch implementation as locally verified product behavior only after the current-tree completion report gates pass; production deployment acceptance remains external.
- Provision authenticated staff/rider/customer browser test identities and run the written
  Playwright acceptance journeys without skips.
