# Task 6 Report: Address Book, Checkout, and Serviceability Integration

## Status

Implementation and required verification are complete. The final managed Playwright rerun passed
after the primary agent cleared local port 3100.

## Implemented work

- Added `/account/addresses` with owner-scoped saved-address loading, explicit loading/empty/error
  states, unavailable badges/correction, create/edit flows, refresh after save, and an Account link.
- Replaced Checkout's raw inline address/latitude/longitude form with `AddressList` selection and the
  reusable `AddressEditor`. Unavailable addresses are disabled and a second page-level guard prevents
  any address whose loaded `serviceable` value is not `true` from reaching eligibility/quote/payment.
- Replaced public Serviceability's raw coordinate form with reusable search/pin confirmation and live
  Core serviceability feedback. The new editor `purpose="serviceability"` mode renders no recipient,
  delivery-instruction, or save controls and its submit guard cannot call address persistence.
- Passed only `MAPBOX_PUBLIC_ACCESS_TOKEN` from server pages to client components. No Core Mapbox
  provider token was introduced or exposed.

## TDD evidence

### Genuine RED

1. Command:

   `E2E_START_STACK=1 pnpm --filter @freshmarkets/web exec playwright test tests/address-map.spec.ts`

   Result: exit 1, 4 failed. The failures were caused by the missing `/account/addresses` page, no
   saved-address choices in Checkout, and no search editor on public Serviceability.

2. Command:

   `pnpm --filter @freshmarkets/web test -- address-editor.test.tsx`

   Result: exit 1, 1 failed / 9 passed. The new public-serviceability test found persistence controls
   and no "This coverage check is not saved" message because check-only behavior did not exist.

### Focused GREEN

1. Command:

   `pnpm --filter @freshmarkets/web test -- address-editor.test.tsx address-list.test.tsx`

   Result: exit 0, 2 files passed, 12 tests passed.

2. First post-implementation managed Playwright command:

   `E2E_START_STACK=1 pnpm --filter @freshmarkets/web exec playwright test tests/address-map.spec.ts`

   Result: exit 1, 3 passed / 1 failed. Unavailable correction, serviceable-only Checkout, and public
   non-persisting Serviceability passed. The only failure was a test-only strict-locator ambiguity:
   `getByText("Home")` matched the existing desktop and mobile navigation links. The locator was
   narrowed to the saved-address radio and the final managed rerun passed as recorded below.

3. Final managed Playwright command after primary clearance and the locator-only correction:

   `E2E_START_STACK=1 pnpm --filter @freshmarkets/web exec playwright test tests/address-map.spec.ts`

   Result: exit 0, 4 tests passed in 1.4 minutes. Search-confirm-save with map fallback,
   unavailable-address correction, serviceable-only Checkout selection, and public non-persisting
   Serviceability all passed.

## Non-managed verification

- `pnpm --filter @freshmarkets/web test` — exit 0; 36 files and 170 tests passed.
- `pnpm --filter @freshmarkets/web typecheck` — exit 0.
- `pnpm --filter @freshmarkets/web check:vinext` — exit 0; 100% compatible, 0 issues.
- `pnpm --filter @freshmarkets/web build` — exit 0; `/account/addresses`, `/checkout`, and
  `/serviceability` emitted. Vite retained the repository's non-fatal large-chunk warning.
- Targeted `pnpm exec oxlint ...` for all Task 6 TypeScript/TSX files — exit 0.
- Targeted `pnpm exec oxfmt --check ...` for all Task 6 TypeScript/TSX files — exit 0.
- `pnpm naming:check` — exit 0.
- `git diff --check` — exit 0.

## Files

- `apps/web/app/account/page.tsx`
- `apps/web/app/account/addresses/page.tsx`
- `apps/web/app/account/addresses/address-book-client.tsx`
- `apps/web/app/checkout/page.tsx`
- `apps/web/app/checkout/checkout-client.tsx`
- `apps/web/app/serviceability/page.tsx`
- `apps/web/app/serviceability/serviceability-client.tsx`
- `apps/web/components/storefront/address/address-editor.tsx`
- `apps/web/components/storefront/address/address-editor.test.tsx`
- `apps/web/tests/address-map.spec.ts`
- `.superpowers/sdd/MAPBOX_ADDRESS_FLOW_IMPLEMENTATION/task-6-report.md`

## Schema, RPC, and documentation changes

- Database/schema: none.
- Core or shared RPC contracts: none.
- Canonical documentation: none; Task 6 implements the already approved address-flow specification
  without changing architecture or business rules.
- Descriptive record: this report only.

## Privacy and authority review

- Address search remains the existing POST JSON/no-store path. No query strings or proximity data
  were added to URLs.
- Temporary candidates remain inside `AddressEditor` React state; Task 6 adds no cache, persistence,
  storage, analytics, or logging path for candidates, address/contact text, or coordinates.
- No raw latitude/longitude input controls exist on Address Book, Checkout, or Serviceability.
- Map failure retains the textual, keyboard-operable search/candidate path.
- Public Serviceability requires neither authentication nor address persistence and exposes no
  fulfillment location/hub choice or internal operations-location copy.
- Checkout sends only a loaded address with `serviceable === true`; Core still rechecks eligibility,
  quote, fee, capacity, and serviceability authoritatively.
- Only the browser-safe Web Mapbox token crosses the server/client boundary; the Core provider token
  remains absent from Web.

## Concerns

- Vite reports the repository's existing non-fatal large-chunk advisory during Web builds; it did
  not fail the build or focused managed Playwright fixture.
- No implementation deviations or business-rule changes were introduced.
