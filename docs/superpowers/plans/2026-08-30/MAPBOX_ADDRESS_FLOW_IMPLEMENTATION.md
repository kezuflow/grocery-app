# Mapbox Address Flow Implementation Plan

**Status:** Completed and integrated on `main` at `98c2378` on 2026-08-30. The unchecked task boxes below are retained as the original execution plan, not as outstanding work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw coordinate entry with a reusable Mapbox address search, exact pin confirmation, structured address book, and Core-authoritative serviceability flow.

**Architecture:** Web renders Mapbox GL with an origin-restricted public token. Core proxies Mapbox Geocoding v6 through a provider-neutral port, performs permanent finalization before storing provider-derived data, and remains authoritative for serviceability and address ownership.

**Tech Stack:** TypeScript 7, React 19, vinext, Cloudflare Workers Service Bindings, D1/Drizzle, Mapbox GL JS 3.29.0, Mapbox Geocoding v6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30/MAPS_ADDRESS_DISPATCH_RIDER_DESIGN.md`

## Global Constraints

- Read `AGENTS.md` and the canonical Geography, Customer, API, Data, MVP, and Marketplace design documents before editing.
- Core owns geocoding finalization and serviceability; Web never becomes a second authority.
- Temporary Mapbox candidates are session-only and never persisted or logged.
- Preserve historical order snapshots and existing customer ownership/version checks.
- Use migration `0042_mapbox_address_confirmation.sql`; `0041` belongs to the existing Admin Catalog work.
- Add no KV, Queue, Durable Object, Workflow, public Core HTTP API, or customer-selectable location.
- Execute on `main` according to `TRUNK.md`; do not disturb unrelated Admin Catalog changes.

---

### Task 1: Canonical Documentation and Geography Contracts

**Files:**

- Create: `packages/contracts/src/geography.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/core-service.ts`, relevant canonical documents
- Test: `packages/contracts/src/geography.test.ts`, `packages/contracts/src/core-service.test.ts`

**Interfaces:**

- Produces `AddressSearchRequest`, `AddressSearchCandidate`, `AddressComponents`, `CoordinateConfirmationSource`, `DeliveryInstructions`, structured address commands, and expanded `CustomerAddressView`.

- [ ] Write contract tests for these exact shapes:

```ts
export type CoordinateConfirmationSource = "GEOCODER" | "USER_PIN" | "DEVICE_LOCATION";
export type AddressSearchRequest = RequestMeta & { query: string; proximity?: Coordinate };
export type AddressSearchCandidate = {
  candidateKey: string;
  displayAddress: string;
  coordinate: Coordinate;
  components: AddressComponents;
  accuracy: string | null;
};
export type DeliveryInstructions = {
  buildingUnit: string | null;
  landmark: string | null;
  gateGuard: string | null;
  deliveryNote: string | null;
  recipientInstruction: string | null;
};
```

- [ ] Run `pnpm --filter @freshmarkets/contracts test -- geography.test.ts core-service.test.ts`; expect failures for missing exports/method.
- [ ] Implement the types in `geography.ts`, re-export them, and add `searchAddressCandidates(request): Promise<RpcResult<ReadonlyArray<AddressSearchCandidate>>>`.
- [ ] Extend create/update address inputs with structured components, confirmation source, and instructions while retaining `addressJson` only as a compatibility seam.
- [ ] Update canonical documents to match the approved spec.
- [ ] Re-run the focused contract tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(contracts): add map address contracts"`.

### Task 2: Mapbox Geocoding Port and Adapter

**Files:**

- Create: `apps/core/src/geography/ports/geocoder.ts`
- Create: `apps/core/src/geography/infrastructure/mapbox-geocoder.ts`
- Create: `apps/core/src/geography/infrastructure/runtime-geocoder.ts`
- Test: matching `.test.ts` files

**Interfaces:**

- Consumes contract coordinate/components types.
- Produces `GeocoderPort.search()` and `GeocoderPort.reversePermanent()`.

- [ ] Write adapter tests asserting `/search/geocode/v6/forward`, `country=PH`, Cebu proximity, bounded limit, and absence of `permanent=true` for search.
- [ ] Write finalization tests asserting `/search/geocode/v6/reverse` and `permanent=true`.
- [ ] Cover abort timeout, 401/403/429/5xx, empty features, malformed coordinates, and provider payloads containing no usable address.
- [ ] Run `pnpm --filter @freshmarkets/core test -- mapbox-geocoder.test.ts runtime-geocoder.test.ts`; expect failures because the adapters do not exist.
- [ ] Implement `MapboxGeocoder` with injected `fetch`, timeout, validated provider-neutral mapping, and stable `GEOCODER_*` error codes.
- [ ] Implement the runtime factory using existing Core `MAPBOX_ACCESS_TOKEN`; never return that token to Web.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(geography): add mapbox geocoding adapter"`.

### Task 3: Address Schema and Core Commands

**Files:**

- Create: `apps/core/migrations/0042_mapbox_address_confirmation.sql`
- Modify: `apps/core/src/customer/addresses.ts`, `apps/core/src/index.ts`, validation schemas and Worker environment types
- Test: `apps/core/src/customer-address.integration.test.ts`, new migration integration test

**Interfaces:**

- Consumes `GeocoderPort` and structured commands.
- Produces owner-scoped structured views with authoritative serviceability.

- [ ] Write a migration test requiring structured component JSON, barangay, city, postal code, geocode provider/reference, confirmation source/time, and delivery-instructions JSON columns while preserving legacy rows.
- [ ] Write integration tests proving geocoder-derived saves call permanent reverse before insert, manual pins can save with null provider metadata, unserviceable addresses persist as unavailable, coordinate edits re-resolve, stale versions fail, and committed snapshots remain unchanged.
- [ ] Run the focused Core tests; expect failures for missing columns/behavior.
- [ ] Add the forward-only migration with nullable metadata for legacy records and indexes for owner/status and resolved zone.
- [ ] Refactor create/update/list mapping to structured DTOs; Core records confirmation time and derives all serviceability fields.
- [ ] Add `searchAddressCandidates` and wire the runtime adapter in `CoreEntrypoint` with request validation and PII-safe logging.
- [ ] Re-run focused tests and `pnpm migration:check`; expect exit 0.
- [ ] Commit with `git commit -m "feat(customer): persist confirmed map addresses"`.

### Task 4: Web Mapbox Foundation

**Files:**

- Modify: `apps/web/package.json`, lockfile, `apps/web/wrangler.jsonc`, Web environment types and global styles/CSP configuration
- Create: `apps/web/components/maps/map-types.ts`
- Create: `apps/web/components/maps/mapbox-map.tsx`
- Create: `apps/web/components/maps/fake-map-adapter.ts`
- Test: `apps/web/components/maps/mapbox-map.test.tsx`

**Interfaces:**

- Produces a client-only map with point, draggable-pin, polygon, cluster, selection, and LineString layers.

- [ ] Write component tests for initialization after mount, cleanup, token error, map-load error, pin movement, reduced motion, and the fake adapter.
- [ ] Run the component test; expect failure because the map component does not exist.
- [ ] Add exact dependency `mapbox-gl@3.29.0` using pnpm.
- [ ] Add `MAPBOX_PUBLIC_ACCESS_TOKEN` as a Web variable and expose only that public value to the client; document URL restrictions.
- [ ] Implement Mapbox lifecycle in `useEffect`, import its CSS once, and add required CSP `worker-src`, `img-src`, and `connect-src` entries.
- [ ] Re-run component tests, `pnpm --filter @freshmarkets/web check:vinext`, typecheck, and build; expect exit 0.
- [ ] Commit with `git commit -m "feat(web): add reusable mapbox foundation"`.

### Task 5: Address Search Routes and Reusable Editor

**Files:**

- Create: `apps/web/app/api/commerce/address-search/route.ts`
- Modify: `apps/web/app/api/commerce/address/route.ts`, `apps/web/app/api/serviceability/route.ts`
- Create: `apps/web/components/storefront/address/address-editor.tsx`
- Create: `apps/web/components/storefront/address/address-list.tsx`
- Test: route and component tests beside these files

**Interfaces:**

- Consumes Plan tasks 1-4.
- Produces `AddressEditor.onConfirmed(addressId)` and accessible saved-address selection.

- [ ] Write route tests for query validation, Core forwarding, authentication on saves, and stable provider errors.
- [ ] Write editor tests for debounced/cancelled search, candidate selection, draggable pin, current-location success/denial, serviceability updates, structured instructions, unavailable saves, and textual fallback.
- [ ] Run focused Web tests; expect failures for missing routes/components.
- [ ] Implement thin route adapters and the editor; never expose raw coordinate input fields.
- [ ] Ensure every field has a label/error association and map actions have textual equivalents.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(storefront): add map address editor"`.

### Task 6: Address Book, Checkout, and Serviceability Integration

**Files:**

- Create: `apps/web/app/account/addresses/page.tsx`
- Modify: `apps/web/app/checkout/page.tsx`, `apps/web/app/serviceability/page.tsx`, account navigation as required
- Test: `apps/web/tests/address-map.spec.ts`, checkout route/component tests

**Interfaces:**

- Consumes `AddressEditor` and `AddressList`.
- Produces saved-address management and checkout selection using only serviceable addresses.

- [ ] Write Playwright tests for search-confirm-save, saved unavailable address, correction, checkout selection, map failure fallback, and no latitude/longitude inputs.
- [ ] Run the focused Playwright test against the configured fixture; expect the new assertions to fail.
- [ ] Implement the address-book page and replace checkout's inline raw form with saved selection/editor.
- [ ] Upgrade serviceability to reuse search/pin confirmation without exposing a fulfillment hub.
- [ ] Re-run focused tests plus `pnpm --filter @freshmarkets/web typecheck` and build; expect exit 0.
- [ ] Commit with `git commit -m "feat(storefront): integrate confirmed delivery addresses"`.

### Task 7: Plan Verification

- [ ] Run `pnpm format:check`.
- [ ] Run `pnpm naming:check` and `pnpm migration:check`.
- [ ] Run `pnpm lint`, `pnpm typecheck`, and focused/full tests relevant to this plan.
- [ ] Run `pnpm --filter @freshmarkets/web check:vinext` and `pnpm -r build`.
- [ ] Inspect `git diff --check` and confirm no Mapbox token, temporary candidate data, raw address, or unrelated Admin Catalog file is staged.
- [ ] Commit any documentation/status follow-up as `docs(maps): record address flow implementation` only after the verification evidence is clean.
