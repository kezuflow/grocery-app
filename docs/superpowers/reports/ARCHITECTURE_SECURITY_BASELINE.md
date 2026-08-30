# Architecture and Security Hardening Baseline

Date: 2026-08-30

## Integrated state

- Maps/Admin base: local `main` and `origin/main` at `98c23789c2a2bf245fbdc18c1d461941718acd94`.
- Remediation integration: Programs 1–2 replayed on that base; migration numbering converged in `51493b1`.
- Baseline commit inspected here: `1b9c48100b9faafe9e22312b48b00559211607ad`.
- Protected migration blobs remain exact: Admin 0041 `9b18c5788eec5a0954097cd564712f15966bcd61`, Maps 0042 `e9651fc4f4778eac1cc78c8863b24b7e4ebb8ab3`, Maps 0043 `1f7a1df387f8ff634e6b36a44f042b9081b931f0`.
- The 0043 compatibility fixture now recreates the historically deployed pre-0043 delivery schema in test setup. Production Maps SQL and behavior are unchanged.

## Surface size

| Surface | Baseline |
| --- | ---: |
| `apps/core/src/index.ts` | 2,615 lines |
| `packages/contracts/src/index.ts` | 471 lines |
| `CoreEntrypoint` async RPC/health members | 135 |
| Worker lifecycle methods in the same class | 2 (`fetch`, `scheduled`) |
| Unbounded public-body reads | 66 call sites |

## Core binding methods

The 135 binding methods implemented by the entrypoint are:

`health`, `auth`, `getApplicationContext`, `getAdminContext`, `listAdminScopes`, `listMetricDefinitions`, `getOverview`, `getAnalyticsOverview`, `getMetric`, `getMetricSeries`, `listAdminAuditEvents`, `getAdminAuditEvent`, `listAdminStaff`, `getAdminStaff`, `listAdminStaffInvitations`, `inviteAdminStaff`, `revokeAdminStaffInvitation`, `updateAdminStaff`, `changeAdminStaffAccess`, `setAdminStaffRoles`, `setAdminStaffScopes`, `revokeAdminStaffSessions`, `listAdminRoles`, `getAdminRole`, `createAdminRole`, `updateAdminRole`, `setAdminRoleCapabilities`, `archiveAdminRole`, `listCapabilityDefinitions`, `listAdminCustomers`, `getAdminCustomer`, `listCustomerInvitations`, `inviteCustomer`, `changeCustomerAccess`, `revokeCustomerSessions`, `requestCustomerClosure`, `listPrivacyRequests`, `applyPrivacyAction`, `listAdminPromotions`, `getAdminPromotion`, `createAdminPromotion`, `updateAdminPromotion`, `changeAdminPromotionStatus`, `previewAdminPromotion`, `grantAdminPromotion`, `listPromotionGrants`, `listPromotionRedemptions`, `listAdminCategories`, `createAdminCategory`, `getAdminCategory`, `updateAdminCategory`, `setAdminCategoryStatus`, `listAdminUnits`, `createAdminUnit`, `listAdminProducts`, `createAdminProduct`, `getAdminProduct`, `updateAdminProduct`, `setAdminProductStatus`, `uploadAdminProductMedia`, `updateAdminProductMedia`, `removeAdminProductMedia`, `createAdminSku`, `updateAdminSku`, `setAdminSkuAvailability`, `setAdminSkuPrice`, `listAdminInventory`, `getAdminInventoryLedger`, `getFulfillmentMode`, `activateFulfillmentMode`, `aggregateAdminProcurementDemand`, `startAdminReceiving`, `recordAdminReceivedLine`, `completeAdminReceiving`, `advanceAdminFulfillment`, `advanceAdminDelivery`, `resolveAdminOperationalException`, `listProcurementRequirements`, `listReceivingSessions`, `listFulfillmentQueue`, `listDeliveryOperations`, `getDeliveryMap`, `getDeliveryMapDetail`, `getEligibleRiders`, `previewDeliveryBatchRoute`, `createAndAssignDeliveryBatch`, `listOperationalExceptions`, `listAdminOrders`, `getAdminOrder`, `cancelAdminOrder`, `listAdminPayments`, `getAdminPaymentOverview`, `getAdminPayment`, `requestAdminRefund`, `listAdminReconciliationCases`, `resolveAdminReconciliationCase`, `listAdminMemberships`, `getAdminMembership`, `pauseAdminMembership`, `resumeAdminMembership`, `cancelAdminMembership`, `listAdminOrderIssues`, `getAdminOrderIssue`, `applyAdminOrderIssueAction`, `resolveServiceability`, `searchAddressCandidates`, `searchCatalog`, `getMarketplaceHome`, `getCatalogProduct`, `listCategories`, `createCustomerAddress`, `listCustomerAddresses`, `updateCustomerAddress`, `startTrial`, `beginRecurringAuthorization`, `completeRecurringAuthorization`, `getSubscriptionEligibility`, `listDeliveryCycles`, `getCart`, `setCartItem`, `evaluateCheckout`, `createCheckoutQuote`, `refreshCheckoutQuote`, `createPaymentIntent`, `listCustomerOrders`, `adjustInventory`, `createProcurementRequirement`, `receiveProcurement`, `advanceFulfillment`, `advanceDelivery`, `adminOperationsBoard`, `assignRider`, `riderJobs`, `getRiderBatches`, and `adminScheduledJobRuns`.

The contract surface is assembled through `CoreServiceBinding -> ImplementedCoreService ->` bounded service intersections plus ten directly declared checkout/payment/Maps methods. It has no compile-time conformance declaration against `CoreEntrypoint`; Web currently casts the opaque binding.

## Unbounded public body reads

There are 66 reads which buffer before enforcing a byte limit:

- Core: `payments/http/provider-webhook.ts` (`request.text()`).
- Web auth: `lib/auth/proxy.ts` (`request.text()`).
- Customer/commerce: `serviceability`, Rider jobs, membership authorization completion, checkout quote/payment, commerce checkout/cart/address-search/address, and the address update handler (12 JSON reads).
- Admin command routes: fulfillment mode, fulfillment, exceptions, delivery, delivery batches, delivery-map preview, staff/session/scope/role/access/invitation mutations, privacy actions, customer session/closure/access/invitation mutations, catalog unit/category/product/SKU/media mutations, payments/refunds/reconciliation, receiving, orders, rider assignment, roles/capabilities, promotions/grants/status/preview, procurement, and membership pause/cancel/resume (51 JSON reads).
- Admin media upload: `catalog/products/[product-id]/media/route.ts` calls `File.arrayBuffer()` once without an application byte ceiling.

The source-of-truth scan is:

```powershell
rg -n "request\.(json|text)\(|arrayBuffer\(" apps/web/app/api apps/web/lib/auth apps/core/src
```

Generated Worker declaration matches are excluded from the count.

## Security headers

The only configured response security header is `Content-Security-Policy`, containing exactly the Maps-required sources:

```text
worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' https://api.mapbox.com https://events.mapbox.com
```

There is no configured default/script/style/object/base/form/frame policy, Referrer Policy, `X-Content-Type-Options`, Permissions Policy, or HSTS.

## Lint baseline

`pnpm lint` exits successfully with 20 warnings: 16 production warnings and 4 test warnings. Production warnings cover unused compatibility imports in the contract barrel; unused Admin/Core/Analytics imports; an unused UI render parameter; two unused Core entrypoint imports and one parameter; unused Admin access types/helpers; an unused inventory result; and an unused membership request ID. Test warnings are in Admin route tests, Core instant-quote and financial-safety tests, and the Web health client test.

## Initial verification evidence

- `pnpm naming:check`: passed.
- `pnpm migration:check`: passed after assigning remediation migrations 0044–0046.
- `pnpm catalog:check`: passed.
- `pnpm typecheck`: passed across all workspaces.
- Contracts/shared package tests: passed.
- Web tests: 49 files, 427 tests passed.
- Initial Core integration run: 110 files and 711 tests passed; three pre-0043 Maps compatibility fixtures failed because repaired migration 0021 now installs the future-safe order FK.
- Compatibility repair: all three focused 0043 migration tests passed; Core typecheck passed.
- Full Core rerun: 112 of 113 files and 713 of 714 tests passed. The only failure was the 1,001-row Maps pagination test exceeding its 5-second timeout at 5.034 seconds under full-suite load; the same file immediately passed in isolation (9/9, pagination test 4.67 seconds). No Maps production code or test threshold was changed.
- `pnpm -r build`: passed. Core Wrangler dry-run and Web vinext production build both completed.
- `pnpm format:check`: reports only pre-existing formatting drift in the integrated `apps/core/src/index.ts`.
- `pnpm lint`: exited 0 with the 20 warnings recorded above.

This is the executable starting point for hardening. Architecture work must preserve the exact Maps CSP sources and binding behavior while converting these observations into enforced boundaries and green acceptance gates.
