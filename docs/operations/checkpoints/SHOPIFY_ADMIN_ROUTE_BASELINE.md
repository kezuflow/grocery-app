# SAUI-00 route baseline

Source revision: `ecf36369266e2bb217c3502e983d6d7acd564e70` on `main`, 2026-09-24. This is source discovery, not browser acceptance.

## Admin pages (55)

| Route | Kind |
| --- | --- |
| `/admin/analytics` | Page |
| `/admin/audit/[audit-event-id]` | Page |
| `/admin/audit` | Page |
| `/admin/banners` | Page |
| `/admin/catalog/categories/[category-id]/edit` | Page |
| `/admin/catalog/categories/[category-id]` | Page |
| `/admin/catalog/categories/new` | Page |
| `/admin/catalog/categories` | Page |
| `/admin/catalog` | Page |
| `/admin/catalog/products/[product-id]/edit` | Page |
| `/admin/catalog/products/[product-id]` | Page |
| `/admin/catalog/products/new` | Page |
| `/admin/catalog/products` | Page |
| `/admin/commerce-configuration` | Redirect |
| `/admin/customers/[customer-id]` | Page |
| `/admin/customers` | Page |
| `/admin/delivery` | Page |
| `/admin/fulfillment` | Page |
| `/admin/inventory` | Page |
| `/admin/issues/[issue-id]` | Page |
| `/admin/issues/operational-exceptions` | Page |
| `/admin/issues` | Page |
| `/admin/locations/[location-id]/fulfillment` | Page |
| `/admin/locations/[location-id]` | Page |
| `/admin/locations/[location-id]/pickup` | Page |
| `/admin/locations/[location-id]/schedule` | Page |
| `/admin/locations` | Page |
| `/admin/locations/service-areas` | Page |
| `/admin/memberships/[subscription-id]` | Page |
| `/admin/memberships` | Page |
| `/admin/orders/[order-id]` | Page |
| `/admin/orders` | Page |
| `/admin` | Page |
| `/admin/payments/[payment-intent-id]` | Redirect |
| `/admin/payments/overview` | Redirect |
| `/admin/payments` | Page |
| `/admin/payments/reconciliation` | Redirect |
| `/admin/payments/transactions/[payment-intent-id]` | Redirect |
| `/admin/payments/transactions` | Redirect |
| `/admin/procurement` | Page |
| `/admin/promotions/[promotion-id]` | Page |
| `/admin/promotions` | Page |
| `/admin/receiving` | Page |
| `/admin/sales/[sale-id]` | Page |
| `/admin/sales` | Page |
| `/admin/settings/delivery-cycles` | Redirect |
| `/admin/settings/fulfillment-mode` | Page |
| `/admin/settings` | Redirect |
| `/admin/settings/scheduled-cycles` | Page |
| `/admin/staff/[staff-id]` | Page |
| `/admin/staff` | Page |
| `/admin/staff/roles/[role-id]` | Page |
| `/admin/staff/roles` | Page |
| `/admin/transfers/[transfer-id]` | Page |
| `/admin/transfers` | Page |

### Compatibility redirects to retain

| Source | Destination / query behavior |
| --- | --- |
| `/admin/commerce-configuration` | `/admin/settings` |
| `/admin/payments/[payment-intent-id]` | `/admin/payments?payment=<encoded id>` |
| `/admin/payments/overview` | `/admin/payments` |
| `/admin/payments/reconciliation` | `/admin/payments?tab=attention` |
| `/admin/payments/transactions/[payment-intent-id]` | `/admin/payments?payment=<encoded id>` |
| `/admin/payments/transactions` | `/admin/payments?status=paid`, `partially-refunded`, `refunded`, or the unfiltered page, according to its existing `status` input |
| `/admin/settings/delivery-cycles` | `/admin/settings/scheduled-cycles` |
| `/admin/settings` | `/admin/settings/fulfillment-mode` |

### Authorized navigation and main states

Core's `get-admin-context.ts` determines capability and scope visibility; the browser selection never grants access. This table summarizes the current root destinations. The page and API lists below retain the complete route surface, including detail and compatibility paths.

| Family | Existing root and UI states | Core navigation capability | Core navigation scope |
| --- | --- | --- | --- |
| Home | `/admin` overview | Active staff | Global, Market, Location |
| Orders / Problems | `/admin/orders` list and detail; `/admin/issues` list and detail | `orders.read` or `orders.manage` | Global, Market, Location |
| Product catalog | `/admin/catalog/products` list, scoped preview, create, detail, edit; `/admin/catalog` controlled-unit overview; categories list/create/detail/edit | `catalog.read` or `catalog.manage`; overview requires `catalog.read` | Global; location Product entry additionally needs `inventory.read` |
| Fulfillment / delivery | `/admin/fulfillment`, `/admin/delivery` queues, selected operational detail and actions | Corresponding `*.read` or `*.manage` | Location only |
| Procurement / receiving | `/admin/procurement` delivery-week view/purchase; `/admin/receiving` workflow | `procurement.read` for the former; `procurement.manage` for the latter | Procurement Global/Location; receiving Location only |
| Inventory / transfers | `/admin/inventory` list and adjustments; `/admin/transfers` list/detail/draft/dispatch/receive/resolve | `inventory.read` or `inventory.adjust`; `transfers.read` | Inventory Location only; transfers Global/Location |
| Customers / legacy memberships | `/admin/customers` list/detail/support/privacy/access; `/admin/memberships` history | `customers.read` or `customers.manage`; membership capability for history | Global |
| Discounts / banners | `/admin/promotions`, `/admin/sales`, `/admin/banners` list/detail/editor | `promotions.read` or `promotions.manage` | Global |
| Finance / analytics | `/admin/payments` list/attention/detail query state; `/admin/analytics` report | `payments.read` or `payments.manage`; `analytics.read` | Payments Global; analytics Global, Market, Location |
| Settings / administration | Locations, service areas, Staff, Roles, Audit, fulfillment mode and Scheduled cycles at their existing paths | Corresponding location/staff/audit/settings/fulfillment capability, independently | See Core navigation; locations and Settings Global/Location, other entries capability-specific |

The current Order list holds a local status view and cursor; Products and Categories use `query`/`status` URL state and cursor, with a Core-validated Product scope-target cookie; Product/Category detail and edit routes use `from` for return context and detail uses `created`/`updated` notices. Payments uses `tab`/`status`/`cursor`/`payment`/`issue` query state. Procurement accepts `cycleId`, `requirementId`, `locationId`; Receiving accepts `cycleId`; Fulfillment accepts `orderId`; Audit accepts `action`, `actorId`, `locationId`, `from`, `to`, `cursor`, `limit`. Preserve these during composition changes. No current Orders list route creates draft orders, sends invoices, or marks payments as paid. POS and Messaging have no page/API route.

### Acceptance risks and existing test owners

- Core `get-admin-context.ts` supplies the authorized leaf list. The 2026-09-24 navigation fix gave Procurement, Receiving, Transfers and Catalog overview discoverable entries. Presentation regrouping must retain independently authorized Receiving and child-only Settings/Locations access. `apps/core/src/admin/application/admin-context.integration.test.ts` and `apps/web/components/admin/admin-navigation.test.ts` cover source behavior; they do not establish rendered browser navigation.
- `apps/web/app/admin/orders/page.tsx` owns a status view and cursor in local state. A full-detail default must preserve return position and must not turn its count-only row selection into unsupported bulk actions. Order cancellation and issue handling remain separate Core commands.
- `apps/web/app/admin/catalog/products/products-page-client.tsx` owns selected Product preview and scope-sensitive catalog behavior. PRODUCT's direct Global name/lifecycle/category and selected-location price controls remain in the preview, including unknown-command lock. Product create/edit routes and media workflows are separate substantial forms.
- `apps/web/app/admin/payments/page.tsx` owns the current Payments/attention/deep-link query states. Financial actions, refund outcomes and provider uncertainty stay behind existing Core client calls; visual success is not transaction acceptance.
- Fulfillment, procurement/receiving, transfers and delivery have separate Core state/action owners. Do not infer a legal transition from a visual button or Shopify flow. Preserve version, idempotency and recovery handling when moving controls.
- The existing `apps/web/tests/admin-visual-regression.spec.ts` covers desktop/tablet/mobile composition with deterministic synthetic reads. It is a visual baseline, not real provider or full-scope journey acceptance. Focused Admin browser suites and Core Worker/D1 tests must be selected by the affected action.

## Admin API routes (118)

HTTP methods and Core client calls are source evidence for the existing caller path, not proof that each command is available to every operator. Core rechecks capability, resource scope, current state and version.

| Route | Methods | Core client calls |
| --- | --- | --- |
| `/api/admin/analytics/definitions` | GET | `listMetricDefinitions` |
| `/api/admin/analytics/metrics/[metric-code]` | GET | `getMetricSeries` |
| `/api/admin/analytics/overview` | GET | `getAnalyticsOverview` |
| `/api/admin/audit/[audit-event-id]` | GET | `getAdminAuditEvent` |
| `/api/admin/audit` | GET | `listAdminAuditEvents` |
| `/api/admin/banners/[banner-id]/media/[media-id]` | GET | `getAdminBannerMediaContent` |
| `/api/admin/banners/[banner-id]/media` | GET, POST, PATCH, DELETE | `getAdminBannerMedia`, `uploadAdminBannerMedia`, `updateAdminBannerMedia`, `removeAdminBannerMedia` |
| `/api/admin/banners` | GET, POST | `listAdminBanners`, `saveAdminBanner` |
| `/api/admin/bootstrap` | GET | `getAdminBootstrap` |
| `/api/admin/capabilities` | GET | `listCapabilityDefinitions` |
| `/api/admin/catalog/categories/[category-id]` | GET, PATCH | `getAdminCategory`, `updateAdminCategory` |
| `/api/admin/catalog/categories/[category-id]/status` | POST | `setAdminCategoryStatus` |
| `/api/admin/catalog/categories` | GET, POST | `listAdminCategories`, `createAdminCategory` |
| `/api/admin/catalog/products/[product-id]/categories` | PATCH | `setAdminProductCategories` |
| `/api/admin/catalog/products/[product-id]/media/[media-id]/content` | GET | `getAdminProductMediaContent` |
| `/api/admin/catalog/products/[product-id]/media/[media-id]` | PATCH, DELETE | `updateAdminProductMedia`, `removeAdminProductMedia` |
| `/api/admin/catalog/products/[product-id]/media` | POST | `uploadAdminProductMedia` |
| `/api/admin/catalog/products/[product-id]` | GET, PATCH | `getAdminProduct`, `updateAdminProduct` |
| `/api/admin/catalog/products/[product-id]/status` | POST | `setAdminProductStatus` |
| `/api/admin/catalog/products` | GET, POST | `listAdminProducts`, `createAdminProduct` |
| `/api/admin/catalog/skus/[sku-id]/availability` | PUT | `setAdminSkuAvailability` |
| `/api/admin/catalog/skus/[sku-id]/price` | POST | `setAdminSkuPrice` |
| `/api/admin/catalog/skus/[sku-id]/prices` | GET | `getAdminSkuPrices` |
| `/api/admin/catalog/skus/[sku-id]` | PATCH | `updateAdminSku` |
| `/api/admin/catalog/skus` | POST | `createAdminSku` |
| `/api/admin/catalog/units` | POST, GET | `createAdminUnit`, `listAdminUnits` |
| `/api/admin/commerce-configuration/membership-price` | GET, POST | `getMembershipPriceConfiguration`, `updateMembershipPriceConfiguration` |
| `/api/admin/commerce-configuration` | GET, POST | `getGlobalCommerceConfiguration`, `pauseSelling`, `openSelling`, `activateGlobalMode` |
| `/api/admin/context` | GET | `getAdminContext` |
| `/api/admin/customers/[customer-id]/access` | POST | `changeCustomerAccess` |
| `/api/admin/customers/[customer-id]/closure-requests` | POST | `requestCustomerClosure` |
| `/api/admin/customers/[customer-id]/notes` | GET, POST | `listCustomerSupportNotes`, `appendCustomerSupportNote` |
| `/api/admin/customers/[customer-id]/profile` | GET, POST | `getAdminCustomerProfile`, `updateAdminCustomerProfile` |
| `/api/admin/customers/[customer-id]` | GET | `getAdminCustomer` |
| `/api/admin/customers/[customer-id]/sessions/revoke` | POST | `revokeCustomerSessions` |
| `/api/admin/customers/invitations/revoke` | POST | `revokeCustomerInvitation` |
| `/api/admin/customers/invitations` | GET, POST | `listCustomerInvitations`, `inviteCustomer` |
| `/api/admin/customers` | GET | `listAdminCustomers` |
| `/api/admin/delivery-cycles` | GET, POST | `listAdminCycleDestinations`, `listAdminDeliveryCycles`, `saveAdminDeliveryCycleDraft`, `cancelAdminDeliveryCycle`, `scheduleAdminDeliveryCycle` |
| `/api/admin/delivery-location-profile` | GET, PUT | `getLocationDeliveryProfile`, `upsertLocationDeliveryProfile` |
| `/api/admin/delivery-promises` | POST | `reviseDeliveryPromise` |
| `/api/admin/delivery` | GET | `listDeliveryOperations` |
| `/api/admin/exceptions` | GET, POST | `listOperationalExceptions`, `resolveAdminOperationalException` |
| `/api/admin/external-deliveries/[dispatch-id]/cancel` | POST | `cancelExternalDelivery` |
| `/api/admin/external-deliveries/[dispatch-id]/refresh` | POST | `refreshExternalDelivery` |
| `/api/admin/external-deliveries` | POST | `requestExternalDelivery` |
| `/api/admin/fulfillment` | GET, POST | `listFulfillmentQueue`, `advanceAdminFulfillment` |
| `/api/admin/inventory-distribution` | GET | `listInventoryDistribution` |
| `/api/admin/inventory/[inventory-pool-id]/adjustments` | POST | `adjustInventory` |
| `/api/admin/inventory/[inventory-pool-id]/ledger` | GET | `getAdminInventoryLedger` |
| `/api/admin/inventory` | GET | `listAdminInventory` |
| `/api/admin/inventory/sort` | POST | `sortInventoryStock` |
| `/api/admin/jobs` | GET | `adminScheduledJobRuns` |
| `/api/admin/location-fulfillment` | GET, POST | `getAdminLocationFulfillment`, `configureAdminLocationFulfillment` |
| `/api/admin/location-schedule` | GET, POST | `getAdminLocationSchedule`, `saveAdminLocationSchedule` |
| `/api/admin/locations` | GET, POST | `listAdminLocations`, `createAdminLocation`, `updateAdminLocation`, `transitionAdminLocation` |
| `/api/admin/manual-deliveries` | POST | `manageManualDelivery` |
| `/api/admin/memberships/[subscription-id]/cancel` | POST | `cancelAdminMembership` |
| `/api/admin/memberships/[subscription-id]` | GET | `getAdminMembership` |
| `/api/admin/memberships` | GET | `listAdminMemberships` |
| `/api/admin/operations-activity` | GET | `listOperationalActivity` |
| `/api/admin/order-issues/[issue-id]/actions` | POST | `applyAdminOrderIssueAction` |
| `/api/admin/order-issues/[issue-id]` | GET | `getAdminOrderIssue` |
| `/api/admin/order-issues` | GET | `listAdminOrderIssues` |
| `/api/admin/orders/[order-id]/cancel` | POST | `cancelAdminOrder` |
| `/api/admin/orders/[order-id]` | GET | `getAdminOrder` |
| `/api/admin/orders` | GET | `listAdminOrders` |
| `/api/admin/overview` | GET | `getAdminOverview` |
| `/api/admin/payments/[payment-intent-id]` | GET | `getAdminPayment` |
| `/api/admin/payments/attention` | GET | `listAdminPaymentAttention` |
| `/api/admin/payments/event-retry` | POST | `retryAdminProviderEvent` |
| `/api/admin/payments/reaction-retry` | POST | `retryAdminPaymentReaction` |
| `/api/admin/payments/recheck` | POST | `recheckAdminPayment` |
| `/api/admin/payments/refunds/recheck` | POST | `recheckAdminRefund` |
| `/api/admin/payments/refunds` | POST | `requestAdminRefund` |
| `/api/admin/payments` | GET | `listAdminPayments` |
| `/api/admin/privacy-requests/[privacy-request-id]/actions` | POST | `applyPrivacyAction` |
| `/api/admin/privacy-requests` | GET | `listPrivacyRequests` |
| `/api/admin/procurement/aggregate` | POST | `aggregateAdminProcurementDemand` |
| `/api/admin/procurement/purchase` | POST | `confirmAdminProcurementPurchase` |
| `/api/admin/procurement` | GET | `listProcurementRequirements` |
| `/api/admin/procurement/week` | GET | `getAdminScheduledWeek` |
| `/api/admin/promotions/[promotion-id]/audience` | GET, PATCH | `getAdminPromotionAudience`, `setAdminPromotionAudience` |
| `/api/admin/promotions/[promotion-id]/grants` | GET, POST | `listPromotionGrants`, `grantAdminPromotion` |
| `/api/admin/promotions/[promotion-id]/media/[media-id]` | GET | `getAdminPromotionMediaContent` |
| `/api/admin/promotions/[promotion-id]/media` | GET, POST, PATCH, DELETE | `getAdminPromotionMedia`, `uploadAdminPromotionMedia`, `updateAdminPromotionMedia`, `removeAdminPromotionMedia` |
| `/api/admin/promotions/[promotion-id]/preview` | POST | `previewAdminPromotion` |
| `/api/admin/promotions/[promotion-id]/redemptions` | GET | `listPromotionRedemptions` |
| `/api/admin/promotions/[promotion-id]` | GET, PATCH | `getAdminPromotion`, `updateAdminPromotion` |
| `/api/admin/promotions/[promotion-id]/status` | POST | `changeAdminPromotionStatus` |
| `/api/admin/promotions` | GET, POST | `listAdminPromotions`, `createAdminPromotion` |
| `/api/admin/receiving/complete` | POST | `completeAdminReceiving` |
| `/api/admin/receiving/counted` | POST | `recordScheduledCountedReceipt` |
| `/api/admin/receiving/record-line` | POST | `recordAdminReceivedLine` |
| `/api/admin/receiving` | GET | `listReceivingSessions` |
| `/api/admin/receiving/start` | POST | `startAdminReceiving` |
| `/api/admin/receiving/surplus` | POST | `releaseScheduledSurplus` |
| `/api/admin/roles/[role-id]/archive` | POST | `archiveAdminRole` |
| `/api/admin/roles/[role-id]/capabilities` | PUT | `setAdminRoleCapabilities` |
| `/api/admin/roles/[role-id]` | GET, PATCH | `getAdminRole`, `updateAdminRole` |
| `/api/admin/roles` | GET, POST | `listAdminRoles`, `createAdminRole` |
| `/api/admin/scopes` | GET | `listAdminScopes` |
| `/api/admin/serviceability` | GET, POST | `getAdminServiceability`, `previewAdminServiceability`, `publishAdminServiceArea` |
| `/api/admin/staff/[staff-id]/access` | POST | `changeAdminStaffAccess` |
| `/api/admin/staff/[staff-id]/roles` | PUT | `setAdminStaffRoles` |
| `/api/admin/staff/[staff-id]` | GET, PATCH | `getAdminStaff`, `updateAdminStaff` |
| `/api/admin/staff/[staff-id]/scopes` | PUT | `setAdminStaffScopes` |
| `/api/admin/staff/[staff-id]/sessions/revoke` | POST | `revokeAdminStaffSessions` |
| `/api/admin/staff/invitations/[invitation-id]/revoke` | POST | `revokeAdminStaffInvitation` |
| `/api/admin/staff/invitations` | GET, POST | `listAdminStaffInvitations`, `inviteAdminStaff` |
| `/api/admin/staff` | GET | `listAdminStaff` |
| `/api/admin/transfers/[transfer-id]/cancel` | POST | `cancelInventoryTransfer` |
| `/api/admin/transfers/[transfer-id]/dispatch` | POST | `dispatchInventoryTransfer` |
| `/api/admin/transfers/[transfer-id]/receive` | POST | `receiveInventoryTransfer` |
| `/api/admin/transfers/[transfer-id]/resolve` | POST | `resolveInventoryTransfer` |
| `/api/admin/transfers/[transfer-id]` | GET | `getInventoryTransfer` |
| `/api/admin/transfers/options` | GET | `getInventoryTransferOptions` |
| `/api/admin/transfers` | GET, POST | `listInventoryTransfers`, `createInventoryTransfer` |
