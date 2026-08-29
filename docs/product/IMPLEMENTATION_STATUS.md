# FreshMarkets Implementation Status

Status date: 2026-08-30. This file is descriptive evidence only. The canonical documents named in
`AGENTS.md` remain authoritative.

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

## Admin Operations UI Phase 12 (2026-08-30)

- The approved Admin screen inventory is implemented through the typed Web-to-Core Service Binding: Core-authorized hierarchical navigation; Catalog Product and Category list/create/detail/edit/lifecycle; canonical R2-backed Product media administration; complete Order and Payment workspaces; and the existing Customer/Privacy, Membership, Promotion, Inventory, Procurement/Receiving, Fulfillment, Delivery, exception, Analytics, Staff/Role, Audit, and fulfillment-mode surfaces.
- Migration `0041_admin_catalog_authoring.sql` adds guarded Category hierarchy/version fields and the canonical `product_media` association. Product media bytes are validated and stored through Core's `PRODUCT_MEDIA` R2 binding; Web has no D1 or R2 authority. The version-controlled storefront image metadata path remains compatibility-only until public Catalog delivery consumes canonical R2 media.
- Order detail composes immutable quote/order financial and item snapshots, Payments, amendments, fulfillment, delivery, exceptions, timeline, Core-derived actions, and Audit. Payment overview/detail composes canonical intent, attempt, refund, provider-safe event, reaction, and reconciliation projections; provider references, provider-event identifiers, hashes/payloads, and reconciliation JSON do not leave Core.
- Shared Admin compositions provide Core-derived breadcrumbs, typed responsive tables, explicit loading/empty/filtered/scope/error states, cursor controls, exact-impact confirmations, detail/timeline layouts, and live command results. The complete deterministic Admin Playwright set passed against the managed vinext + Core/D1 stack; exact final evidence is recorded in `docs/superpowers/reports/ADMIN_DASHBOARD_PHASE_12_FINAL.md`.

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
- Known local-stack limitation: committed migration `0021_instant_mode.sql` cannot apply to dev
  databases containing pre-existing grocery orders because of its unconditional `DROP TABLE
grocery_order` history; fresh or migrated-at-the-time environments are unaffected.

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
- Core and Web can execute a local checkout through quote acceptance, mock payment intent, signed
  provider event, durable payment observation, reaction redrive, and exactly one committed order.
- Duplicate commands, provider events, and redrives cannot create a second canonical payment or
  order.
- If payment succeeds and commitment fails, the same reaction is retried. Bounded failures create a
  reconciliation case while preserving the payment. No automatic production refund policy exists.
- A production grocery payment provider, production recurring mandates, automatic renewal charging,
  and real-provider retry ownership are not selected or implemented. Existing membership renewal and
  authorization code is a provider-neutral mock-tested seam, not a production billing capability.

### Checkout and delivery pricing

- Catalog prices are admin-managed. Cart display prices neither lock price nor reserve inventory.
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

- Customer grocery-order cancellation is not in the mock-payment MVP. It is absent from the Core
  entrypoint, shared Service Binding contract, and Web customer surface.
- Internal operational cancellation machinery remains an operations seam and is not customer
  authority. Membership-cancellation UX remains unresolved and is not inferred here.

### Operations exception convergence

- Admin operational exceptions converge procurement, receiving, fulfillment, and delivery source
  records into a typed, location-scoped queue exposing policy-derived severity, source age where
  timestamps exist, owner, reason, and source-derived permitted actions. Resolution remains owned
  by each source command and its immutable audit event; unsupported actions are explicitly
  unavailable in the convergence view.

## Maturity by area

| Area                       | Current evidence                                                                   | Not established                                              |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Repository/Core boundaries | Monorepo, Core authority, Service Binding contracts, D1 ownership tests            | Production deployment acceptance                             |
| Auth and IAM               | Better Auth Core ownership, RBAC boundaries, fake email-flow tests                 | Production sender/domain and OAuth configuration             |
| Catalog/geography          | SKU/base-unit/pricing foundations; route-price adapter tests                       | Approved production polygons/geocoder and Mapbox secret      |
| Checkout/orders            | Authoritative quote revalidation, mock payment reaction, immutable order snapshots | Full authenticated browser acceptance and production payment |
| Membership                 | Provider-neutral states, trial/authorization/renewal test seams                    | Approved production mandates and automatic charges           |
| Operations                 | Scoped commands/read models and local integration tests                            | Complete staff/rider authenticated Playwright acceptance     |
| Notifications              | Auth verification/reset only                                                       | Product notification Program 6                               |
| Phase 12 Admin UI          | Complete plan, contract/Core/Web tests, vinext build, authenticated Admin Playwright | Production deployment acceptance remains external           |

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
- Configure an onboarded Cloudflare Email Service sender and the Core Mapbox secret outside source.
- Complete Programs 6-14 without treating current schemas or plans as implemented product behavior.
- Provision authenticated staff/rider/customer browser test identities and run the written
  Playwright acceptance journeys without skips.
