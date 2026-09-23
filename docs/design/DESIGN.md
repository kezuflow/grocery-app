# FreshMarkets Design

## Payments simplification — owner decisions 2026-09-21

Implemented locally under
[PAYMENTS_SIMPLIFICATION_PLAN.md](../product/PAYMENTS_SIMPLIFICATION_PLAN.md). Use one Payments
destination with a paid-payments/refunds list and a Needs attention view. Ordinary unpaid/expired
attempts have no collection view or All attempts filter. Reuse the full-width Admin master/detail
pattern, readable customer/Order identity and typed Core action availability. Show only relevant
financial facts and a specific explanation of actual problems; group multiple cases for one Payment.
Put technical evidence under a collapsed disclosure and omit empty diagnostic sections, raw status
enums, workload charts, duplicate overview/reconciliation navigation and routine recovery forms.
Resolved issues disappear automatically after verified completion; no Close case acknowledgment.
Keep refund confirmation and identical-command recovery where required, and never display an unpaid
amount as received or refundable. Existing unpaid deep links may show read-only context without
restoring an unpaid collection. The owning PRODUCT supplement defines financial and expiry meaning.
The implementation uses the shared resizable desktop/mobile master-detail workspace, URL-owned tab,
paid-status, cursor and mutually exclusive payment/issue selection, and distinct unavailable/error/
empty states. Local browser acceptance is recorded in the active checkpoint; production remains
unchanged until separately authorized.

## Notification panels — owner approval 2026-09-13

Storefront places its bell immediately left of Cart; Admin replaces its Overview anchor with a
compact panel while retaining Recent notifications. Both use the established shadcn Popover,
their separate token/font scopes, 44px controls, a viewport-clamped width and bounded scrolling.
Customer rows show only a short wrapping status title linked to the existing safe destination;
Order context remains in the accessible link name. The customer panel has no subtitle or X button,
and its empty state is one short line (owner simplification 2026-09-13). Admin rows retain context,
explicit date/time and action details. Admin panel and Overview share
the same scoped data/list representation and reporting timezone. The storefront bell uses the same
compact numeric badge as Cart for currently returned updates not yet opened by that account in this
browser; opening the panel clears the badge for those rows. It does not add row controls, dots, motion
or cross-device read receipts. The Admin bell remains unchanged. Loading, empty, signed-out/denied,
unavailable and retry states remain distinct.
Customer opening focuses the panel heading; Admin opening focuses Close. Tab reaches links;
Escape, the bell and outside click dismiss with focus returned to the bell. Admin also retains Close. Navigation closes the panel. The panel has no entry/exit or decorative notification animation. The compact numeric badge alone may use the restrained count-change feedback below; reduced-motion removes its movement.

Mobbin MCP research inspected DoorDash's [home bell](https://mobbin.com/screens/746c0aa0-aec7-443e-b502-9f3903e5b1c2),
[caught-up feed](https://mobbin.com/screens/8239b91a-6531-42dc-a159-52236b81f35e),
[active-order feed](https://mobbin.com/screens/aff3baf7-3bb3-4f49-bdac-0e2803a33c38)
and [web notification drawer](https://mobbin.com/flows/6c6e1cef-e282-45f9-b25f-e8d39ac6cfa8).
Adapt concise status/context/time rows and a calm empty state, keeping FreshMarkets branding and copy.
Instacart's [confirmed](https://mobbin.com/screens/47fda39a-c618-4f2b-8ac1-7ccb7c7f3b02),
[heading to customer](https://mobbin.com/screens/1ea1bd7a-7b38-4ad2-8215-80154f0f81a7)
and [delivered](https://mobbin.com/screens/18c0be65-b4fd-4af0-b1ac-77615eab59dd) screens support
explicit transaction status and existing receipt/help destinations. Uber Eats
[order tracking](https://mobbin.com/screens/755dd9ed-b4ae-4a01-b06f-035d9b1e0592) supplied mobile
status hierarchy; no Instacart bell/inbox or Uber Eats inbox was found.
Shopify's [alert panel](https://mobbin.com/screens/668a7524-57c0-476a-8ce1-6f9cb05f85da) supports the
Admin anchored list, while Faire's [action-required row](https://mobbin.com/screens/2af5769e-ba38-4609-a166-ca1221de2d2c)
supports explanatory next steps. Fiverr's [Order notifications](https://mobbin.com/flows/bf5a190c-6a58-492e-aedf-55f2e9a59e19)
uses day grouping/relative times; the bounded Admin list uses explicit dates without redundant
group headings, while customer rows follow the owner title-only presentation. Reference read-state workflows and proprietary assets/wording are excluded.
Static images cannot verify focus, keyboard, outside dismissal, breakpoints or reduced motion;
those require executed FreshMarkets interaction/browser evidence.

Follow [PRODUCT.md](../product/PRODUCT.md) and the protected discussion it indexes. These presentation rules were extracted from existing design documents; they constrain agreed workflows and do not authorize new screens or a redesign. [ENGINEERING.md](../architecture/ENGINEERING.md) owns contracts, safeguards and verification. Archived proposals do not add scope.

## Ordinary Admin work

Owner correction, 2026-09-13: Locations is a sidebar parent with Locations and Service Areas
destinations, visible in Global and selected-location navigation when Core authorizes Locations.
Service Areas remains Global configuration; selecting a location does not assign polygons to it.
Location fulfillment forms distinguish saved readiness from unsaved edits, require a reason when
saving, show pending/rejected/unconfirmed saves inline, and toast only confirmed success. Dispatch
readiness applies to both modes; the minutes promise applies only to Instant.

Owner follow-up, 2026-09-13: location setup uses four numbered steps: Location (address and map pin),
Pickup contact, Instant operating hours, Review and enable. Each destination uses the location in the URL;
pickup configuration no longer lives above the Delivery queue or depends on the header scope.
Delivery remains the operational queue. Confirmed saves advance to the next step; failed or unknown
saves retain the step and original intent. Navigation shows saved progress and allows returning to
existing steps, with step links locked while a write is pending or unconfirmed. Pickup reuses the saved
location address and coordinate, asking only for contact and instructions. The final review explicitly
activates an inactive location and separately saves dispatch readiness under Core's existing guards.
View-only access does not enable writes. Scheduled weeks remain separate from Instant operating hours;
their checkout eligibility follows the cycle opening and cutoff while the customer total still requires
a supported future courier quotation for the planned pickup.

Owner follow-up, 2026-09-13: the Scheduled cycles workspace presents one cycle as an ordering period,
one fulfillment plan and one customer arrival range. It hides the internal Market and delivery-zone
layers, labels participating customer-fulfillment locations by their location names, and omits the
obsolete window-name and add/remove-window controls. A different pickup or arrival plan is a separate
cycle. Cycle summaries retain status, timezone, operational times, arrival range and fulfillment
locations. Customer checkout and Order detail show the arrival range without an internal window label.

Owner follow-up, 2026-09-13: each cycle summary places its primary lifecycle action beside the cycle
name. Complete drafts show Activate; Scheduled/Open cycles show Deactivate when guarded cancellation is
available. The ordinary workspace has no separate activation/deactivation reason fields. Deactivate
requires a concise confirmation that it closes unstarted quotes and cannot be undone for that cycle;
Core continues to block it when committed or unresolved work exists.

Owner redesign, 2026-09-20: Scheduled cycles keeps the calendar as the primary workspace under
`/admin/settings/scheduled-cycles`. Month is the default desktop view and shows one connected cycle as
a compact ordering-period bar plus customer-delivery duration; Week adds exact milestone markers and
Agenda is the chronological/mobile default. Every derived element selects the same parent cycle and
highlights its related elements. Procurement, preparation and planned pickup remain timestamp markers,
never invented durations or inferred completion. The selected cycle opens a customer-delivery-first
timeline beside the calendar only when width permits; narrower screens use an overlay/full-screen panel
without squeezing seven columns. Range, filters and calendar position remain mounted across panel work.

Creation is delivery-first and uses business-timezone date/time controls. On Month, dragging from an
empty order-opening date through the intended customer-delivery date prefills that complete planning
horizon; the range end is inclusive in the interaction, exact opening/cutoff/fulfillment times remain
editable, and the cutoff is only a working suggestion before delivery. Clicking one empty date
continues to prefill the customer delivery date explicitly, while New cycle remains the keyboard and
mobile fallback. A new cycle may suggest an editable name and working schedule, while duplicate shifts
proposed dates relative to the chosen delivery date without moving the original or overwriting edited
business times. The three editor stages are Delivery and
locations, Schedule, and Review and save. Inline chronology feedback preserves the existing weak
ordering between cutoff/procurement/preparation/pickup, keeps the future-cutoff rule, and never silently
repairs another field. An unsaved preview is visually distinct. Draft save remains separate from
activation. Activation explains that the schedule locks; deactivation uses the named confirmation
dialog and Core-provided blocked reason. Unknown command recovery stays inside the open panel with the
original request and idempotency identity. Historical multiple delivery ranges remain readable.

Owner follow-up, 2026-09-20: a newly suggested schedule opens ordering at 12:00 AM on its first day
and uses 11:59 PM on the day before delivery as the full-day cutoff. Procurement begins at 12:00 AM
on delivery day, exactly one minute later, preparation at 2:00 AM and planned pickup at 4:00 AM. These
are editable Web suggestions only; Core chronology and activation guards remain authoritative.

Service Areas supports clicking the map to draw up to 100 ordered boundary points, selecting a point
to move it by dragging or clicking, undoing the last point, and clearing the unsaved boundary.
At least three points form the shaded draft; the last joins the first. Coordinates are a secondary
manual-entry option. Only Publish changes the active area, with the existing reason, validation and
unknown-response safeguards. Map clicks must not depend on an unrelated draggable address pin.

Use ordinary Create/Save actions, named products/locations/people and readable quantities. Keep IDs, expected versions, idempotency identities, storage observation and retry machinery internal. After an uncertain response, preserve the original intent behind the same action and prevent conflicting replacement. Do not optimistically show a financial or operational commitment before Core confirms it. Keep useful payment/refund diagnostics and actual business discrepancies visible.

Administrator work covers the agreed products/images/selling sizes/exact-location prices, promotions, customers, Orders/reports/refunds, fulfillment locations, Global service areas and explicit selling/mode/schedule controls, staff access and business-wide reporting. The Core-authorized Locations workspace stays visible in both Global and selected-location navigation so administrators can find the fulfillment-center pin editor without changing scope; its Global Service areas link opens a simple numbered list with Add service area, one named polygon editor and a customer-pin preview. Do not show per-location polygon assignment or nested delivery zones. The underlying location capability and resource scope still govern reads and writes. Operations staff sees only assigned-location Orders, stock, preparation/packing, delivery/handover and approved reports. When an authorized fulfillment location is selected, Fulfillment is a first-class Operations destination beside Inventory and Delivery; it remains hidden in Global presentation because every queue read and action requires an exact operational location. Core supplies authorized navigation, scope options and legal actions; changing a filter never adds access. The current Admin selector offers Global and authorized locations; Market remains an internal scope layer. Exact-location price reads/writes require `prices.read`/`prices.manage` and operational scope over that fulfillment location; Global scope may authorize any location but is not the price-editing presentation surface.

Normal preparation is a paid-order list, Start preparing, an ordered-quantity checklist, general Report a problem and Ready for pickup after packing. On Instant, Start packing also begins automatic Lalamove booking and shows Booking, Finding rider, Rider assigned, Out for delivery, Delivered, Booking failed, or Awaiting provider confirmation without requiring reload. Packing continues independently. After definite failure and packing, Delivery offers Retry Lalamove or Manual; uncertain outcomes expose refresh/reconciliation but no replacement. Scheduled keeps the post-pack choice of Request Lalamove or Assign manual rider and may use an allowed immediate or future pickup within its commitment. Manual assignment requires the person's name and phone, system audit evidence, an optional operational note, and explicit handover/result/cost evidence.

Customer reports have one order-level entry and administrator handling; affected-item selection is optional. Daily manual review is the operating practice, not a new scheduler or resolution guarantee. Keep reports separate from refund approval. Use one administrator Problems list linked to Orders, with New / Being handled / Resolved, contact details and a short resolution note. The approved delivery-week view gathers dates/cutoff, offered products, paid Orders, purchase quantities and receiving/preparation progress. Supplier contact remains manual. These ordinary screens do not require a broader exception-management console. Existing operational and financial safeguards are retained internally.

Owner addition, 2026-09-21 (CA-5.10): selecting a Scheduled cycle in `/admin/procurement` initially shows Order summary before Quantities to buy, Paid orders and Offered products. Present full-scope paid Order/Product/selling-option/destination statistics above a semantic desktop table with Product, selling option, paid Orders, sold units, exact paid quantity and, for Global, destinations. Gram totals use exact readable kilograms when appropriate and pieces use `pcs`; do not imply available stock. Narrow screens use readable bordered records rather than a horizontally overflowing table. Keep the explanation, loading/error/empty state, section controls and pagination keyboard-accessible; the empty state says that no paid products are recorded for the cycle. Quantities to buy remains the separate destination-specific purchase/action surface.

## Products, promotions and stock

- Add/Edit Product includes ordinary Images with previews, up to five active photos, main-image selection, rearrangement, replacement/removal, alt text and normal progress/errors. Five are not mandatory. Customer detail shows all available photos. Cleanup is internal.
- Product identity/category/selling size and current exact-location price are distinct. Weight portions share exact gram stock; whole named-size pieces/packs use actual local counts. Approximate per-option grams are description/shipment evidence, never an exact stock conversion. Use the approved names and contents, not internal pool/ledger vocabulary.
- The promotion form uses named targets, controlled amounts/dates/limits and an honest preview. Display regular and sale prices; apply the approved one-sale-per-item/full-price-grocery-code/delivery rule. Explain remaining sale allowance and full-item eligibility without splitting quantities automatically. Support percentage or fixed amount off each selling unit. Prevent overlapping product sales for the same option/location. Apply PRODUCT's remaining-sale quantity and eligible-cancellation restoration rules; stock changes do not require an operator to repair promotion counters.
- The location stock list shows physical, held/reserved and available quantities with Add stock and Remove stock, a removal reason and dated actor history. Order movements happen automatically. Scheduled received goods remain allocated to paid demand and are not entered again as Instant stock.
- Receiving uses one linked form for sent/received quantities and actual size counts, retaining differences and avoiding a second Add stock step. Direct supplier receiving supports the first Scheduled location; those goods remain assigned to paid weekly Orders.
- Warehouse transfers are an explicitly approved supplement. Global drafts/dispatches from named warehouses/products/destinations; destination checks accepted and remaining damaged/missing quantities. Drafts have no stock effect. Show sent, accepted and outstanding evidence separately. Global may record a reasoned loss or confirm a physically received, inspected sellable return. Fully accounted dispositions say Resolved, not Received. Global distribution separates central/site physical, reserved, held, transit and damaged/missing subsets without another authoritative balance. Keep unknown retries behind the same action. The one-site Scheduled launch does not require daily transfer work.

## Admin visual foundation

Use existing shadcn/ui primitives: buttons, inputs, selects, checkboxes/radio/switches, dialogs/sheets, menus/popovers/tooltips, tabs/breadcrumb/sidebar, table, skeleton/alert/badge, calendar/command/form and installed toast primitives. Preserve their accessible behavior. Custom compositions need a real repeated or domain-specific purpose; an old component inventory is not a build list.

Retain the current Admin visual system when changing an agreed screen:

- Isolate tokens beneath `.fm-admin`; do not change storefront tokens. Persisted light/dark appearance, a neutral canvas, controlled orange accent and fixed five-step orange chart palette remain. Semantic success/warning/danger/information keep their meaning. No arbitrary font/radius/theme settings are required.
- Desktop rail uses the existing 64px layout/66px fixed shell and 256px expansion. Collapsed `12px 4px` padding keeps the 32px icon axis aligned with expanded 8px container/group padding. The preference persists. Rail/labels transition together over 200ms linear, controls over 150ms; the content inset is 8px beside the collapsed rail. Preserve the restrained rounded frame/shadow.
- The full-height rail has the compact mark; expanded rail shows the lowercase wordmark and navigation search. Parent rows toggle children together; the most-specific route is active and opens its parent. Collapsed entries have accessible right tooltips and click menus for children, not hover-only flyouts.
- The 56px header begins with the rail toggle and explicit scope selector, followed by useful environment/marketplace/cycle/notification/appearance/staff controls. Appearance stays between notifications and staff. Mobile shows mark/wordmark and a Sheet at the `md` breakpoint and below; no truncated bottom Admin navigation.
- Use 24px desktop gutters, thin neutral borders, restrained shadows, compact headers and 12–14px supporting text. Reserve color for meaningful status/decisions. No demo revenue, celebratory, review or visit-source modules without an approved authoritative read model.

The public Shadcn UI Kit dashboard is a geometry/interaction reference only. FreshMarkets owns its code, copy, data and assets; no proprietary source/assets/demo values become implementation or fallback data.

## Admin craft repair program — 2026-09-12

Owner approval, 2026-09-12: repair the pinned Admin visual system so its intended behavior actually renders, plus the approved additions below. This does not change the pinned token palette, rail/header geometry, or restrained visual language.

- Overlay motion comes from `tw-animate-css`: popovers/selects/menus/tooltips enter and exit with origin-aware fade/scale (150–250ms, ease-out family); modals and the command palette stay centered; sheets slide with a fading scrim. Radix `data-state` exit animations are the standard. Keyboard-repeated navigation stays unanimated, and reduced-motion keeps color/opacity transitions while collapsing movement animations.
- Control feedback: pressable controls scale to 0.97 on `:active` over 150ms ease-out (`--fm-motion-fast`); control hover/focus colors use tokens (`--fm-primary-hover`, `--fm-primary-foreground`, `--fm-destructive-hover`), not literals. Tooltips wait 400ms before first show and skip the delay for subsequent tooltips.
- Selected detail content in Products, Categories, Orders, Customers and Banners may reveal with a 150ms opacity/2px transition inside the existing master-detail frame. Promotion status keeps its control footprint while the pending spinner crossfades; inventory distribution opens as a 200ms grid disclosure with a turning chevron. Reduced-motion retains opacity feedback but removes movement and disclosure travel. These transitions do not imply a successful command.
- One status pill: `AdminStatusPill`/`StatusBadge` render the `fm-admin-status-*` tone classes (rounded-full, min-height 24px). The old `.fm-product-status-*` classes and the per-badge `role="status"` live regions are removed; live announcements stay with AdminPageState/AdminLiveRegion/CommandBanner.
- Toasts: Sonner is mounted inside the Admin scope (token-mapped colors, persisted dark appearance) and beside the auth provider. A toast only reports what Core already confirmed (transient full-success or a retryable browser failure such as clipboard write); pending, failed, conflict and partial outcomes keep persistent inline banners. Nothing toasts a financial or operational commitment before Core confirms it.
- Command palette: Ctrl/Cmd+K opens a cmdk palette over the same capability-filtered navigation the shell renders; it only navigates and never widens access. A desktop search trigger with its shortcut hint sits in the header after the scope selector; mobile keeps the Sheet navigation search.
- Token cohesion: shadcn-style semantic utilities (`bg-muted`, `text-muted-foreground`, `ring-ring`, …) are bridged to `--fm-*` tokens through `@theme inline` so Admin scoping and dark appearance resolve per element. Shared primitives use `--fm-background`/`--fm-text` instead of oklch literals or `dark:` variants; Admin surfaces use `--fm-admin-surface` instead of `bg-white`; the `.bg-white` and overlay dark-mode CSS patches are removed. Chart tooltips use admin tokens (`AdminChartTooltipContent`). `FilterBar` has one implementation in admin-controls with `section`/`card` variants.

## Lists, details, forms and reports

Owner correction, 2026-09-12: Admin workspaces are no longer centered inside a fixed-width page container and do not render breadcrumbs. Resource collections use the full-bleed responsive master-detail pattern established by Promotion Codes and Promotion Sale: the master remains visible while a resizable, independently scrolling detail/editor pane opens beside it on desktop and slides over it on smaller screens. Products, Categories, Orders, Customers and Banners use this shared pattern first; Add Product and Add Category open their complete existing authoring flows in that pane instead of navigating away from the collection. Other Admin surfaces use the full available canvas and add a detail pane only when a real selected resource or authoring task exists. Dedicated resource URLs remain available for deep links, refresh recovery and complex workflows.

Owner correction, 2026-09-12: selecting a Product opens its authoritative scoped preview in the right master-detail pane; it does not open Add Product. The preview shows the Product image and identity, current status, real selling options with available prices and statuses, catalog metadata, and full-detail/edit actions. Add Product uses the same pane only when the operator explicitly invokes that action. Switching between selection and creation preserves the Product list as the master context.

Owner correction, 2026-09-21, superseded in part 2026-09-22: selecting any non-interactive area of an Order list row opens an Order Preview in the right master-detail pane. The preview reads authoritative Order detail, presents every immutable ordered-item snapshot in a semantic table, and provides a compact status selector. The selector exposes only Core-authorized lifecycle commands; cancellation retains its consequence and reason confirmation, while fulfillment and delivery transitions remain with their owning operational workflows. The list Status cell presents customer-meaningful current progress from the Order, Fulfillment and courier facts: Committed, Picking, Ready to pack, Packing, Ready for pickup, Finding rider, Rider assigned, Out for delivery and Delivered, with explicit exception/cancellation results. Preparation and courier badges may overlap for the automatic Instant booking that begins at Start packing, as well as retained/recovering attempts. A bare Delivery Job `UNASSIGNED` value is not shown as the Order's status. The dedicated full Order route remains available for the complete financial, delivery, issue and timeline record.

Owner supplement, 2026-09-23: the Order Preview and full Admin Order route link directly to the
selected Order in Fulfillment and Delivery. The Fulfillment detail presents its next legal preparation
step prominently, including Start packing after picking is finished. Core still derives the actions
from the current scoped state; courier assignment, pickup and delivery follow their provider or
manual execution facts rather than an editable commercial Order status.

Owner-approved operations alignment, 2026-09-22, corrected later that day: selected-location Fulfillment presents paid operational Orders as New, Preparing, Ready for dispatch, Upcoming Scheduled, and History views. Selecting a row keeps the list mounted and opens a reusable detail with recipient, committed timing, immutable original and paid-addition quantities, Instant reservation or Scheduled allocation/receiving evidence, blockers, and only Core-authorized named actions. Instant Start packing automatically books Lalamove; Scheduled packed work links to the ordinary Manual/Lalamove choice. Definite Instant failure exposes retry and Manual recovery after packing. The header bell and mounted Fulfillment/Delivery work use one lightweight selected-location refresh owner, preserve prior content while revalidating, and visibly mark delayed updates.

Owner correction, 2026-09-12: the Product table row is the preview selection surface, not only the Product name. Clicking any informational cell opens that row's Product preview and visibly marks the open row. Checkbox selection, menus, links and other nested controls keep their own behavior and must not trigger the preview. The Product identity retains an explicit keyboard-focusable Preview control with the controlled pane relationship.

Owner correction, 2026-09-12: in the Product preview, the Status label and status pill share one compact horizontal row. Do not wrap the pill in a bordered field-like container; the section divider supplies sufficient structure.

Owner correction, 2026-09-21: the rest of Product authoring follows the supplied companion references without restoring breadcrumbs or demo facts. Create Product provides a live customer-facing preview from the entered identity, chosen category, main draft image and first selling option; it clearly defers exact-location price and availability until those authoritative records can exist. The embedded creator stays single-column and independently scrollable, while the dedicated fallback may place that preview beside the editor. Edit Product uses a responsive details/images workspace, a visible unsaved-change state and persistent Cancel/Save actions; image cards retain replacement, removal, main-image, order, alt-text and recovery behavior. Global and fulfillment-location Product previews are different compositions. Global shows catalog identity, lifecycle and selling-option definition with full-detail/edit actions and no price editor. A selected fulfillment-location preview shows that location's price, selling state and stock context; an authorized operator clicks the displayed price, edits it inline and saves one immediate exact-location price intent. An unknown response retains the original body and idempotency key for retry and prevents closing or selecting another Product until resolved.

Owner correction, 2026-09-21: authorized Global Product previews directly manage the Product name, Product lifecycle, each selling option's global lifecycle, and multiple category memberships. The name is an editable text field. Product and selling-option statuses use compact select fields with a visible up/down affordance. Categories use one field-like multi-select dropdown rather than removable pills; its collapsed value shows the primary category and additional selection count, while the open menu identifies the primary selection. Each category choice saves immediately through the guarded category command; there is no separate category Save or Cancel step. Category order identifies the primary category used by compatibility projections. These controls do not appear in fulfillment-location previews.

Lists show title, scope/date/cycle context where relevant, one primary action, useful search/status/date filters, result count and bounded pagination. Use stable server-side sort/cursors, URL filters/tabs, clear-all and visible active filters. Product Filters and Columns controls share a toolbar; safe bulk selection replaces that toolbar with count/action/cancel. Bulk actions require real domain semantics and show preflight scope and explicit partial outcomes. No raw-table completeness requirement.

Rows emphasize identity, meaningful status/deadline, scope and next action. Secondary fields move to detail or responsive expansion. Row links/action menus are keyboard accessible. Preserve filtered-list return context and the most-specific route without rendering breadcrumbs; resource-ID details are contextual, not permanent navigation. Sticky headers/action bars may support long work.

Details show human-readable identity, scope, status, legal next action and relevant items/financial/timeline/delivery/history sections. Irreversible commands show exact target/amount/quantity and consequence, with a reason only where the owning policy requires one. Ordinary product/media saves do not gain operational confirmation/reason steps. Group forms by business concept, with labels/help, validation, unsaved-change handling and scope/effective-time impact where relevant.

Initial read-heavy data comes from a vinext Server Component through the Core binding as a plain DTO. Browser APIs handle later pages/refreshes/commands; avoid a server-to-mounted-client-to-local-API waterfall. Browser-stored scope/price context is advisory. Core owns all access and totals.

Overview answers the approved work questions: new paid Orders, preparation, packed pickup, deliveries, administrator-handled problems and refund attention. Show active mode and Scheduled cutoff/date/purchase quantities when relevant. Link each section to authorized underlying records. Reports cover Orders, received/refunded money separately, products/selling sizes sold, discounts, accepted-versus-actual delivery cost, new customers, unique purchasing customers and repeat customers/orders. Use PRODUCT's approved definitions; recurring-order analytics means repeat purchases. Definitions/date basis/currency/units/freshness must be explicit; denied, unavailable and unknown cost are never zero.

Accessible Recharts compositions use a title, definition/freshness context, semantic status, labels/descriptions and a textual value summary. No chart is the sole way to obtain an operational value. A metric name or archived formula does not approve an additional report.

## Marketplace journey

Use mature grocery-commerce patterns inspired by DoorDash, with FreshMarkets branding and fixed selling choices. No restaurant assumptions, hub selection, copied logos/assets/screens, arbitrary weights, freely edited paid Orders or invented delivery ETA.

Primary customer surfaces are Home, search/categories, product detail, cart, checkout, account/address book, Order history/status and support. Browse/search/cart are public; sign-in carries the cart into authenticated checkout. First visit asks Where should we deliver? using address/map pin and optional device location. Skip permits general browsing; local prices/availability/cart additions require a resolved location. Checkout confirms full address, recipient/phone and serviceability. Never assume device-location consent or default a customer into a fabricated local-stock context.

Use strong search, shallow category context, fixed variant labels, horizontal category/product rails on mobile and clear empty/no-result recovery. Preserve useful query/filter state in URLs. Cards prioritize image/alt, name, variant, current price/eligible sale, availability and Add; the Add/quantity stepper keeps a stable footprint. Staff packing instructions and raw stock/ledger data stay private.

Product detail shows ordinary customer details, the available image gallery, fixed variant selector, current price, unit/quantity explanation and honest availability. Unavailable variants offer useful alternatives or address review. Cart keeps editable quantities, current prices, discounts and delivery context, with stale/unavailable/allowance feedback when Core has evidence. Within each cart-drawer item, the quantity stepper and line total share one row, with the total aligned to the right. A nonempty drawer offers a clear-cart action with confirmation; clearing is one authoritative bulk command and publishes one following current Cart projection only after confirmed success. The compact promo entry follows the item list in the drawer's scrollable content and on `/cart`, before the summary/action. Added intent says eligibility is checked at checkout; it never fabricates a discount. There is no general minimum-spend progress or price-lock countdown. Cart alone holds neither price nor stock. The cart drawer slides in from the right over a dimmed backdrop, locks background scrolling through its closing transition, and keeps its header and checkout summary outside the scrolling item list. Respect reduced-motion preferences and restore scrolling/focus when dismissed.

The Deliver to control opens a modal without losing browsing context: address search -> centered draggable pin -> confirm coordinate -> reverse-fill internal structured geography -> Core Global-area check -> nearest-fulfillment-pin assignment. Search selection recenters; pin changes must not overwrite recipient/instructions. Customer details show the confirmed readable destination and pin, Home/Work or a custom label, recipient/phone and one optional Delivery instructions field. Do not show separate building/unit, landmark, gate/guard, recipient-guidance or private-note inputs. If lookup supplies no usable text, allow one readable address correction. Inside an active Global service area, the confirmed pin selects the nearest eligible fulfillment location; checkout then uses Lalamove quotation for route availability and fee. Outside all active areas, show clear not-yet-serviceable feedback and do not apply the browsing location or enable checkout. Preserve provider component provenance/finalization through the owning adapters.

The customer checkout presents the one global mode returned by Core. Instant shows the current promise and verified courier choices; Scheduled shows the current eligible cycle's delivery range and cutoff. Both modes automatically obtain and present the authoritative courier fee and accepted total without asking the customer to choose a mode. One eligible option is selected without an additional choice step. Delivery rows are compact and map a Core-returned provider code to a local provider-aware mark while keeping provider, service, promise/window and cutoff visible; unavailable returned options remain visible and disabled. Preserve provider/service intent across refreshed Instant opaque IDs, but only the new Core-returned opaque option ID is selectable authority. Hide pickup planning/manual fallback internals; no hub selector. Show paused/closed-hours/unserviceable/missing-cycle/missing-quote states distinctly. Quote and book one fixed 20 kg Motorcycle parcel for every nonempty courier Order; item-weight metadata is optional and never a customer eligibility error. No separate packaging allowance or size/fit settings. Actual operating times and preparation/delivery estimates are factual inputs, and operations keeps the packed parcel within provider limits.

Checkout makes authentication, confirmed address, Instant promise/provider fee, items/discounts/total, payment handoff and commitment clear. Revalidate Core terms immediately before payment; changed terms require explicit review/acceptance. Once the current Cart, confirmed address and selected eligible courier are ready, one lifecycle owner automatically requests the authoritative quote; cart, destination, courier or promo changes release the previous attempt before the current inputs are quoted. Show the check in progress and never present selection or a browser timer as fee acceptance. Display the accepted fee beside its delivery option and refresh the complete Core quote after four minutes and thirty seconds, or at the provider-expiry safety boundary when earlier. A failed quotation keeps the explicit courier preference selected, explains the failure beside it and offers an explicit retry; payment stays blocked until a real fee and current total are available. Lost responses retry the identical request identity, and a successful response made obsolete by newer inputs is safely abandoned before replacement. Handle pending, failed, lost response, duplicate submission, expired quotation and recoverable outcomes honestly. Requested payment choices stay visibly disabled until verified provider mapping and explicit code enablement; no runtime toggle system. Application-accessible fake-payment success remains excluded.

The checkout payment-method selector groups configured methods beneath compact wrapping category tabs, then presents the active category as full-width flat rows separated by simple rules. Cash on Delivery remains visible but disabled until explicitly implemented. Payment / E-Wallet contains QR Ph, GCash, Maya, GrabPay, ShopeePay and Google Pay; Credit / Debit Card contains Visa and Mastercard; Online Banking contains BDO, BPI, Landbank, Metrobank, RCBC and UnionBank. Categories organize existing methods but never imply activation. Each method row displays only a circular selection control, bordered brand mark and readable method name, in that order; disabled styling and semantics communicate inactive methods without status pills or descriptive subcopy.

After QR Ph handoff, `/checkout/payment` automatically creates and attaches the selected PayMongo QR Ph method, displays the provider-returned dynamic code, and counts down its explicitly requested 30-minute lifetime. Preserve an unexpired code across reloads; when its timer reaches zero, replace it once under the same Payment Intent while the original payment action remains valid. Browser display or refresh is never payment success; signed provider confirmation remains the only Order-commit authority. While this step is open, use a bounded, visibility-aware authenticated status poll. Replace the QR with “Payment received” while captured money is still finalizing the Order. Only an immutable committed Order link replaces that state with “Payment successful”, “Your order is confirmed”, a persistent View order action and the self-hosted one-shot success animation. Do not loop or auto-redirect. The animation is decorative; text carries the status, and reduced-motion or player failure uses the static success mark.

Owner correction, 2026-09-13: checkout delivery choices are flat selectable rows with simple dividers. Do not wrap each choice in a gray-filled card, rounded box or card shadow; selection is communicated by color and the existing check indicator.

Owner correction, 2026-09-13, updated 2026-09-19: the complete checkout review workspace uses the white storefront background and flat sections separated by simple rules. Delivery details, saved checkout addresses, delivery/total review and the order summary must not use gray-filled card shells, rounded surface containers or card shadows. Promo editing now belongs in Cart; checkout retains quote-backed applied/rejected results and an Edit in cart path. Form controls and meaningful warning, error and success states may retain their own accessible affordances.

Owner correction, 2026-09-20: saved checkout addresses are the exception to the flat-address portion
of the rule above. Show every saved address, including the selected one, once in a single non-wrapping
horizontal row of bordered white cards. Keep selection, confirmation and edit actions inside each
card; smaller viewports scroll the row horizontally instead of stacking it. Do not reintroduce a
separate full-width selected-address summary. Delivery choices and the surrounding checkout sections
remain flat.

Owner correction, 2026-09-20: checkout keeps a persistent bottom notice with no decorative motion:
“Scheduled delivery cutoff: Friday, 11:59 PM. Orders placed after the cutoff will be scheduled for
delivery the following Saturday or Sunday.” It is a concise operating-policy reminder, not cycle or
quotation authority, and must not obscure checkout content, actions or focus. The current Core option
still supplies and enforces the exact eligible delivery range and cutoff shown in the delivery row.

Checkout keeps delivery details, delivery options and one quote-backed Order summary together in one review workspace; promotion entry itself stays in Cart. There is no second Ready to continue / Payment review panel or ordinary discard action. The summary owns nonzero item/order/delivery discounts, applied/rejected promotion evidence, delivery, applicable tax, quote expiry, delivery terms, total and the sole Continue to payment action. Before a quote it labels the Cart amount as before delivery; after acceptance every payable component comes from that one Quote revision. Resolved fee/total values use a stable tabular area, a restrained 200 ms fade/small movement and a polite live announcement, with motion removed under reduced-motion preferences. When the customer adds or corrects a checkout address, use two steps: (1) find an address or use current location and confirm the exact entrance pin, then (2) review the readable destination and enter label, recipient, phone and optional Delivery instructions. While active, this guide replaces the complete left checkout workspace rather than nesting another constrained form inside the delivery card; the cart and current total remain visible in the right summary. Step 1 uses one stable, full-width map surface at every selection state; choosing or moving a pin must not change its column count or dimensions. Place separate search and current-location icon buttons over the map. Search toggles an accessible, origin-anchored panel and returns focus to its trigger when dismissed; its results scroll over the map rather than reflowing it. Current location remains a direct independent action and must not require opening search. Saving returns to a compact confirmed-address summary and unlocks delivery choices. Existing serviceable saved addresses remain directly selectable and do not force the guide. Prefer the current Deliver to choice over a different default; a confirmed guest pin seeds step 2 after sign-in without a second search. Deleted, stale or inaccessible saved identity requires an explicit new choice. In Details, offer valid account and saved-address phone numbers as deduplicated choices while retaining a clear “Use a different number” path. Accept ordinary Philippine mobile entry in local or international form, group it with spaces while typing, and normalize the saved command to canonical `+639…` format. A destination change immediately revalidates the complete current-mode Cart in Core. Keep unavailable rows and exact reasons visible, block payment, and require explicit removal or quantity adjustment; do not stock-reroute or split. Keep the order summary sticky on wide screens; each item shows media, product and fixed-pack identity, an editable quantity control and a right-aligned line total. A quantity, destination, delivery option or promo-intent change must release any unstarted active quote before mutation/review, then automatically obtain and present the current delivery total; a started Payment keeps its destination lock.

Order detail uses immutable number/date/items/financial/address/promise snapshots and a customer-safe timeline. The primary progress rail always shows Payment successful, Packed, Out for delivery, and Delivered in that order, with a recognizable icon at each step and no horizontal scrollbar. Completed steps and the connectors between completed steps use `#00B14F`; the current step stays distinct and future steps stay muted. The fill changes over 200 ms and respects reduced-motion preferences. Packing in progress leaves Packed current and incomplete; packing completion alone does not mark delivery dispatched. Courier assignment can appear in the current detail but does not complete Out for delivery. Show a milestone timestamp only after its actual achievement when Core has reliable evidence; `NOT_STARTED` and `UNASSIGNED` setup records never date milestones. Core supplies all states, achieved times, and current detail. Current Order options contain eligible cancellation and paid additions; after Scheduled packing starts, show Cancel order disabled with its reason. Order follow-up, Buy again and What went wrong appear after delivery completes. View transaction summary stays with Totals; omit the customer View invoice control and empty invoice panel. Preserve separate cancellation/refund progress and support actions. No provider payloads/internal notes/live-driver map; payment initiation or a browser return is not Order success. Customer emails communicate material recorded events, with scoped staff dashboard notices; no extra SMS/push channel or every-packing-step email.

Owner follow-up, 2026-09-24: keep Order progress in its own card, then present Items, Delivery, Order options or follow-up, any additions or issues, Totals and Payment inside one bordered card with section dividers at every viewport width.

Owner supplement, 2026-09-21: the draggable customer-entrance and fulfillment-location map pin uses
the owner-supplied looping location-pin animation. Reduced-motion preference or animation-player
failure keeps a static pin at the same coordinate; animation never changes coordinate or drag
authority.

## Storefront visual language

Product quick view opens immediately on selection, showing the already-loaded product name/photo while current detail options load. Loading remains dismissible and announces progress; prices, variants and Add are shown only after the current response arrives. Failed requests show a visible error, and late aborted responses cannot reopen dismissed dialogs.

Owner addition, 2026-09-10: Pantry and Meat & Seafood join Retail as enabled sidebar entries with availability pages until their catalogs are supplied. The subsequent owner correction enables Health and Alcohol with the same named availability pages. Produce shortcuts remain excluded from the sidebar.

Owner sidebar expansion, 2026-09-10: the final owner correction keeps only Retail, Health and Alcohol alongside the original Home, All groceries and Deals navigation. Produce categories remain in the existing catalog category strip. Health and Alcohol were initially disabled; the later owner correction above enables their availability-page links. Retail opens an availability page while it has no supplied catalog. These are navigation entries, not new D1 taxonomy or inventory. The rail scrolls to keep Orders and Account reachable on shorter desktops.

Owner correction, 2026-09-10: Account remains in the desktop sidebar and mobile bottom navigation; remove the duplicate account icon beside the header cart. The subsequent owner request authorizes the popup navigation from Mobbin's [DoorDash web Account flow](https://mobbin.com/flows/fbfed5fc-e0f2-499a-ab01-530425a50e64). Account opens an anchored popup beside the desktop rail or above mobile navigation, retaining browsing context. Adapt the profile row and grouped shortcuts/settings to existing FreshMarkets profile, addresses, orders, password reset, account overview, support and sign-out destinations. Guests receive a sign-in entry; loading/error states must not imply sign-out. Escape/outside dismissal and focus return are required. This does not add DoorDash rewards, payment management or other unsupported features, or copy its assets.

Retain the existing original storefront visual language; archived reference research is evidence, not a redesign mandate. Desktop uses a sticky white wordmark/search/address/cart header, a narrow navigation rail and right-side cart sheet that preserves browsing. Home flow is address/service context, search, categories, restrained promotion modules, product/seasonal rails. Mobile has a compact sticky header, full-screen search, horizontal rails, two-column product grids where media remains clear, Home/Shop/Orders/Account navigation and tall/full-screen cart with sticky checkout. Touch targets are at least 44px.

Owner addition, 2026-09-23: overflowing homepage category tiles and horizontal product rows can be dragged with a pointer. Movement must establish drag intent before capture; a drag scrolls the rail without activating its link or product quick view. Ordinary clicks, keyboard activation, touch vertical panning and the existing browse controls remain available. A rail that does not overflow does not advertise a grab cursor.

Owner addition, 2026-09-12: every StorefrontShell page ends with a responsive footer using the established storefront tokens. It links only to existing shopping, serviceability, Orders, Account, delivery-address and support destinations. Mobile spacing keeps footer content clear of the fixed bottom navigation. On desktop the footer spans the complete shell below both the navigation rail and content; the rail background and divider end before the footer begins.

Storefront CSS variables retain the sourced baseline: background `#FFFFFF`, soft surface `#F7F8F3`, lime `#B7F34A`, dark brand `#1F3D24`, text `#191919`, muted `#6B6B67`, border `#E8E9E3`, success `#238636`, danger `#D92D20`. Existing tokens, not repeated literals, own these values; Admin remains independent.

Owner correction, 2026-09-23: use dark green with white text for ordinary primary storefront actions, the existing outlined treatment for secondary actions, and a white inverse action on dark promotional surfaces. Keep lime as a brand accent rather than a competing primary button color. Product quick view has a fully rounded 12px frame with its own scrolling content, a compact square media tile that does not stretch with long details, consistently framed gallery/recommendation images, and a visible bottom action row.

Owner follow-up, 2026-09-23: the supplied Search-button reference supersedes the dark-green fill for filled primary Storefront actions only. Match its sampled `#00B14F` fill and white label, with a darker green hover; keep the dark brand token, Admin, secondary/outlined, destructive, icon-only and inverse-on-dark treatments separate. Exact white on `#00B14F` is about 2.84:1 contrast, below normal text guidance; this is an explicit visual-match choice, not a claim of accessible text contrast.

Owner follow-up, 2026-09-24: apply that same exact `#00B14F` to Storefront green text accents, success/status copy, links and text-style actions, including product availability. Keep dark-green brand lettering, text on lime/inverse surfaces, warnings, errors and Admin colors distinct. Small `#00B14F` text on white or pale green also has insufficient normal-text contrast; the requested visual match does not establish accessibility acceptance.

Owner approval, 2026-09-23: product quick view keeps one frame while loading fades into authoritative content or an error (150ms loading fade, 200ms content opacity/4px reveal). Cart and notification number badges may enter/exit over 200ms and lift changed numbers over 150ms; no panel or decorative notification motion is implied. Add-to-cart and quick-view quantity controls use the existing 150ms pressed scale. Reduced-motion drops translation/scale and retains only brief opacity feedback. Do not animate prices, availability or success before Core confirms them.

Owner correction, 2026-09-14: use self-hosted Geist Variable as the shared storefront and Admin interface/display family, with Geist Mono Variable for code, identifiers and uppercase micro-labels. Headings use the restrained sent.dm-inspired hierarchy without copying its proprietary fonts or brand treatment: h1/h2/h3 use weight 600, balanced wrapping, compact 1.08/1.12/1.2 line heights and progressively tighter `-0.04em`/`-0.03em`/`-0.02em` tracking. Preserve each surface's existing responsive type sizes and the Admin/storefront color-token boundaries. Spacing uses 4/8/12/16/24/32/40/48px; radii 4px controls, 8px product/promo framing, 12px sheets/dialogs. Shadows signal overlay elevation, not a box around every product.

Functional icons use Lucide with accessible labels/tooltips. Category illustration is a separate original FreshMarkets asset boundary; Core owns category taxonomy. Use stable-dimension placeholders where needed, never reference screenshots/artwork as production assets.

Owner-approved login direction, 2026-09-10: adapt the supplied Tana sign-in reference as a centered, shadow-free rounded card with FreshMarkets branding and heading above it. Keep email and password together, followed by the primary sign-in action, OR divider, outlined Google sign-in, recovery and registration links. Use existing auth behavior and storefront tokens; do not add unsupported providers or an email-first step.

## States, accessibility and verification

Every changed surface needs appropriate loading skeleton, empty/filtered-empty, denied, unavailable, error with safe request reference, stale/conflict, pending and terminal-result states. Labels/icons supplement color. Preserve row identity/actions when tables become cards or scroll; tablet/mobile keep actions reachable. Use semantic headings/tables/labels/error associations, visible focus, keyboard menus/dialogs, focus return, live status announcements, contrast and reduced-motion behavior.

Prefer server reads and explicit public cache/revalidation policies. Personalized eligibility/prices/Orders are not incorrectly cached. Request-time image optimization and relied-on vinext features need actual compatibility evidence; do not assume Cache Components/PPR/undocumented Next semantics.

Use focused interaction/permission/replay/failure checks and actual desktop/mobile browser evidence for changed journeys. The inherited Admin release archetype viewports are 1440x1200, 1024x1366 and 390x844; these do not invalidate the separately recorded 1280/390 transfer tests. Preserve all earlier acceptance gaps. Consult ENGINEERING for the complete phase gate. Reference review records the observed pattern, grocery adaptation and rationale, not copied branding or new product scope.

Owner-approved account reference adaptation, 2026-09-10: use DoorDash’s profile panel hierarchy (https://mobbin.com/flows/c69556b1-1ed4-4047-b851-bfc847412e99) and Saved Stores grid (https://mobbin.com/screens/45b769f6-3585-430b-88fc-9a664f544dba) for FreshMarkets account presentation. Account shortcuts and settings retain existing destinations; profile uses the storefront shell and bordered details/preferences sections. Saved delivery addresses use a responsive grid. Owner explicitly excludes Saved Stores and asks for existing features only; no invented stores, ratings, business profiles or provider capabilities.

Owner correction, 2026-09-10: profile details and phone/preferences belong inside one account panel, following https://mobbin.com/flows/9a426026-36b8-4f65-806d-0046a6c1bacc. Label the field Phone and automatically group Philippine mobile input with +63 and spaces while typing. Verification means format validation, explicitly not SMS. Remove Preferred language from this form; retain existing saved language data by sending its unchanged value in the required update field.

Owner correction, 2026-09-10: profile has one Save action for name, phone and promotional preference. Email remains a read-only input. Existing separate service ownership is retained with explicit partial-failure and retry feedback.

Owner correction, 2026-09-10: product cards always show the compact + control, including items already in the cart. Clicking + increments the existing quantity. Quantity steppers remain in the cart.

Owner-approved delivery selector, 2026-09-10: adapt DoorDash address editing (https://mobbin.com/flows/e640858f-3163-46db-bff8-95aab8e78adc) and dropdown (https://mobbin.com/screens/95b6a9d2-c577-4fc1-92fc-5e66884414c9) into a compact viewport-clamped popup under Deliver to. Search/current location/manual pin and saved addresses use existing confirmation behavior. Mount the map only after choosing an address or requesting manual pin entry. Saved checkout addresses and the browsing point remain distinct.

Owner correction, 2026-09-11: the delivery dropdown uses a compact search field with a magnifying-glass icon and accessible label, icon/text current-location and map actions, and concise copy. Remove the X and skip-browsing link; retain Escape/outside dismissal. Show the short checkout-address reminder only after choosing a point. Reference: [Foodpanda address selection](https://mobbin.com/flows/eaa5ce64-204d-46cc-84d2-86a84863b223); adapt existing capabilities only.

Owner correction, 2026-09-11, as updated by the 2026-09-13 Global-area model: clicking a saved address in the delivery dropdown applies that coordinate through existing browsing-location confirmation and closes after the current area gate and nearest-location assignment succeed. Do not require a second map-confirmation click for saved addresses. An outside-area coordinate or failure to assign an active fulfillment location preserves the current choice and shows a specific inline error; courier route availability is checked by quotation at checkout.

Owner correction, 2026-09-11: Account popup and account page Sign out actions open a compact confirmation dialog with Cancel and Sign out. Opening or cancelling does not end the session. Confirmation shows pending/error feedback; successful sign-out returns home.

## Standalone banners — 2026-09-11

Admin Banners (/admin/banners) is a separate image gallery from Promotion Codes. Create a draft, attach its image, then activate it for its dates. Show preview, status and priority; allow an optional storefront path. Dates use the operator browser timezone. Storefront Featured displays the published images without generated promo-code or eligibility captions; images without a destination are not links.

Owner correction, 2026-09-11: an icon-only search control sits beside Deliver to. Clicking it reveals a focused input in that same header row. It is inline, not a floating dropdown or separate accordion row. Toggle, Escape or candidate selection hides the input/results and cancels pending searches while retaining the query. Current-location, map and saved-address actions remain available.

Owner approval, 2026-09-11, superseded by the 2026-09-14 delivery simplification: new address creation at /account/addresses uses the same two-step Location then Details flow. Show progress and Back/Continue; preserve input between steps, validate the confirmed coordinate against active Global areas and nearest fulfillment-location assignment, then collect label/contact and the single optional instruction value before saving. The account may retain an outside-area address with explicit unserviceable feedback, but it cannot be selected for checkout. Existing edit uses the same compact detail fields.
