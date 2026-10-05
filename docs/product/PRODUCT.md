# FreshMarkets Product Rules

Current rules by subject. Product approval, source implementation and application/provider acceptance remain distinct. The protected [owner discussion](SIMPLIFICATION_DISCUSSION.md) and source map preserve decisions; the [checkpoint](../operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md) owns unfinished work. Later explicit owner decisions win over historical baselines.

## Audited Order status correction — owner supplement 2026-10-05

The owner explicitly authorizes unrestricted **Order status only** changes with an audit reason.
A Global administrator with `orders.manage` may select any canonical Order status in either
direction, including on terminal Orders, after confirmation. This corrects the recorded Order
status; it does not perform or undo commitment, payment, refund, cancellation, stock, preparation,
delivery or customer messaging. These independently owned facts retain their existing commands
and provider-confirmed outcomes. Selecting Canceled does not request a refund; selecting Delivered
does not record physical delivery. The required reason, previous/new status and administrator are
audited. Normal workflow actions remain available under their existing eligibility rules.

This explicit supplement supersedes the earlier exclusion of an unrestricted Order-status
override. It does not introduce an editable Delivery/Fulfillment status or manual financial
confirmation. The correction does not freeze the Order: subsequent valid workflow/provider
reactions may update its status through their existing rules. Source implementation and acceptance
are recorded separately in the active checkpoint under `ORDER-STATUS-OVERRIDE-20261005`.

## Global modes and stock

One versioned Global selling state (Open/Paused) and one active fulfillment mode govern new authenticated commerce. Instant uses exact local stock, holds and paid reservations; Scheduled uses exact paid demand with no physical-stock admission/netting or capacity. Pause before changing mode. Complete the last planned Scheduled week, receive/count Instant stock and check products/prices/location readiness before switching and reopening; there is no automatic switch date or all-history completion prerequisite. Started payments, immutable paid commitments and outstanding Scheduled goods remain recoverable. Only inspected surplus can become physical Instant stock.

The initial Scheduled site receives, packs and dispatches at one location; a separate warehouse is not required for daily launch work. Multi-location records and approved transfers remain supported. Location stock reads distinguish physical, held/reserved and available quantities. Add stock/Remove stock record quantity, actor/time and an automatic movement label without an operator reason; paid movements/releases remain guarded and exactly once.

Bulk weight and actual counted Small/Medium/Large pieces or packs describe the same goods. Actual local counts control Instant sales; approximate grams are logistics reference only, and bottled liquids count pieces. Never infer counts from grams, credit bulk and packs twice or introduce packing/variation settings. Global dispatch deducts sent stock once; drafts have no movement. Destination credits accepted receipts/counts once with immutable sent-versus-received evidence. Differences are not automatically a loss or return. A linked Receive form is not followed by another Add stock for the same goods. Approved destination damage/missing observations and Global documented loss/inspected-return controls retain scope, audit, replay and conservation safeguards. Routine Scheduled receiving remains outside the app under the later simplification.

## Catalog, prices and promotions

promotion and inventory-sale activation, deactivation and archiving do not require an operator-entered reason. Normal lifecycle permissions, current-version checks and automatic actor/status audit remain required.

Global owns Product/category identity, selling-option definition, media and lifecycle. Listed location prices are exact and fixed, without Global/Market fallback or post-packing repricing. Weight variants share gram stock; count goods have exact piece/pack contents. An authorized location-scoped `prices.manage` operator edits the displayed selling-option price inline in that location's Product preview. Global preview provides Product rename/lifecycle, selling-option lifecycle and multiple ordered categories; each category selection saves immediately, the first is the compatibility primary category, and all participate in browsing. Location previews do not expose those Global controls. Current versions, audit, immutable history and atomic replacement remain required.

Products support at most five active images, one main and four optional: ordinary Add/Edit upload/preview/replacement/removal/main/order and customer detail/quick-view galleries. Five are not required; background cleanup/recovery remains internal. Standalone Banners are independent content with image, accessible description, optional link, dates, priority and lifecycle; publication never creates a discount.

The five approved basic grocery/delivery offer types may have promotion-only minimum spend, dates and usage limits. One selected-product sale per item, one grocery code on eligible full-price items and one delivery benefit may stack; first-order/new-customer is one audience choice. No general checkout minimum, membership eligibility, multiple grocery codes/delivery benefits or overlapping active product sales.

Perishable sales target location/Product/option with percentage or fixed amount off each selling unit, struck-through regular price, timing and early stop. A chosen Instant sale allowance is separate from physical stock. The complete requested quantity must fit the remaining allowance or receives no sale discount; do not split the line. Purchases/removals cap allowance to remaining goods, fresh stock does not enlarge the old sale, and eligible cancellation restores consumed allowance when stock is released. A refund alone never releases stock. Exact allocations/claims and paid prices remain immutable; no freshness engine or stock-lot tracking is implied.

## Geography and serviceability

administrators configure one or more named, independently versioned service-area polygons at Global level (for example Cebu and Lapu-Lapu). Their active union is the FreshMarkets expansion gate: a confirmed customer coordinate outside every active area remains saveable but cannot select a fulfillment option, request a delivery quote, or proceed to payment. Areas are not assigned to fulfillment locations. After the gate passes, Core selects the nearest active, capable, mode-ready whole-order fulfillment pin; a successful current Lalamove quotation remains the route-specific availability and fee authority. Areas are independent of fulfillment pins; assignment never reroutes by stock or splits an Order.

Confirmed coordinates first pass the active Global-area union, then Core chooses the nearest active, capable, mode-ready whole-order fulfillment pin by Haversine distance with a stable location-ID tie-break. Global polygons are expansion gates, never per-location allocation. A successful current courier quotation is route/fee authority; stock does not reroute or split an Order. Each site owns factual pickup pin/contact/profile and hours; Scheduled admission uses cycle opening/cutoff, while hours gate new Instant checkout/payment rather than browsing or started-payment recovery.

## Customer account and support

customer-facing account-closure requests are deferred from the current release. The agreed intent remains recorded in SIMPLIFICATION_DISCUSSION; do not add the option or count it as an active completion requirement. Existing staff closure/review and indefinite record-retention safeguards remain intact. The owner supplied `support@freshmarkets.ph` for Contact FreshMarkets; publishing its contact link does not authorize sending email.

Public browsing/guest Cart carries into sign-in without an extra enrollment. Better Auth owns credentials, verified identity and recovery; Core owns profiles/contact, saved-address CRUD/default/recipient phone, authorized shopping and immutable history. First visit offers an address/map pin and device-location consent; Skip permits general browsing, while local prices/Cart need a confirmed location. Remembered browser evidence never authorizes checkout. Buy again uses current availability/prices, and account/address edits never rewrite paid snapshots.

After delivery, one Order-level Report a problem allows optional affected-item links, without mandatory item selection, a deadline, guaranteed resolution or automatic problem refund. Staff review daily in New/Being handled/Resolved, contact the Customer and retain a short resolution note. Refund approval is separate. Approved Order messaging never resolves a Problem or replaces staff notes.

Administrator and Operations are initial responsibility groups backed by explicit capabilities/location assignments, individual login/invitations, access disablement and actor audit. Operations do not obtain Global pricing/promotion/customer-report/refund/staff authority from a scope filter. Existing staff closure retains history; customer self-service closure is deferred. Irreversible erasure/anonymization remains separately gated.

## Customer delivery addresses

Customer delivery details retain the address label (Home/Work shortcuts or an existing custom label), one optional Delivery instructions field, the confirmed destination, recipient name and phone. Separate building/unit, landmark, gate/guard, recipient-guidance and private-note inputs are removed. Useful entrance/unit details belong in Delivery instructions; no separate unit field is required. Core combines retained courier-facing legacy fields without duplication when an address is read or edited, never exposes private notes as courier instructions, and never rewrites immutable paid snapshots. Deliver to persists through browsing and sign-in, takes precedence over a different account default at checkout, and remains browser evidence until Core reauthorizes a saved-address identity or creates a saved address from the confirmed pin. An Instant destination change keeps every Cart row, reassigns only by the existing geographic policy, returns current local price/stock reasons, blocks payment until unavailable quantities/items are explicitly resolved, and neither reroutes by stock nor splits an Order. Started Payments retain their destination lock. Address source tasks and local/release/provider acceptance remain separate in the checkpoint.

## Checkout and Cart

Customer checkout supports the one active global mode returned by
Core. Instant obtains an immediate courier quotation; Scheduled presents the current eligible cycle,
delivery range and cutoff and obtains its authoritative future courier quotation. Web must not discard
a Scheduled option or imply that the operator must switch to Instant. For a selected Scheduled
option, checkout shows the actual Core-returned exclusive cutoff in Philippine time. The editable
schedule correction supersedes the fixed Friday/next-weekend notice: do not promise an unconfirmed
future week. Early closure makes new ordering unavailable without backdating the saved cutoff.
Instant checkout shows no Scheduled cutoff notice. Core's current cycle/window/cutoff remain authority.


Customer checkout follows Core's active global mode and keeps the browsing
destination visible beside saved-address alternatives. It presents only Core-returned configured
couriers with provider-appropriate identity, automatically obtains the authoritative delivery quote
once the Cart, confirmed address and selected eligible option are ready, and uses one quote-backed
Order summary and one payment action. Scheduled history and operations remain supported; activating
Instant in an environment still requires its existing readiness and mode-change authority. Promotion
intent is edited in the Cart drawer and direct Cart page through one account/Cart-scoped reactive
draft and is never treated as an applied discount until Core validates it. Clear All is one
authenticated, version-guarded Cart command (or one local guest mutation), atomically releases only
eligible unpaid checkout state, never changes paid/committed evidence, and replays an immutable
receipt without deleting later additions. Source task IDs and local/release/provider acceptance are recorded in the checkpoint; mode activation retains its own authorization.

reduce storefront and provider API traffic when current signed/versioned evidence already proves the same read. Confirmed browsing issues a Core-signed, read-only delivery context for exact-location catalog presentation; it is never Cart, checkout, price, stock or payment authority. Fulfillment-option discovery performs internal eligibility only and does not spend a courier quotation. Creating the customer-visible checkout total obtains the authoritative Lalamove quotation once; payment may reuse that accepted quotation while it remains valid with a safety margin and all Cart/address/routing/version evidence still agrees, otherwise it refreshes and requires replacement acceptance for changed terms. Mutations, payment admission and final booking retain current-state guards; reducing calls must not remove business revalidation.

changing produce quantities or other cart merchandise must recompute the authoritative Core checkout quote, including current prices, availability, promotions, inventory admission and totals, but does not by itself request another courier quotation. Core reuses the same still-valid courier quotation only while the saved address, fulfillment location, provider/service and pickup window remain identical. Any change to those route inputs, or quotation expiry, requires a new provider quotation. The fixed 20,000 g courier envelope in GD-D03 remains unchanged; item-level shipping metadata does not trigger courier repricing or weight admission.

when Scheduled checkout has one eligible delivery option, checkout automatically obtains and displays its authoritative courier fee without requiring a separate selection click. While the customer remains on the current checkout, Web refreshes the complete Core quote four minutes and thirty seconds after acceptance, or earlier when the provider `expiresAt` timestamp reaches the thirty-second safety boundary. Automatic refresh retains the same address/cart/option guards, safely abandons the superseded checkout attempt and never treats a browser timer or displayed fee as provider, payment or Order authority.

after Core durably adopts checkout payment creation, the submitted Cart leaves active shopping as `PAYMENT_PENDING`, retains its quoted rows as payment evidence, and an empty active successor becomes the customer's current Cart. This handoff does not fabricate payment success. The customer does not remain in `/checkout` or request another delivery quotation for the submitted checkout; an ownership-checked Needs payment view and notification resume only an active, unexpired provider action. Canonical provider success alone commits the Order and converts the submitted Cart. Retained pre-upgrade payment-locked Carts remain compatible during rollout.

## Payments and refunds

Owner follow-up, 2026-10-05: Admin may retry a definitively rejected refund after correcting the provider funding/configuration issue. Global `refunds.manage` staff confirm a reason; the retry uses the same recorded amount/currency, preserves the rejected attempt and continues the existing cancellation. Pending, unknown and successful refunds cannot be submitted again through this action. Financial success still requires verified provider evidence. This authorization does not execute a real refund or deploy the implementation.

While the QR Ph provider step is open, checkout automatically checks
the authenticated customer's owning Payment completion. A signed provider success first displays
“Payment received” while the same durable Order reaction is unfinished; only the immutable committed
Order link may display “Payment successful” and the one-shot success animation. The completed state
keeps an explicit View order action and does not force a redirect. Reduced-motion customers receive a
static success mark. Core attempts the checkout reaction during verified webhook handling and retains
bounded scheduled redrive as recovery; browser state never becomes payment or Order authority.

Admin Payments will have one workspace with
Payments (confirmed captured payments and their refunds) and Needs attention (genuine unresolved
money or paid-commitment problems). Ordinary unpaid, failed-without-capture and expired attempts
remain internal; the earlier proposed All attempts filter is superseded and must not be built.
Customer waiting and payment-window expiry do not create staff work. Group linked issues by Payment,
retain unmatched financial evidence, and automatically remove verified completed issues from the work
list with required cleanup/audit evidence. Refund decisions and financial/Order safeguards remain.
Technical diagnostics are collapsed and no separate overview/reconciliation dashboard is needed.
Retain the up-to-30-minute QR lifetime; the saved cycle schedule makes the
financial settlement/commitment end at the editable Procurement starts time. The customer SDK action
retains a separate 60-minute lifetime, measured from payment setup, under the 2026-10-04 owner decision. It is not the confirmation/settlement deadline. No 24-hour change
was approved. Window expiry never manufactures a terminal financial outcome or blocks a later valid
provider confirmation. No deletion/retention period or purge is authorized by this simplification.
These decisions are implemented in source under `PAYMENTS-SIMPLIFY-1`. Current local/release evidence and separately outstanding provider/retained-data acceptance are recorded in the checkpoint.

retain the existing 60-minute SDK action and up-to-30-minute issued QR lifetime. The default one-hour gap between Order cutoff and Procurement starts allows up to 30 minutes for the last issued QR plus approximately 30 minutes for delayed confirmation. This is a default operational buffer, not a PayMongo confirmation guarantee or a fixed limit on editable schedules. No new QR may be generated/renewed after ordering closes. SDK/QR expiry never proves nonpayment or stops verified financial recovery; commitment still ends at saved Procurement starts, with later captured uncommitted Scheduled money using full-refund recovery. Existing cycle dates are not rewritten by this release.

Processing remains an internal pending-confirmation distinction, not staff work or a manual payment
step. Where already shown to the customer, label it Confirming payment. Only an exhausted or
unrecoverable confirmation issue calls for staff attention; awaiting confirmation is neither success
nor definitive failure.

customer checkout requires an explicit payment-method choice before a provider Payment Intent is created or `/checkout/payment` is entered. QR Ph is enabled from the verified PayMongo account capability and produces a dynamic, single-use code on the provider step. GCash, GrabPay, Maya, ShopeePay, Google Pay, Visa/Mastercard and the listed direct-debit methods remain visible but disabled until the corresponding PayMongo channel is active and its application path is explicitly enabled. The selected method is immutable idempotency evidence for the Payment; PayMongo's signed outcome remains the only payment/Order success authority.

Visible disabled methods include GCash, GrabPay, Maya, ShopeePay, Google Pay, Visa/Mastercard, BDO, BPI, Landbank, Metrobank, RCBC and UBP. Verified QR Ph alone is enabled for new checkout. A disabled logo is not activation; require verified account channel and explicit application support, never invented mappings or Admin toggles. Method selection is immutable idempotency evidence. Preserve retained card/addition recovery without enabling new admission.

## Scheduled ordering and preparation

**Finish packing order** is a positive confirmation
that every paid item in that Scheduled Order has been physically packed and checked
accurately. An Order that cannot be confirmed stays unconfirmed; the ordinary
Scheduled status flow has no shortage/receiving step. Staff-selected Manual delivery
combines assignment and physical handover in one explicit confirmation, immediately
placing that Order **Out for delivery**. Retained older assignments still need their
recorded handover. Staff may request another Lalamove attempt without a lifetime count
cap after the previous attempt is definitely closed and delivery remains eligible.
Unknown or active provider outcomes still block replacement; automatic Instant
first-booking submission remains bounded separately. The owner withdrew the proposed
editable delivery status field: the existing Preparing and Ready for dispatch views
show the Core-derived progress without a manual override.

The saved Procurement-start settlement boundary applies to the
current delivery week as well as future weeks. Existing uncertain payments require an
audited provider-evidence cutover; they are not relabeled failed or deleted. Remove new
paid Order additions in both modes, including the customer control and new addition
payment admission. Retained addition/payment/refund history remains readable and must
finish through its existing financial recovery path.

Scheduled is a temporary preorder mode. Its ordinary Admin week flow has one
**Purchase complete** action after the configured Procurement starts time; it records
that staff bought the full, exact paid quantities shown for the week. Staff contact
suppliers and handle receiving and checking outside the app. Staff then physically pack
each Order and use **Finish packing order** on that Order. No per-product receiving entry
or per-order picking steps are required for this routine Scheduled flow. Each packing
action must affect only the confirmed Order; shortages or exceptions remain visible for resolution.
Scheduled goods do not become Instant stock by inference. The customer-facing progress
is Payment, Packed, Out for delivery, and Delivered, with actual dispatch and delivery
events still tracked for each Order. Instant stock and courier safeguards remain unchanged.

Scheduled Order cutoff and Procurement starts are both
editable cycle schedule fields. The date picker defaults the exclusive Order cutoff to
12:00 AM after the advertised 11:59 PM closing minute and Procurement starts to 1:00 AM
in the cycle's market timezone. These are defaults, not a fixed one-hour policy. No new
checkout/payment admission or QR generation/renewal for that cycle occurs at or after
the order cutoff. A QR issued before cutoff may complete within its individual provider
expiry of at most 30 minutes. Core may commit verified paid Orders from admitted attempts
until the saved Procurement starts time, when confirmed paid demand freezes for supplier
purchase. Unresolved attempts
do not hold purchasing indefinitely after that freeze; they remain financial cases.
Any subsequently confirmed captured money for an uncommitted checkout is flagged and
automatically refunded in full through the verified provider/refund path, without a new
Order or addition to frozen demand. An unknown or unpaid attempt is never refunded as
though money were received. The configured Procurement starts time makes the week-level Purchase complete
action eligible. Early ordering closure does not
backdate the published cutoff or its settlement deadline.

Global may close new ordering early for an already Open Scheduled
cycle. This stops new checkout and payment admission without backdating the published cutoff,
canceling paid Orders, invalidating started Payments, or shortening each paid Order's immutable
customer-cancellation window. An already-started Payment may still reach canonical commitment
within the Scheduled settlement window above. The week-level Purchase complete action waits for the
saved Procurement starts time; routine receiving remains outside the app. The cycle cannot reopen.
This is a separate action from Deactivate, which remains unavailable when the cycle has commitments.

one Scheduled cycle publishes one ordering period, one procurement/preparation/pickup plan and one customer delivery range for its participating fulfillment locations. Global administrators choose the locations; each customer Order is executed only by the location Core assigns from the confirmed address. Market and delivery-zone identities remain internal. Multiple named customer slots inside one cycle are excluded; a materially different pickup or arrival plan is a separate cycle. Existing committed snapshots remain unchanged.

Scheduled cycle publication is presented as a direct Activate action on a complete draft, and an unpaid active cycle exposes a guarded Deactivate action. These actions do not require separate operator reason fields in the ordinary workspace; the command records the named operator action as its audit reason. Deactivate retains the existing terminal cancellation semantics, closes unstarted checkout quotes, and remains unavailable when Orders, unresolved Payments, or retained checkout holds require coordinated recovery.

every Scheduled cycle review opens with a read-only Order summary of current committed paid demand. It includes paid additions and excludes demand released by accepted cancellation; unpaid carts, quotes and pending Payments are absent. Compatible immutable SKU/pool/base-unit and paid-label evidence aggregates into Product and selling-option rows with paid Order, sold-unit, exact base-quantity and authorized-destination counts. Global sees the consolidated cycle and location-scoped administrators see only their assigned destination. This summary never subtracts Instant/physical stock or replaces the destination-specific Quantities to buy and purchase workflow.

location operating hours govern only new Instant checkout and payment admission. Scheduled accepts orders from each cycle's opening time through its cutoff without consulting those hours. Scheduled checkout still obtains an authoritative future courier quotation for the cycle pickup so the accepted total includes both groceries and delivery; unsupported or out-of-horizon courier scheduling remains specifically unavailable rather than bypassed or replaced with a flat fee.

## Cancellation

Scheduled customer cancellation remains available only before both
the snapshotted cutoff and the first Start packing transition. Once packing has started, the online
Cancel order control is disabled even if cutoff is still in the future; a later shortage or return
to preparation does not reopen it. Instant retains its earlier lock at staff acceptance. Customer
Order follow-up and What went wrong appear after delivery completes. During preparation, Cancel
order sits with current Order options, while View transaction summary stays with the financial
totals. Remove the customer View invoice control and empty invoice panel from this page; retained
invoice readiness remains internal. Admin Orders links to its owning Fulfillment and Delivery
workspaces, where currently scoped staff use the existing guarded state commands.

## Staff preparation

Point of Sale in the Admin Sales channels group opens a
location-scoped paid-order preparation station for staff tablets. Its first version uses the
existing Fulfillment status actions and ordered quantities; it does not create in-person
sales or take in-person payments. Core's current Fulfillment authorization, goods checks,
delivery policies and command receipts remain authoritative.

present this as a separate **Picking & packing** staff page
inside the website, reachable for each assigned customer-fulfillment location and from the
location's setup/review pages when the staff member also has setup access. The old Point of Sale
URL remains a compatibility alias. The station shows that location's paid online Orders as they
arrive and uses the existing preparation actions. It does not add a walk-in checkout or a second
Order, Payment or fulfillment authority.

## Courier dispatch

Instant and Scheduled have different first-dispatch workflows. Payment
creates paid fulfillment work but never summons a rider. For Instant, the authorized `START_PACKING`
transition automatically submits the first Lalamove booking using the immutable customer-selected
provider/service snapshot; packing and rider search then proceed concurrently. The same stable system
identity is recovered by the minute job only for definitely unsubmitted work. A timeout or other
unknown create outcome retains that attempt and blocks replacement. Definitely retryable submission
failure is bounded to three attempts; definite closure permits an explicit Lalamove retry or Manual
assignment after packing. An explicit post-pack Lalamove command remains a recovery control when the
automatic trigger produced no attempt. Manual is not an ordinary first Instant choice. Scheduled is
unchanged: authorized staff choose Lalamove or Manual only after packing, and Manual is not a fallback.
Verified provider pickup/completion advances delivery, Order and fulfillment custody together. The
accepted customer delivery charge, provider/service intent, address, item snapshots and promise remain
immutable. A Scheduled payment admitted strictly before its cutoff may complete through the verified
idempotent commitment reaction after cutoff within the settlement window approved above; new admission
at or after cutoff remains invalid.

Customers may choose an available verified courier; Lalamove is first and GrabExpress remains unavailable until activated. A single available provider needs no extra selection step; Customers never choose the hub. Every nonempty courier Order uses one fixed 20,000 g Motorcycle envelope. Optional item shipping grams never block quotation, payment, demand, procurement or booking. Operations must pack within actual provider weight/size limits. No customer packaging allowance, dimensions/fit settings or provider payload fields are invented; internal BAG/BOX is not sent as a service choice. Accepted customer charge stays fixed; actual courier/manual cost and variance are separate, with unknown cost unavailable.

## Failed delivery and customer agreements

**customer-caused missed deliveries are not automatically refundable**. A courier failure report alone does not establish customer fault. Staff review delivery-attempt/contact evidence; unclear responsibility remains under review. Merely leaving the facility does not end FreshMarkets responsibility. FreshMarkets/courier-caused failures retain applicable replacement/refund handling and the existing FreshMarkets-caused cancellation rules. This is not a blanket denial of refunds after dispatch.

staff will manually enter both the new agreed delivery deadline and courier pickup time in Admin. No 3:00–10:00 PM value is an approved default, and no provider booking was authorized on the owner's behalf. This does not change published delivery weeks.

Disclose the missed-delivery condition before payment. No automatic additional charge is authorized; any proposed redelivery charge requires the customer's agreement first. Keep the original paid Order and charge history, actual delivery costs, return inspection, customer agreement and any subsequent refund as distinct facts. The approved clarification supersedes automatic cancellation/refund solely because redelivery was declined or unavailable; classify responsibility and apply the relevant policy first. Legal consumer remedies remain applicable.

## Delivery tracking and contact

Admin
Delivery and Customer Order detail open the active Lalamove map through Track Delivery rather than
loading it during the ordinary page view. The opened desktop view places map left and Order
timeline/details right; narrow screens stack them. Admin may show the assigned rider before pickup
when the provider makes a position available. The Customer action appears only while the Order is
Out for delivery. The tracking view shows verified rider and destination positions without a
report timestamp or arrival estimate. When Google Routes supplies road geometry, draw a green
suggested route from the rider's last reported position to the destination in both opened maps.
It is neither the path already traveled nor a promise of the rider's actual road choice.
The opened view also shows the four-stage Order progress strip (Payment successful, Packed, Out
for delivery, Delivered) from Core-confirmed states and achievement times. Admin displays it only
with authorized Order detail access and retains the separate event timeline.
Lalamove's documented Order and Driver Details responses do not provide a delivery ETA;
do not label the Order promise or route distance as one. Manual deliveries have no map. Provider
location is temporary tracking evidence, never an Order or delivery-status authority. Keep the
last reported rider coordinate through a temporary read failure only for the same dispatch attempt;
a replacement attempt must not inherit the former rider's position.

during an active Lalamove delivery, the owning
Customer and scoped Delivery staff may call the currently assigned rider only when Lalamove's
driver-details read returns a dialable phone. The Customer uses existing Order messaging for
FreshMarkets help; Lalamove's in-app rider chat is not represented as a FreshMarkets conversation.
The booking continues to provide the staffed pickup contact and saved recipient contact to
Lalamove. Scoped Delivery staff may call the saved recipient from the immutable delivery stop.
Missing, invalidated, unavailable, or finished rider details never show a stale rider call
action. No estimated arrival or new driver-notification API is implied by this presentation.

## Owner-approved notification surfaces

NOTIFICATION-UI-1 authorizes a customer bell immediately before Cart and an Admin header panel.
Customer updates cover Order confirmation, payment action/failure, Scheduled cutoff reminders,
delivery pickup/out-for-delivery/completion/failure, cancellation received/completed, and refund
processing/completed/support exception. They are bounded read projections of owned transaction
facts and existing notification intent. Email delivery status, addresses, provider details and internal
errors remain private. Payment action notices must still be current; successful refund completion
requires successful refund facts. Destinations use existing Order, checkout and support surfaces.
Signed-out customers get a sign-in entry. The storefront bell may show a browser-local, per-account
count of currently returned updates not yet opened in that browser; opening the panel clears the
counter for those rows. This is presentation state only, not a Core read receipt or cross-device
guarantee. No promotional feed, SMS, push, permanent dots or notification-management workflow is
approved.

Admin reuses `AdminOverviewView.notifications` for the same six approved material notices and
selected-scope destinations. Notifications grant no access and cannot reopen an Order. This approval
adds no delivery authority, KV store or new notification database. Local notification verification
does not accept the outstanding deployed commerce-event → received-email journey.



Transactional Customer email and scoped staff notices follow confirmed Order, pickup, delivery, cancellation/refund progress, Problems and approved report facts. Transaction updates are mandatory; promotional email is optional. There is no email for each packing step, SMS or browser push, and notification failure never changes the successful source command.

## Messaging retention and recovery

One conversation belongs to each committed Order and may be started by either authorized side, including after delivery/cancellation. Message text and attachments are distinct from Problems, staff notes and refunds. A first Customer message produces one configurable acknowledgement, not an outcome or response-time promise. Presence describes a visible connected conversation, not a delivery/read receipt. Sound requires browser permission/user interaction, an open tab and unmuted settings; initial history, own messages, retries and duplicate tabs never replay it.

Message expiry is 14 days after the later of last message and terminal Order close (`DELIVERED` or `CANCELED`; neither `EXCEPTION` nor `CANCELLATION_REQUESTED`). Active related Problems/refunds/disputes or a reviewed hold defer expiry. New messages after purge begin a fresh conversation. Privacy notice discloses live expiry separately from protected recovery/backup history; the composer carries no retention paragraph. Download access is denied once content is eligible even while physical R2 deletion retries. A restore must rerun eligibility before serving content. Unsent uploads expire through separate bounded 24-hour cleanup; late staging cannot undo Remove. Immutable send metadata/audit/replay facts survive; text, file names and bytes do not belong in those records. This is the owner's policy, not statutory compliance certification.

Customer ↔ Admin messaging is approved about a committed Order, superseding the earlier exclusion of chat for this bounded feature. The first release includes short-lived typing and presence indicators, one configurable automated acknowledgement on the first Customer message in a conversation, and private attachments in the existing R2 bucket. Each message permits at most three images. The owner's 2026-09-29 mobile-photo and safety follow-up accepts JPEG, PNG, WebP and HEIC/HEIF inputs up to 18 MB each, with browser preparation when possible and a required Core image decode/re-encode before R2 storage. Only the processed still WebP, at most 5 MiB, is newly stored; a failed transform rejects the upload. Very large or 200 MP originals may need a standard-resolution copy. Previously attached PDFs remain privately readable until normal retention expires. New incoming messages and in-app notifications may play a short sound in an open, interacted-with tab; browser push and email are excluded. Message **content and attachment bytes** become eligible for deletion 14 days after the later of the last message and the Order's terminal close. An active related problem, refund, dispute, or reviewed legal hold defers deletion. Keep the minimum immutable metadata and audit evidence required for integrity and replay; do not erase retained Order/payment/business records. Admin chat uses shadcn composition with the existing Storefront green in place of blue accents, without changing Storefront or auth styling. The architecture is in [ARCHITECTURE](../architecture/ARCHITECTURE.md#order-messaging-transport-and-storage). This rule does not certify statutory compliance or implementation acceptance.

Image-upload safeguards follow the approved audit repairs. The implementation limits each actor to three unsent photos per Order and 30 reserved uploads in 24 hours, applies an approximate per-session ingress rate limit, and records Remove as an authenticated cancellation that prevents late staging and queues stored-byte deletion. Invalid photos receive a final error while transient processing errors remain retryable. These safeguards preserve the approved image-only, processed-WebP and historical-PDF rules above.

## Mobile customer scope

Owner correction, 2026-10-05: native Mobile and the Mobile API adapter are deferred; the owner explicitly authorizes committing their pending source deletions as work not intended at this time. This supersedes the earlier native-client implementation approval. The historical [Expo setup guide](https://github.com/kezuflow/grocery-app/blob/ac2474fcfadf3af5ef8d019175b3de9f4fa346b2/mobile/README.md) remains recoverable. Web/Core customer features and retained data remain governed by their existing rules; this source cleanup does not remove shared Core features or authorize deleting remote resources or customer data.

Retained Core customer features: saved favorites are private per customer. “Popular with your order” uses real paid co-purchases: an active locally available candidate must have been bought with an active-Cart product in at least two paid orders from two distinct customers. Cap results at eight and hide the rail on sparse history. Private post-delivery feedback attaches to the whole order: one 1–5 star rating and optional comment up to 1,000 characters, accepted only after the order and delivery job are Delivered. Exact retries return the saved review; edits need separately approved policy. Product ratings and public reviews are excluded; Admin handling remains unresolved.

## Approved report definitions

Every report uses the selected period and explicit market timezone, current authorized scope and a versioned definition. Keep financial facts separate from Order status.

- Orders: paid, delivered and canceled counts use their respective event dates.
- Money: provider-confirmed money received and refunded is shown separately by confirmation date; neither is profit.
- Products: paid quantities by product/selling option, with canceled quantities separate; include committed paid additions without double counting the original Order.
- Promotions: discounts and promotion usage committed to paid Orders use commitment dates and immutable allocations.
- Delivery: compare accepted customer delivery charges with recorded courier/manual costs for the same Orders; unknown cost is unavailable.
- New customers: customers making their first purchase in the period. Unique purchasing customers: distinct customers who purchased in the period. Repeat customers/orders: returning purchasers and their repeat purchases. These are purchase metrics, not registration counts or automatic ordering.

## Configuration and record retention

The 14-day window, terminal-close eligibility and legal/operational holds apply as specified in the Order messaging rule; message metadata remains retained. This exception does not authorize deleting Orders, Payments or other business/customer history. Account closure preserves business history; irreversible erasure or personal-information removal needs separate handling and is not authorized by this decision. This records the owner's retention requirement, not a claim of legal compliance or completed implementation acceptance. Official invoice/tax/seller details remain factual accounting inputs.

## Storefront welcome announcement

The independent welcome campaign shows on every eligible home visit and only that visit's dismissal is remembered. It has one approved page, Welcome to FreshMarkets, the owner-approved Monday–Friday Scheduled-order/Saturday–Sunday delivery copy and Shop fresh picks action. Core-backed checkout remains authoritative; update announcement copy before the public offer changes. No automatic page advance or Banners/promotion/commerce write path is implied. Presentation and asset references live in DESIGN.

## Scope boundaries and open context

Current scope follows these settled rules; membership/trial/recurring billing, general checkout minimum, mandatory item-by-item problem intake and guessed weight-to-count conversion are retired.

Exclude internal fleet/Rider apps/routes/batches, third-party rider chat, supplier portals/messages, walk-in POS/payment, stock forecasting, separate shortage/quality/recovery workspaces, SMS/push, loyalty/wallet, automatically recurring orders, arbitrary promotion scripting, variable-weight repricing, automatic substitution and a new analytics/settings product. Approved Order messaging, external Lalamove tracking and the website Picking & packing station remain in scope. A useful addition outside the discussion needs a separate owner conversation. Historical implementation can remain until a reviewed change removes its consumers safely; preservation is not feature approval.

The owner approved all nine follow-up choices on 2026-09-09: Problems list, weekly view, receiving form, sale overlap/depletion/fixed amount rules, eligible-cancellation restoration, normal mode changeover, simple grams calculation and expanded report definitions. These approvals supersede the corresponding proposed/deferred labels in the unchanged discussion. Actual operational timing/boundaries/contacts and provider/payment activation remain factual inputs. The owner subsequently confirmed that Instant orders cannot have items added or quantities changed after payment. This is the approved rule, not a pending deadline decision. The 2026-09-26 owner correction closes all new paid additions; retained additions and their refund history remain recoverable.

the earlier line-derived 20 kg admission rule is superseded. FreshMarkets quotes and books one fixed 20 kg Motorcycle parcel for every nonempty courier Order. Missing or larger item-weight metadata cannot disable a delivery option or block payment, exact Scheduled demand, procurement, amendments, or booking. Per-SKU and immutable line shipping grams may remain nullable reference evidence. Operations remains responsible for packing the actual Order within the provider's Motorcycle weight and size limits; this correction does not claim that an oversized physical parcel is supported.

Existing unfinished acceptance is not erased. Reconcile each saved CA task against this scope, keep its code/evidence and required safety checks visible, and classify any extra feature as pending discussion instead of implementing it from an outdated plan. The CA-4.2 transfer controls were explicitly approved in this session as recorded below.

## Technical requirements retained from existing sources

These safeguards were extracted from the previous canonical documents, not inferred from product discussion. They constrain implementation of agreed workflows and do not require additional operator screens or features.

- Core owns business commands, current authenticated identity/capability/resource scope and complete transactions. Better Auth owns credentials/sessions; customer/staff/application data is separate. Client IDs and scope selectors never confer authority. Disabled principals remain disabled through idempotent provisioning.
- One global selling state and one global mode govern new commerce. Pausing or later configuration changes cannot block reconciliation/exactly-once commitment of a payment already started or rewrite committed terms. Actual operational conflicts require owning-command validation; completing all historical orders is not a switch requirement.
- Geography first requires the confirmed customer coordinate to fall inside at least one active Global service-area polygon, then selects the closest active, capable, mode-ready fulfillment pin by Haversine distance and stable location-ID tie-break. Global areas are an expansion gate, not per-location routing. A current successful Lalamove quotation still decides whether the selected pickup/drop-off route is available and at what fee. Provider-derived address text must satisfy permanent-finalization rules independently of coordinate provenance. Never reroute by product stock or split the order.
- Money is integer minor units with explicit currency; quantities are exact integer base units where authoritative. Fixed weight variants share gram stock; counted goods use actual pieces/packs. Approximate grams and liquid volume never manufacture physical counts, exact conversions, or courier eligibility. The new sorting representation must preserve one accounting of the same goods and requires a coherent design.
- Exact-location prices have no global/market fallback and no silent zero. Paid records preserve names, units/base consumption, shipping weight evidence, price/discount/component allocations, address/contact/instructions and mode/location/promise/window/cutoff/quotation snapshots. Changes to current catalog/profile/configuration never rewrite them.
- Provider-confirmed canonical Payments `SUCCEEDED` is required for paid commitment. Preserve the successful financial observation when Order/addition application fails, retry the same bounded reaction and retain a visible exception. Browser return, initiation and timeout are not financial truth.
- Refund requests reserve outstanding and successful amounts against the captured budget atomically; only definitive failure releases that reservation. Coordinated cancellation covers the original payment and all committed additions, respects mode deadlines and derives completion from canonical refund success. No invented fee, provider cost, credit or refund policy.
- Instant holds, paid reservations, physical stock, Scheduled exact demand and cycle-allocated goods remain separate. Dispatch and accepted receipt are guarded exactly-once movements with immutable evidence. Instant packing consumes reserved stock; Scheduled per-Order Finish packing attests physical completion without a stock movement. Inspected surplus release cannot duplicate goods and spoiled goods cannot become sellable. Preserve unfinished atomicity/conservation/race acceptance for existing code, without requiring new stock-management screens.
- Product sales, grocery codes and delivery benefits require exact component allocation, atomic usage/allowance claims and immutable redemption/payment history. A revised stack is not implemented merely because the schema permits it. The approved overlap, remaining-sale quantity and cancellation rules in GD-D07 require the same atomic claim/release safeguards. A refund alone does not release stock.
- One active or uncertain delivery attempt spans external/manual methods. Stable attempt identity, verified events, definite closure before replacement, readiness and packed handover remain internal. Provider search, assignment, pickup and delivery are separate facts; conflicting pickup evidence remains recoverable rather than fabricated packing. Actual cost is nullable; accepted charge stays fixed. Internal BAG/BOX classification is not a provider request field and does not replace the fixed 20,000 g Motorcycle envelope. Item shipping weights are optional logistics metadata, not admission limits; actual packing must fit provider weight/size limits.
- D1 keys/foreign keys/exact numeric bounds/immutable evidence/unique operation identities protect integrity. Changeable business eligibility belongs in current Core commands, with the complete write set guarded against races; a zero-row update does not abort a batch. Critical database work is awaited, and database transactions do not make external calls atomic.
- External money/delivery/media/email effects use durable intent, exact replay, separate received/applied evidence, bounded recovery and redacting telemetry. Required private snapshots stay protected; they never enter general logs. Catalog/campaign R2 uploads require Core-generated identity, validated JPEG/PNG/WebP signature and a 5 MiB byte bound; messaging inputs follow their separately approved decode/re-encode rules. D1-authorized attachment/publication follows separately, with cleanup internal.
- Notifications and invoice readiness are consequences, never owners of financial/Order truth. Outbox/Queue delivery needs deduplication/lease/attempt/retry/DLQ safeguards. Customer transaction summaries say `NOT AN OFFICIAL BIR INVOICE`; seller/tax/serial/retention facts and irreversible erasure are never invented.
- Reports use one versioned definition with source/timezone/date basis, included/excluded records, units/currency and null-denominator behavior. Missing permission/data/cost is denied or unavailable, not zero. Use the approved report definitions in this guide. Old additional metric formulas remain archived evidence, not a mandate to add more reports.

Detailed transport, lifecycle, storage and runtime requirements are in the focused references routed by AGENTS. Their descriptions of existing interfaces/storage do not mandate exposing every historical capability. ENGINEERING retains the complete implementation/test/schema/Git safeguards.

## Source provenance

The 21 GD-D source entries below retain links to the protected original discussion; the nine 2026-09-09 follow-up approvals and subsequent dated owner decisions are applied in their subject sections. Original GD-1 source accounting, all 40 former-scope criteria, historical phase families and the 84-block/113-section mappings remain available at the immutable cleanup baseline. These records preserve rationale and coverage, not stale execution authority. Current engineering coverage lives in ENGINEERING; current application acceptance lives only in the checkpoint.

- [Guidance reconstruction and requirement dispositions](https://github.com/kezuflow/grocery-app/blob/75c0bd35936ccb3d5ef0fbcff565b0da877906bc/docs/operations/GUIDANCE_REBUILD_AUDIT.md).
- [Original source hashes](https://github.com/kezuflow/grocery-app/blob/75c0bd35936ccb3d5ef0fbcff565b0da877906bc/docs/archive/guidance-20260909/SOURCE_HASHES.json), [changed-block review](https://github.com/kezuflow/grocery-app/blob/75c0bd35936ccb3d5ef0fbcff565b0da877906bc/docs/archive/guidance-20260909/REQUIREMENT_REVIEW.json) and [complete section review](https://github.com/kezuflow/grocery-app/blob/75c0bd35936ccb3d5ef0fbcff565b0da877906bc/docs/archive/guidance-20260909/FINAL_SECTION_REVIEW.json).

### Original decision sources

The explicit 2026-10-05 owner request and effect-choice reply authorize the
[audited Order status-only correction](#audited-order-status-correction--owner-supplement-2026-10-05).
This later supplement changes only Order correction authority, preserving independently owned
financial and operational facts. Its implementation and acceptance are tracked separately as
`ORDER-STATUS-OVERRIDE-20261005` in the active checkpoint.

The 21 agreed sources remain unchanged; their later owner-approved corrections are applied in the subject rules above.

| ID | Protected original source |
| --- | --- |
| GD-D01 | [Agreed: customer experience](SIMPLIFICATION_DISCUSSION.md#agreed-customer-experience) |
| GD-D02 | [Agreed: Instant and Scheduled](SIMPLIFICATION_DISCUSSION.md#agreed-instant-and-scheduled) |
| GD-D03 | [Agreed, owner-corrected: delivery providers and courier parcel](SIMPLIFICATION_DISCUSSION.md#agreed-delivery-providers-and-order-weight) |
| GD-D04 | [Agreed: products, selling sizes and prices](SIMPLIFICATION_DISCUSSION.md#agreed-products-selling-sizes-and-prices) |
| GD-D05 | [Agreed: product images](SIMPLIFICATION_DISCUSSION.md#agreed-product-images) |
| GD-D06 | [Agreed: basic promotions](SIMPLIFICATION_DISCUSSION.md#agreed-basic-promotions) |
| GD-D07 | [Agreed: discounts on selected perishable products](SIMPLIFICATION_DISCUSSION.md#agreed-discounts-on-selected-perishable-products) |
| GD-D08 | [Agreed: no minimum checkout amount](SIMPLIFICATION_DISCUSSION.md#agreed-no-minimum-checkout-amount) |
| GD-D09 | [Agreed: ordinary preparation and staff screen](SIMPLIFICATION_DISCUSSION.md#agreed-ordinary-preparation-and-staff-screen) |
| GD-D10 | [Agreed: delivery booking and progress](SIMPLIFICATION_DISCUSSION.md#agreed-delivery-booking-and-progress) |
| GD-D11 | [Agreed: simple problem reporting after delivery](SIMPLIFICATION_DISCUSSION.md#agreed-simple-problem-reporting-after-delivery) |
| GD-D12 | [Agreed: staff access and fulfillment locations](SIMPLIFICATION_DISCUSSION.md#agreed-staff-access-and-fulfillment-locations) |
| GD-D13 | [Agreed: dashboard overview and reports](SIMPLIFICATION_DISCUSSION.md#agreed-dashboard-overview-and-reports) |
| GD-D14 | [Agreed: the typical Scheduled week](SIMPLIFICATION_DISCUSSION.md#agreed-the-typical-scheduled-week) |
| GD-D15 | [Agreed: one initial fulfillment location and transition toward Instant](SIMPLIFICATION_DISCUSSION.md#agreed-one-initial-fulfillment-location-and-transition-toward-instant) |
| GD-D16 | [Agreed: simple Instant stock management](SIMPLIFICATION_DISCUSSION.md#agreed-simple-instant-stock-management) |
| GD-D17 | [Agreed: whole produce and packs can be sold by named sizes](SIMPLIFICATION_DISCUSSION.md#agreed-whole-produce-and-packs-can-be-sold-by-named-sizes) |
| GD-D18 | [Agreed: local receiving establishes stock; dispatch records what was sent](SIMPLIFICATION_DISCUSSION.md#agreed-local-receiving-establishes-stock-dispatch-records-what-was-sent) |
| GD-D19 | [Agreed: customer email updates and staff dashboard notifications](SIMPLIFICATION_DISCUSSION.md#agreed-customer-email-updates-and-staff-dashboard-notifications) |
| GD-D20 | [Agreed, superseded in part: location assignment, local availability and Instant hours](SIMPLIFICATION_DISCUSSION.md#agreed-service-area-polygons-local-availability-and-instant-hours) |
| GD-D21 | [Agreed: first visit and Instant booking; payment options pending activation](SIMPLIFICATION_DISCUSSION.md#agreed-first-visit-and-instant-booking-payment-options-pending-activation) |
