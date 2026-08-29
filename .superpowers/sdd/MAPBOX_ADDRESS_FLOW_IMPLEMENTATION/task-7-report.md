# Task 7 Report: Plan 1 Verification and Address-Flow Record

## Status

Plan 1 verification is clean on the isolated `maps-program` tracked tree. No Maps defect was found,
so no TDD fix cycle was required. The only implementation record change is the descriptive
`IMPLEMENTATION_STATUS.md` addition required to replace its stale provider/geocoder status; no
canonical document, Admin behavior, Admin documentation, schema, RPC, or production configuration
was changed by Task 7.

## Fresh required-gate evidence

All commands below were run from
`E:/GithubProjects/freshmarkets/.worktrees/maps-program` and their final output and exit code were
inspected directly.

1. `pnpm format:check` — exit 0; 636 files checked and all matched formatting.
2. `pnpm naming:check` — exit 0; source paths, migrations, docs, and workspace packages compliant.
3. `pnpm migration:check` — exit 0; fresh apply and populated `0021 -> 0022` upgrade valid.
4. `pnpm lint` — exit 0; 19 existing unused-symbol/expression warnings and no errors.
5. `pnpm typecheck` — exit 0; all six participating workspace projects completed `tsc --noEmit`.
6. Focused Plan 1 tests:
   - `pnpm --filter @freshmarkets/contracts test -- geography.test.ts core-service.test.ts` — exit
     0; 2 files, 10 tests passed.
   - `pnpm --filter @freshmarkets/core test -- geography/infrastructure/mapbox-geocoder.test.ts geography/infrastructure/runtime-geocoder.test.ts customer-address.integration.test.ts customer/address-migration.integration.test.ts geography/serviceability.test.ts`
     — exit 0; 5 files, 56 tests passed.
   - `pnpm --filter @freshmarkets/web test -- components/maps/mapbox-map.test.tsx app/api/commerce/address-search/route.test.ts components/storefront/address/address-editor.test.tsx components/storefront/address/address-list.test.tsx app/account/addresses/address-book-client.test.tsx app/checkout/checkout-client.test.tsx app/api/serviceability/route.test.ts`
     — exit 0; 7 files, 36 tests passed.
   - Focused aggregate: 14 files and 102 tests passed.
7. `pnpm test` — exit 0; 150 files and 739 tests passed across config (1/2), contracts
   (14/46), domain-shared (1/2), validation (1/2), Web (39/180), and Core (94/507).
8. `pnpm --filter @freshmarkets/web check:vinext` — exit 0; 100% compatible, 12 supported,
   0 partial, 0 issues; 55 pages, 2 layouts, and 99 route handlers scanned.
9. `pnpm -r build` — exit 0; Core Wrangler dry-run and Web vinext build completed. Vite emitted
   the existing non-fatal chunk-size advisory; `/account/addresses`, `/checkout`,
   `/serviceability`, `/api/commerce/address-search`, `/api/commerce/address`, and
   `/api/serviceability` were emitted.
10. PowerShell equivalent of
    `E2E_START_STACK=1 pnpm --filter @freshmarkets/web exec playwright test tests/address-map.spec.ts`
    — exit 0; 5 tests passed in 1.3 minutes against the managed isolated vinext + Core/D1 stack.
11. `git diff --check` before documentation edits — exit 0. It is rerun after edits below before
    commit.

Post-edit verification reran `pnpm format:check` (exit 0; 636 files), `pnpm naming:check` (exit 0),
and `git diff --check` (exit 0) before selective staging.

Port 3100 was confirmed released immediately before Playwright and again after Playwright exited.

## Integrated history and migration inspection

- Plan 1 tracked commits inspected were `ca4ef3f`, `ad5da95`, `ea1f1d0`, `1051e1d`, `a1f39b0`,
  `a059c6f`, `0c27ab7`, `a2b5a3f`, `ec91515`, `a0d31fa`, and `b82bf63`.
- Their path lists contain no Admin application/design file and do not touch
  `0041_admin_catalog_authoring.sql`. Maps commit `a1f39b0` adds only
  `0042_mapbox_address_confirmation.sql`; the tracked migrations directory contains exactly one
  file with that name and no `0043` migration.
- The four pre-existing untracked Maps artifacts remain preserved: the Plan 1 plan, the Plan 2
  plan, the Plan 3 plan, and the untracked `docs/superpowers/specs/2026-08-30/` tree. None is staged.
- Task 7 adds no generated Playwright state, Worker persistence, or production configuration.

## Privacy, security, and authority inspection

- Current address search accepts POST JSON only. GET returns 405; every success/error response uses
  `private, no-store, max-age=0` and `pragma: no-cache`; the editor also requests `cache: no-store`.
- Temporary candidates live only in `AddressEditor` React state. The save body omits
  `candidateKey`; no candidate/provider response cache, durable storage, analytics, diagnostic-log,
  or URL-query path exists.
- Core geocoder logs contain request ID, provider-neutral operation, duration, result category, and
  stable error code only. They contain no query/address/contact text, coordinates, candidate
  contents, provider payload, or token.
- The history/config scan found no real access token or secret. Token-like strings are test
  fixtures; Web config contains only an empty `MAPBOX_PUBLIC_ACCESS_TOKEN` placeholder and warns
  never to copy the Core `MAPBOX_ACCESS_TOKEN`. The Core token stays in its secret binding.
- Provider-derived saves invoke `reversePermanent`; user-pin/device-location saves may keep null
  provider metadata. Core derives service area, zone, serviceability, and confirmation time.
- Customer address reads/writes remain authenticated and owner-scoped; updates use expected address
  versions. Unserviceable addresses can persist as unavailable.
- The rendered address surfaces have no latitude/longitude input. Search/current-location/map-pin
  actions have textual and keyboard-operable fallbacks.
- Public Serviceability uses `purpose="serviceability"`, requires no session, renders no persistence
  controls, persists nothing, and exposes no fulfillment hub or location choice.
- Checkout loads saved addresses and accepts only an address whose authoritative loaded
  `serviceable` value is exactly `true`; Core still re-resolves serviceability and all checkout
  eligibility.
- Address updates do not mutate committed Order snapshots; the Core integration regression reads
  the committed `address_snapshot_json` after an address edit and proves it is byte-for-byte
  unchanged.

## Documentation decision

The canonical Architecture, Domain Model, Data Model, API Contracts, MVP Scope, implementation
sequence, and Marketplace design already agree with the approved specification and implementation;
no canonical edit is justified. `IMPLEMENTATION_STATUS.md` was stale because it did not record the
provider-backed address flow and still described the production geocoder as unestablished. Task 7
therefore adds one non-authoritative status section while explicitly retaining the deployment risks
for origin restrictions, secrets, provider entitlement, and production polygons.

## Database, RPC, files, and next-plan boundary

- Task 7 database/schema changes: none.
- Task 7 RPC/contracts changes: none.
- Task 7 application/runtime changes: none.
- Important Task 7 files: `docs/product/IMPLEMENTATION_STATUS.md` and this report.
- Plan 2/Admin dispatch and Plan 3/Rider implementation were not started. Those plans may rely on a
  verified provider-backed customer address foundation without treating dispatch batching,
  Directions preview, rider assignment, or Google Maps navigation as implemented.

## Concerns and execution rulings

- The repository-wide lint gate has 19 non-failing pre-existing warnings; none is a Maps failure and
  no unrelated cleanup was attempted.
- Web builds retain the existing non-fatal chunk-size advisory; build and managed Playwright both
  completed successfully.
- Production acceptance remains externally gated by correctly restricted public-token deployment,
  the Core secret, Mapbox permanent-geocoding entitlement/terms, and an approved production Cebu
  polygon. Fixture success is not presented as provider or production acceptance.
- Because the required status correction and evidence report are justified tracked changes, they
  will be selectively committed with the exact subject
  `docs(maps): record address flow implementation` after fresh post-edit gates are clean.

## Review fix round 1: independent structured-component provenance

### Confirmed defect and root cause

Review found an Important privacy/provenance defect in the verified tree. Candidate selection copied
temporary provider components into editor state. Moving the pin or accepting a device location
changed only `confirmationSource` to `USER_PIN`/`DEVICE_LOCATION`; the components remained copied
from the candidate. Core used that same coordinate source to decide whether to call permanent
reverse geocoding, so it persisted the temporary text as if it were first-party.

The root cause was one field representing two independent facts: coordinate-confirmation
provenance and structured-component provenance.

### Genuine focused RED

- `pnpm --filter @freshmarkets/contracts test -- geography.test.ts` — exit 1; 1 failed / 4
  passed. TypeScript reported that `AddressComponentsSource` and `componentsSource` did not exist.
- `pnpm --filter @freshmarkets/web test -- components/storefront/address/address-editor.test.tsx`
  — exit 1; 2 failed / 9 passed. Both candidate-to-pin-save and
  candidate-to-delayed-device-save payloads omitted `TEMPORARY_GEOCODER` provenance.
- `pnpm --filter @freshmarkets/core test -- customer-address.integration.test.ts` — exit 1; 2
  failed / 17 passed. Temporary components submitted with final `USER_PIN` and `DEVICE_LOCATION`
  coordinates made zero permanent reverse calls instead of one.

### Minimal fix and authoritative ruling

- Shared contracts now carry `AddressComponentsSource` independently from
  `CoordinateConfirmationSource`: `TEMPORARY_GEOCODER`, `FIRST_PARTY`, or update-only
  `SAVED_ADDRESS`.
- Web marks selected candidate components `TEMPORARY_GEOCODER` and retains that provenance across
  pin/device coordinate changes. If a customer begins entering first-party structured fields after
  a candidate move, the editor clears the remaining temporary component set before accepting the
  first-party values, preventing mixed temporary/first-party text from being mislabeled.
- The Web route and Core validation require component provenance whenever structured components are
  submitted. New addresses cannot claim `SAVED_ADDRESS`; an update claiming `SAVED_ADDRESS` must
  match the current persisted component values.
- Core permanently reverse-finalizes `TEMPORARY_GEOCODER` components at the final submitted
  coordinate regardless of whether coordinate provenance is `GEOCODER`, `USER_PIN`, or
  `DEVICE_LOCATION`. The permanent components and provider reference are stored, while the exact
  coordinate provenance remains unchanged.
- Existing saved provider components are treated as already permanent. If their coordinate moves,
  Core re-finalizes them at the new coordinate; it does not destructively clear legitimate saved
  data. Manual `FIRST_PARTY` pin/device saves still work with null provider metadata when provider
  enrichment is unavailable. Existing `GEOCODER` permanent finalization remains unchanged.
- Candidate keys and provider payloads remain absent from save commands, persistence, and logs. No
  public API, cache, queue, Durable Object, Workflow, or customer-selectable location was added.

Canonical `API_CONTRACTS.md` and `DOMAIN_MODEL.md` were updated in the same change because the
command contract now explicitly separates component and coordinate provenance. No Data Model,
state-machine, MVP-scope, sequencing, migration, or Admin decision changed.

### Focused GREEN

- Contracts: `pnpm --filter @freshmarkets/contracts test -- geography.test.ts core-service.test.ts`
  — exit 0; 2 files, 10 tests passed.
- Core: focused Plan 1 command — exit 0; 5 files, 59 tests passed.
- Web: focused Plan 1 command including the address route — exit 0; 8 files, 40 tests passed.
- Self-review route RED: `pnpm --filter @freshmarkets/web test -- app/api/commerce/address/route.test.ts`
  — exit 1; 1 failed / 3 passed because PATCH inherited the create-only `SAVED_ADDRESS`
  exclusion. After overriding component provenance only on the update schema, the same command was
  GREEN with 4/4 tests.
- Final Web focused rerun: 8 files, 41 tests passed.
- Core metadata-retention RED: `pnpm --filter @freshmarkets/core test -- customer-address.integration.test.ts`
  — exit 1; 1 failed / 19 passed because a non-location `SAVED_ADDRESS` edit cleared the permanent
  provider/reference metadata from a user-confirmed pin. The minimal fix preserves that metadata
  only for unchanged saved components, allowing a later pin move to re-finalize them. The same
  command was GREEN with 20/20 tests.
- Final focused aggregate: 15 files and 110 tests passed.

### Full Task 7 gate rerun

All commands ran from the isolated `maps-program` worktree after the fix:

1. `pnpm format:check` — exit 0; 636 files.
2. `pnpm naming:check` — exit 0.
3. `pnpm migration:check` — exit 0; fresh apply and populated `0021 -> 0022` upgrade valid.
4. `pnpm lint` — exit 0; the same 19 non-failing pre-existing warnings, 0 errors.
5. `pnpm typecheck` — exit 0; all six participating workspace projects.
6. Focused Plan 1 tests — exit 0; 110/110 as detailed above.
7. `pnpm test` — exit 0; 150 files and 744 tests passed: config 2, contracts 46,
   domain-shared 2, validation 2, Web 182, Core 510.
8. `pnpm --filter @freshmarkets/web check:vinext` — exit 0; 100% compatible, 12 supported,
   0 partial, 0 issues.
9. `pnpm -r build` — exit 0; Core Wrangler dry-run and Web vinext build completed; the existing
   non-fatal chunk-size advisory remains.
10. Managed address Playwright with `E2E_START_STACK=1` — exit 0; 5 tests passed in 1.3 minutes.
11. `git diff --check` — exit 0 before the report/status append.

Port 3100 was released before the managed run and again after it. Managed persistence stayed inside
the isolated worktree. No generated E2E state, real token/secret, raw address/contact/coordinate
value, candidate data, migration, or unrelated Admin file is included by this fix.

### Review-fix files, schema, contracts, and concerns

- Runtime: address editor, thin Web address route, Core address command/finalization, and Core
  validation.
- Contracts/tests: geography/index contracts plus focused Web/Core/contract regressions.
- Canonical docs: `API_CONTRACTS.md` and `DOMAIN_MODEL.md` only, to record the proven contract rule.
- Descriptive docs: corrected status wording and this appended evidence.
- Database/schema/migrations: none. `0042` remains the sole Maps migration; no `0043` exists.
- Admin/Plan 2/Rider/Plan 3: untouched and not started.
- Remaining external concerns are unchanged: restricted public-token deployment, Core secret,
  permanent-geocoding entitlement/terms, approved production Cebu polygons, 19 pre-existing lint
  warnings, and the non-fatal Web chunk-size advisory.
