# FreshMarkets Simplification Discussion

Saved: 2026-09-09 (Asia/Manila).

Status: saved owner-discussion checkpoint. The owner confirmed the final sale-quantity, daily administrator review and automatic Global dispatch-deduction decisions, then requested saving the discussion for now. This record does not authorize application changes, database changes, deployment, or a new implementation phase. Proposed details and deferred questions remain explicitly separate from agreed decisions.

Purpose: review the grocery business one customer or staff activity at a time, using plain English. Keep ordinary work simple and justify additional features with an actual business need. Explain code inspection findings separately from intended behavior; a saved decision is not proof of implementation.

## Discussion authority and concurrent work

Owner clarification: another agent is actively changing the codebase. Design this product from the owner's business requirements and explicit decisions in this discussion, rather than deriving policy from current code or an older implementation plan. Existing code is not a reason to retain an unwanted feature or reject an approved simplification.

Earlier source inspections are point-in-time observations and may already be stale. Do not present them as current implementation status without a fresh, specifically requested review. Keep agreed behavior, proposals, and implementation evidence clearly distinguishable. Continue the business discussion without repeatedly inspecting application code to determine what the owner should want.

This discussion maintains this decision record only. Do not edit the other agent's application work, redirect that agent, or treat agreement here as approval to implement. Before a future implementation task, reconcile the settled decisions with canonical documents and inspect the then-current working tree with clear file ownership. Do not undo concurrent work based on earlier observations.

## Agreed: customer experience

- A customer is a registered user. Registration does not create a paid membership. Remove active MEMBER/NON_MEMBER distinctions, subscription enrollment, trials, recurring billing, membership prices and membership-only discounts from the intended product.
- Visitors, including registered users who are signed out, can browse, search, choose quantities, and add or remove cart items. They must sign in before checkout. Their existing cart carries over when they sign in.
- Customers can manage their name, phone number and relevant personal details, recover account access, and sign out. Signing in and shopping should feel like one account without another enrollment step.
- Customers can add, edit and delete saved addresses and choose a default address. The account phone supplies a default; each address may have a different recipient and delivery phone. Addresses include delivery instructions and location confirmation.
- Customers can check delivery availability before the final payment step. Checkout requires a serviceable address, recipient/contact information, and a reachable mobile number.
- Customers can use promo codes and review items, quantities, discounts, delivery fee, final total, and the delivery promise or Scheduled window before paying. New commerce has no FreshMarkets Service Fee or customer-facing PayMongo processing fee.
- Payment results clearly distinguish success, failure and a result still being checked. Customers receive an appropriate next step.
- Customers can see current and past orders, amounts paid, the delivery address used, and preparation/delivery progress. Important order, payment, delivery, cancellation and refund updates are sent.
- Customers can cancel while their order is eligible. Eligible cancellation automatically starts the coordinated refund process. It does not promise immediate bank credit.
- Customers can report missing, wrong, damaged or poor-quality goods and delivery problems, and follow support/refund progress. Owner clarification: administrators alone handle these customer reports and review post-delivery refunds before an approved refund is submitted through PayMongo. A submitted issue is not itself an approved refund.
- Customers can contact FreshMarkets and request account closure. Closure does not automatically erase required order/payment history.
- Editing or deleting saved profile/address data never silently changes an already-paid order.
- Buy again adds currently available products to the current cart at current prices and reports skipped items.

## Agreed: Instant and Scheduled

The owner selects exactly one active mode for the whole shop. Customers do not choose between simultaneously offered Instant and Scheduled modes. These modes share customer accounts, addresses, product browsing, discounts, order history and support.

| Behavior | Instant | Scheduled |
| --- | --- | --- |
| Customer promise | Groceries delivered soon under the current promise. | Groceries delivered on the selected available date/window. |
| Supply | Sell physical stock already available at the fulfillment location. | Collect paid orders, then purchase the exact required quantities. |
| Ordering limit | Available stock and whether selling is open. | The ordering window and its cutoff; no stock check or cycle capacity. |
| Payment | At checkout. | At checkout before the ordering deadline. |
| Customer cancellation | Until staff accepts the paid order for preparation. | Strictly before the snapshotted cutoff, even if preparation started early. |
| Paid additions | No normal Instant deadline has been agreed; remain unavailable until reviewed. | Allowed before cutoff, with payment for the additional items. |

Scheduled purchasing is not reduced by existing Instant stock. The existing pause-before-mode-switch rule and preservation of already-paid orders remain applicable.

## Agreed: delivery providers and order weight

- Customers can choose an available delivery provider. The intended providers are Lalamove and GrabExpress. Lalamove is the initial provider; the owner reports Grab is not yet active. Offer Grab only after activation and verification that it supports that particular delivery.
- Show the available provider's delivery fee and reliable timing information. When only one provider is available, an extra selection step is unnecessary. Customers do not select a fulfillment hub.
- Each order must weigh 20 kg or less including packaging, and fit the selected courier service's package size limit. Account for products sold by piece or pack as well as by weight.
- Explain an overweight cart and block checkout before payment. Customers can reduce quantities or remove items to proceed.
- The same limit applies to Instant and Scheduled. Paid additions must keep the complete order, including previously paid items, within the limit.
- This is a per-order delivery limit, not a Scheduled cycle/order-count capacity.
- Example message: "Each order must weigh 20 kg or less, including packaging. Please reduce quantities or remove some items to continue."
- The packing allowance and a practical package-fit standard still need operational details; do not invent an allowance or treat weight alone as proof of fit.

Provider pages checked during the discussion list Lalamove Motorcycle at up to 20 kg and 50 x 40 x 50 cm, and GrabExpress Bike at up to 20 kg and 40 x 40 x 32 cm. These are published service descriptions, not proof of this account's activation or actual booking acceptance. See [Lalamove Philippines delivery limits](https://www.lalamove.com/en-ph/all-delivery-pricing-detail) and [GrabExpress Philippines](https://www.grab.com/ph/express/). Reverify the actual enabled service during implementation.

## Agreed: products, selling sizes and prices

- Staff can create and edit product names, descriptions, categories, customer-facing details, selling sizes, and prices through ordinary forms.
- Customers buy fixed sizes at listed prices. For example, buying 500 g of carrots means paying the listed price for that 500 g portion. Do not add post-packing repricing or weight-based extra charges.
- Different sizes consume the same product stock in Instant. Selling a 500 g and a 1 kg pack consumes 1.5 kg from the shared carrot stock.
- Count-based products use their actual contents: a tray of 12 eggs consumes 12 eggs; packaged liquids can be sold as individual bottles.
- Global staff with price authority manually set each selling size's final price at each exact location. A 1 kg price does not have to be twice the 500 g price. Preserve existing price authority and multi-location support without making the current one-location workflow harder.
- Scheduled uses the same catalog/selling sizes/prices while recording paid purchasing quantities separately from Instant inventory.

## Agreed: product images

- A product supports at most five active images total: one main image and up to four optional additional images. Five images are not mandatory.
- Both Add Product and Edit Product contain one ordinary Images section with visible previews.
- Staff can add, replace, remove, choose the main image, and rearrange the photos. At five images, explain that one must be replaced or removed before another is added.
- Product listings show the main photo. The customer's product page allows browsing all available product photos.
- Photo changes belong in ordinary product management. Storage cleanup/recovery procedures do not become catalog operator tasks.

Code inspection during this discussion found multiple-image upload, main-image selection, removal and numeric ordering. It did not find a five-image count limit, direct replacement, or a customer gallery. The dedicated Edit Product form did not include the image controls, which were on the detail page; new-product creation did allow image uploads. The existing 5 MiB limit concerns each file's size, not image count. These were source observations, not freshly executed browser acceptance; recheck the working tree before implementation.

## Agreed: basic promotions

Use an ordinary promotion form with named choices and a clear preview. The owner agreed with the following basic offer types and controls:

| Offer | Example |
| --- | --- |
| Fixed grocery discount | PHP 50 off groceries. |
| Percentage grocery discount | 10% off, optionally capped at a maximum discount amount. |
| Free delivery | Remove the delivery charge. |
| Fixed delivery discount | PHP 30 off delivery. |
| Percentage delivery discount | 50% off delivery, optionally capped. |

- Useful promotion conditions are an optional minimum grocery spend for that offer, start/end dates, an optional per-customer limit, an optional total-use limit, and first-order eligibility where needed. An offer's spending condition does not impose a minimum for placing an order without that offer.
- Revised owner-approved combination rule: different products may have their own sales, each item receives at most one product-sale discount, one grocery checkout promo code may discount eligible full-price items only, and one delivery promotion may also apply. Sale items never receive the grocery-code discount as well. This replaces the earlier blanket one-grocery-discount rule for the planned behavior; the application has not been changed by this discussion.
- Remove membership conditions. Present first-order/new-customer eligibility as one choice while both mean no previous orders; do not preserve duplicate choices without an agreed different meaning.
- Owner correction: there is no minimum checkout amount in either Instant or Scheduled. Remove the earlier general grocery-minimum requirement from the intended behavior; optional promotion spending conditions remain separate.
- Several product sales may coexist in one basket under the revised rule. Do not silently expand this to multiple grocery checkout codes, multiple delivery promotions, or two discounts on the same item.

## Agreed: discounts on selected perishable products

The owner approved temporary product sales through the same Promotions screen and the revised combination rule above. Detailed open questions below remain separate from that approval.

Ordinary workflow: select products or selling sizes, select the applicable location, enter a discount and start/end time, and show an automatic sale price with the regular price crossed out. Example: 20% off 500 g tomatoes until tonight; a regular PHP 60 price becomes PHP 48, while other products keep their normal prices. Staff can stop the offer early. When the offer ends, new purchases use the current regular price; paid orders retain the price paid. Staff decides when an offer is appropriate; a perishable label does not itself calculate freshness or start a discount.

Combination example: tomatoes already at 20% off retain that sale price when the customer enters a 10%-off grocery code. The code applies only to eligible full-price groceries. Other products may have their own sales, and one eligible delivery promotion may also apply.

Clearing stock already held is an Instant use case. A Scheduled product promotion can discount an advance order, but must not use or reduce existing Instant stock or change Scheduled exact-demand purchasing. Goods that are no longer sellable are removed from sale rather than made eligible through a discount.

Code inspection found the current promotion amount calculation uses the complete grocery subtotal or delivery fee. The inspected promotion authoring contract has no selected-product/selling-size target. Item identity in checkout context is not itself implementation of product-specific discounts.

Owner-approved clearance quantity rule: a product sale covers a chosen quantity at one fulfillment location. For example, an administrator puts 5 kg of that location's potatoes on sale at 50% off. The remaining sale allowance decreases as qualifying quantities are sold and cannot authorize sale of unavailable physical stock. The discount allowance is separate from the stock itself; creating the offer does not add inventory. This is clearance of existing Instant stock, not a physical-stock rule for Scheduled preorders.

Owner-approved full-quantity rule: if the requested quantity of an item, including multiple units of the same selling option, exceeds the remaining sale allowance, do not apply that product sale to the item. When only 500 g remains eligible, a customer ordering 1 kg receives no sale discount on that item. Do not automatically split the item into discounted and regular-price quantities or apply the full discount while exceeding the allowance. A 500 g option can qualify if offered and available. Explain the remaining sale quantity; other basket items retain their own eligibility.

The sale allowance and actual available stock remain distinct. If the location has enough physical stock but only 500 g left on sale, a 1 kg item can be purchased at its normal price. If 500 g is also the entire physical stock available, an Instant 1 kg purchase is unavailable altogether under the already-approved stock rule. Removing the discount never authorizes selling missing stock.

Remaining details for discussion before implementation:

- The full requested quantity rule is settled. How ordinary-price sales or stock removals affect clearance quantities from the same physical stock remains a deferred detail; do not silently introduce stock-lot tracking or promise that an offer identifies particular physical potatoes.
- Exact discount basis for fixed product offers, if wanted in addition to the agreed percentage-sale example.
- Which product sale wins if several active offers target the same item; only one may apply to that item. The proposed simple authoring rule is to prevent overlapping product sales for the same selling option at the same location, requiring the administrator to stop or change the existing sale first. This restriction is a recommendation, not yet approved.

## Agreed: no minimum checkout amount

FreshMarkets imposes no minimum grocery spend to place an order in either Instant or Scheduled. A customer may check out a small nonempty order, subject to the other agreed availability, address, delivery, weight and payment requirements. Do not reject an otherwise eligible order because it is below a store/market basket minimum.

Optional spending conditions on a promotion affect eligibility for that discount only. They do not stop the customer placing the order without that promotion. This decision supersedes the earlier discussion-record statement preserving a general pre-discount grocery minimum; application behavior and canonical documents remain to be reconciled in a future implementation task.

## Agreed: ordinary preparation and staff screen

The owner says to assume products are ready to sell and sellable for the normal workflow, approves the simple staff screen, and asks to move on from the proposed supplier-shortage scenario. Do not expand this discussion into a separate shortage-management screen or new quality-grading workflow.

The approved staff screen contains:

- A list of paid orders needing work.
- A clear Start preparing action.
- An item checklist with the ordered quantities.
- A general Report a problem action when needed.
- Ready for pickup when packing is complete.

Preparation, courier assignment and actual pickup remain distinct facts. Staff accepting an Instant order for preparation closes its normal customer cancellation window; Scheduled cancellation still closes at cutoff. This normal-flow assumption does not change the already-agreed Instant stock limits, Scheduled exact-demand purchasing, or require fabricated successful preparation/delivery evidence. Existing exception handling is not certified or removed by this discussion record.

## Agreed: delivery booking and progress

- Customers select an available courier and accept the delivery charge at checkout. Lalamove is the initial provider; GrabExpress is offered when activated and available for that delivery.
- Booking uses the order's saved recipient, address, phone and delivery instructions; staff should not retype those details.
- Owner-approved Instant flow: once all items are checked and final packing starts, the app automatically requests the chosen courier while staff finishes packing. Staff works from the order's preparation screen. Scheduled can use a supported future pickup once the goods are checked and a realistic ready time is known; its separate booking flow is not replaced by the Instant automation decision.
- Show finding a rider, rider assigned, picked up and delivered as distinct delivery progress. Courier assignment does not imply completed packing or actual pickup.
- Staff hands over only a completely packed order. External pickup/delivery progress comes from the courier's reported facts.
- Customers see a simple order timeline, delivery details, and useful tracking information actually available from the provider. This does not authorize building an internal driver map or fleet.
- The customer's accepted delivery charge stays fixed. Record the actual courier cost and difference separately; do not silently charge the customer again.
- The owner explicitly keeps emergency manual delivery for Scheduled orders only when a normal courier delivery cannot be arranged. Staff records the person's name and phone, handover, and completion or failure. Keep the reason and actual cost where known with the existing delivery evidence. Manual delivery is not offered as a customer checkout provider and does not change the accepted charge.
- Preserve one active delivery attempt: confirm the prior courier attempt has ended before replacing it with another attempt or manual delivery. An uncertain booking result is not proof of cancellation. These internal safeguards must not become a separate ordinary staff workflow.

## Agreed: simple problem reporting after delivery

The customer opens an order and clicks Report a problem. The report is attached to that order automatically. Do not require selection of affected items or an item-by-item explanation before the customer can report the problem. Owner correction: only administrators handle these customer reports, contact the customer, decide the resolution and manage any approved refund. Operations staff does not handle customer reports. Operations can still flag a preparation or delivery problem on its assigned orders.

Reporting remains separate from refund approval and does not automatically approve an amount. Administrator review is required for post-delivery refunds. The owner confirms administrators check these problems every day and is satisfied with manual administrator resolution for now. Record daily review as the operating practice, not an automatic refund, guaranteed same-day resolution or a new scheduled job. No numerical reporting deadline or automatic refund formula was selected; do not invent an expiry rule or repeatedly reopen this question merely to complete the discussion. Additional required forms, evidence uploads, or per-item workflows have not been approved.

Owner's preferred direction for unsuccessful deliveries is to put the problem in the appropriate existing business view, manually contact the customer and resolve it there. Proposed presentation, awaiting confirmation: one administrator Problems list for customer reports and actionable order/delivery problems, linked to the order, with customer contact information, a short resolution note and simple New / Being handled / Resolved progress. Administrators use ordinary phone/email contact; this does not approve building a chat system. Reuse a suitable existing business view when implementing; this discussion has not inspected the current UI. Resolving the problem record does not by itself mark an order delivered or a refund successful. Actual refund/retry/cancellation actions retain their existing safeguards. A blanket extra-delivery-charge rule has not been selected, and the accepted customer delivery charge remains fixed.

## Agreed: staff access and fulfillment locations

The owner approved two starting business roles:

| Role | Responsibilities |
| --- | --- |
| Administrator | Manage products, prices, promotions, customers, orders, customer problem reports, refunds, fulfillment locations, settings and staff access across the business. |
| Operations staff | View orders, manage stock, prepare/pack orders, book deliveries and handle handover at their explicitly assigned fulfillment locations. Read the applicable prices and the approved location dashboard/reports. |

Operations access is location-specific. Staff must not see or operate on another location merely by changing a screen filter or choosing an unassigned location. Administrators manage the business across locations. Price changes, promotion authoring, handling customer problem reports, refund approval and staff-access management stay with administrators under this starting arrangement. Previously approved local dashboard visibility does not grant Operations the right to handle reports or contact customers as their report handler.

Each staff member has their own login. The staff-management screen supports invitation, role and fulfillment-location assignment, later access changes, and disabling access. Record who performed important actions such as refunds or stock adjustments. These role names describe business responsibility groups; implementation must preserve the existing permission-based authority rather than use a single unrestricted admin flag.

## Agreed: dashboard overview and reports

The owner approved the proposed overview and reports for staff, and explicitly requires administrators to view everything across the business. Operations staff can view these sections and reports for their assigned fulfillment locations only. Administrators can inspect one location or the whole business. Viewing payments, customer problems or refunds does not grant Operations staff refund approval, global customer administration, price/promotion writes, or staff-access management.

The overview answers what needs doing now:

| Section | What it shows |
| --- | --- |
| New paid orders | Orders awaiting preparation. |
| Being prepared | Orders staff have started working on. |
| Ready for pickup | Packed orders waiting for collection. |
| Deliveries in progress | Picked-up orders not yet delivered. |
| Customer problems | Orders whose customers clicked Report a problem. |
| Refunds needing attention | Requests awaiting administrator review or refunds still processing; actions remain role-restricted. |

Each section links to the relevant orders. Show the active Instant or Scheduled mode. Scheduled additionally shows the upcoming delivery date, ordering cutoff and quantities to purchase.

Approved reports:

- Orders: paid, completed and canceled orders over a chosen period.
- Payments/refunds: money received and refunded, shown separately.
- Products sold: quantities by product and selling size.
- Discounts: promotion use and discount amounts.
- Delivery costs: accepted customer delivery charges compared with actual recorded courier costs.

Use ordinary date filters such as today, this week, this month or a chosen range. Location filters must respect staff assignments; administrators may view across locations. Each total needs a clear meaning and access to the relevant authorized underlying records. This approves report scope and audience; canonical metric definitions, date bases and implementation evidence still need explicit reconciliation before publishing totals. Missing actual courier cost must remain unavailable rather than be reported as zero.

## Agreed: the typical Scheduled week

The owner described the normal weekly operation as follows. These are business steps, not a claim about current code or a replacement for the separate order, payment and delivery states.

| When | Business activity |
| --- | --- |
| Sunday, after the previous week's deliveries | Enable the products to offer for the upcoming week and use the configured ordering/delivery schedule. |
| Monday to Friday in the typical configured schedule | Customers place and pay for orders while that week's ordering window is open. |
| Friday night, or the configured cutoff | Close ordering for that week and total the paid quantities needed from the supplier. |
| After cutoff | Staff contacts the supplier to arrange delivery of the required vegetables. |
| When the vegetables arrive | Staff updates the received-goods status and proceeds to preparation/packing. |
| Preparation and delivery | Package each customer's order and book its delivery, using the agreed readiness rules. |

- Monday-Friday and Friday night are the typical schedule, not hard-coded dates or times. Administrators set the actual opening, cutoff, delivery date and delivery windows. No exact cutoff clock time or delivery-window hours were specified in this discussion.
- Enabling next week's products on Sunday prepares the offering; it does not open checkout before the configured Monday opening. Product changes for the next week do not rewrite the previous week's paid orders.
- The cutoff closes new orders, normal paid additions and normal customer cancellation for that cycle. Purchase quantities include committed paid additions and exclude accepted coordinated cancellations, as already agreed. Scheduled purchasing remains exact paid demand without Instant stock netting.
- Contacting the supplier is an ordinary staff activity. This description does not request a supplier portal, automatic supplier messaging, or a new approval workflow.
- The owner assumes goods are sellable for the normal preparation flow. Keep the received-status update simple and retain the approved item checklist and preparation screen.
- Packaging and courier booking are handled per paid order. Booking may occur during preparation under the already-agreed conditions; completed packing is required before physical handover. Booking is not proof of pickup or delivery.

Suggested presentation, still for discussion: one weekly work page showing dates/cutoff, offered products, paid customer orders and the consolidated purchasing quantities, with simple progress actions. Do not expose technical lifecycle controls as ordinary staff work. No new workflow screen is approved merely by this suggestion.

## Agreed: one initial fulfillment location and transition toward Instant

Owner clarification: Scheduled is the initial operating approach while the business works toward Instant. During the initial Scheduled operation, all goods stay within the first fulfillment location. Suppliers deliver there, staff receives and packs there, and couriers collect customer orders there.

- Use one actual fulfillment location for launch, with its address, pickup contact, staff assignments and delivery area. The initial flow does not require a separate central warehouse or movements between sites.
- The future Instant operation uses that same location. Preserve products, selling sizes, customers, addresses, prices, orders and staff history across the mode change; do not create a second shop or duplicate catalog merely to operate Instant.
- Keep support for additional fulfillment locations, as previously agreed, without making unused inter-location operations part of the first location's daily work. This clarification concerns the launch setup, not removal of every future warehouse/transfer capability.
- Scheduled goods received at that location still belong to the paid weekly orders. Co-location does not make those goods available for Instant sale or authorize subtracting them from Scheduled purchasing requirements.
- No transition date, automatic switch, or permanent removal of Scheduled mode has been chosen. The administrator continues to choose one active mode while ordering is paused; existing paid orders retain their original promises and rules.

Recommended transition, still for discussion: finish the last planned Scheduled week, pause new ordering, receive/count the stock intended for Instant and record the available quantities, check active products/prices and location readiness, switch to Instant, and reopen. Finishing the last Scheduled week first is an operational simplification, not a newly approved technical condition that every historical order must be completed before a mode switch. Do not automatically convert goods assigned to outstanding Scheduled orders into Instant stock. Any actual inspected surplus requires an explicit stock release under the existing policy.

## Agreed: simple Instant stock management

The owner approved a product stock list for each fulfillment location showing physical stock, stock set aside for checkout/orders, and the remaining quantity available to sell. Operations staff uses Add stock and Remove stock with a quantity and a short removal reason. Record who changed stock and when. Order-related stock movements and eligible cancellation releases happen automatically; staff must not manually subtract the same order again.

Different genuinely weight-based selling sizes consume the shared product stock. For whole produce sorted into named sizes, the newly approved local counting workflow below determines the actual pieces/packs available for each size; an approximate gram figure is not an exact stock conversion. Scheduled uses the weekly purchasing/received-goods view and does not require duplicate entry as available Instant stock.

## Agreed: whole produce and packs can be sold by named sizes

Owner clarification: pieces and packs remain supported. For broccoli, the business may receive 20 kg but offer customers whole pieces as Small, Medium and Large, rather than 500 g or 1 kg portions. Record the received weight and retain gram-based information needed for delivery weight; do not force a weight label onto the customer-facing offer. The agreed fixed listed price for each selling option remains applicable.

The owner confirms that receiving staff can and should count the available Small, Medium and Large pieces/packs when vegetables arrive; this is the ordinary workflow. Bulk broccoli can be dispatched in a weighed sack without counting pieces at the sending site. At the receiving location staff records what actually arrived, sorts the broccoli and enters the actual size counts. The owner's reference to counting pieces for analytics does not make those counts reporting-only: the confirmed counts also control how many of each size can be sold in Instant. A 20 kg receipt alone does not establish those counts, and dividing it by an approximate pack weight must not invent them. These quantities describe the same goods; do not create duplicate sellable stock by separately crediting the bulk receipt and its sorted packs. Scheduled receipt/sorting remains preparation for paid preorder demand, not an Instant-stock check or credit.

Owner-approved ordinary product form: product Broccoli, variant name Small, selling unit Pack, approximate contents weight 300 g. Medium and Large are other variant names, each with its own appropriate weight. Every sold product/option needs its applicable weight information; one product-level estimate must not be reused for differently sized options. Record grams for products actually portioned by weight and actual available counts for whole pieces or prepared packs. Approximate contents weight supports the customer description and estimated shipment weight, not exact stock deduction for those counted packs. A 300 g estimate must not become a claim that every pack weighs exactly 300 g or by itself prove compliance with the full packed-order delivery limit. Practical handling of weight variation and packaging still needs operational values.

The accepted packaged-liquid example describes oil as a 500 ml bottle while counting stock in bottles/pieces. Shipping uses the filled bottle's weight in grams, including its container; milliliters must not be treated as equivalent grams. Selling poured liquid by volume has not been requested.

## Agreed: local receiving establishes stock; dispatch records what was sent

The owner describes a Global-to-location supply flow: Global weighs a sack of broccoli and records it as sent; receiving staff at the destination records the actual receipt and sorts/counts the available selling sizes. The destination's stock comes from what its staff confirms, not an automatic assumption that the sender's reported quantity arrived. Keep the sender's dispatch history as evidence of what was reported sent. The owner has now explicitly confirmed that sending stock also automatically deducts Global's stock balance; dispatch is not passive history alone.

Recommended simple presentation, still a recommendation: one linked Receive stock action showing the reported sent weight, actual received weight and resulting Small/Medium/Large counts. For example, preserve both Sent: 20 kg and Received: 18 kg, with a short note about the difference. Do not overwrite the sent figure to make the records agree, automatically mark the difference lost/returned, or add the stock again through a second ordinary Add stock step. Receiving and any later sorting of the same goods must never duplicate the available quantity. Stock history records who entered or corrected it.

Owner-approved Global stock rule: sending stock to a fulfillment location automatically reduces Global's stock balance by the dispatched quantity when the goods actually leave. Creating a draft or merely planning a shipment does not mean it was sent. Staff must not separately deduct the same shipment, and saving/retrying its dispatch must not deduct it twice. Sending does not credit destination stock before accepted receipt. This preserves the useful sent/received distinction without counting the same sack as still available at Global and also available at the destination. The destination still records actual receipt and local counts, with differences retained in the linked history.

This clarification does not require a separate warehouse for the initial Scheduled launch. Suppliers may still deliver directly to the first fulfillment location under the already-agreed launch setup. The bulk-weight and local-count business workflow will need canonical reconciliation with the older shared-product-pool and base-unit rules before implementation; do not force a false exact weight-to-piece conversion to preserve the older design.

## Agreed: customer email updates and staff dashboard notifications

The owner confirmed that customer emails and staff dashboard notifications are enough for launch. Customer order pages show the same underlying order progress. No additional SMS or push channel is requested by this decision.

| Event | Notification |
| --- | --- |
| Confirmed payment/order | Customer receives order confirmation; staff sees the new paid order. |
| Courier pickup | Customer receives an Out for delivery update. |
| Delivery completed | Customer receives delivery confirmation. |
| Accepted cancellation | Customer receives the cancellation update and refund progress where applicable. |
| Refund completed or needing attention | Customer receives the relevant update; administrators see work requiring their action. |
| Customer clicks Report a problem | Administrators receive the request linked to that order and handle it. |

Operations notifications are restricted to assigned fulfillment locations. Administrators can view across the business. Notifications link to the relevant authorized order or request. Avoid customer emails for every intermediate packing step; show preparation progress on the order page.

Customer problem-report work and its action notifications belong to administrators. This corrects the earlier generic reference to staff handling those requests; location staff's normal order/preparation/delivery notifications remain applicable.

Promotional messages remain optional and separate from important transaction updates. Notification delivery is a consequence of recorded order/payment/delivery facts and does not determine whether an order, payment or refund succeeded. Saving this decision does not send messages or configure a provider.

## Agreed: service-area polygons, local availability and Instant hours

Owner supplement, 2026-09-12: the polygon/geofence portions of this section are superseded. FreshMarkets will store an exact map pin and courier pickup profile on each customer-fulfillment location. A confirmed customer coordinate selects the nearest active, capable fulfillment location for the whole order; checkout rechecks mode readiness, and Lalamove's current quotation decides whether the specific pickup/drop-off route is deliverable and supplies the fee before payment. Administrators no longer draw or publish customer service-area polygons. Retained area/zone/link records may remain for historical snapshots and schema compatibility but are not current address, readiness, quote or payment authority. The local catalog/pricing ownership, address-change recheck, no stock-based rerouting/split, and configurable Instant-hours decisions below remain in force.

The owner explicitly chooses a stored service-area polygon for each fulfillment location. For example, Cebu City Store #1 has its own pickup location and a polygon defining the customer addresses it serves. Administrators draw/edit and save that boundary on a map. This is a discussion decision, not authorization to implement or publish a real boundary now.

- Use the customer's delivery coordinate to determine whether the address lies within a location's service area. An address outside every supported area cannot check out for delivery.
- Product availability depends on the fulfillment location serving that address. Different locations may offer different products and have different physical stock. Do not use another location's stock or product activation as proof that an item is available for this customer's order.
- Instant uses that location's active selling options, exact prices and currently available physical stock. Scheduled uses that location's offered products and configured cycle/window; it still does not check or deduct physical stock.
- Changing the delivery address can change the serving location and therefore the offered products, prices and availability. Recheck the cart and show affected items/totals for review; do not silently change a paid order or promise availability from the previously selected area.
- Customers choose their delivery address and an available courier, not a fulfillment hub. Accurate local availability requires a resolved delivery area; do not fabricate local stock when the address/location is not yet known.
- Configure Instant working/ordering hours for each fulfillment location. Customers may browse and see that location's current product availability outside those hours. Checkout is blocked outside the allowed ordering hours with a clear opening/closing-time message. Do not represent closed ordering hours as zero stock or as an address outside the service area.
- Example hours message: "Checkout is available from {openingTime} to {closingTime}." Exact hours have not been specified and must remain configurable.
- The hours restriction concerns starting new Instant checkout/payment. It does not stop previously paid orders, refunds or completion/reconciliation of an already-started payment. Scheduled follows its configured ordering period and cutoff rather than treating the location's physical working hours as its ordering window.

Owner-approved overlap rule: when multiple service-area polygons cover an address, select the nearest eligible fulfillment location for the whole order. Use that location's offered products, prices and applicable availability. Do not split an order across locations or silently switch locations because another site has an unavailable item in stock. This approval settles the proposed location-selection behavior; it does not certify implementation.

## Agreed: first visit and Instant booking; payment options pending activation

Owner-approved first visit: show Where should we deliver? with address entry/map pin and an optional Use my location action. A visitor can do this without registering. Resolve the serving location, then show its prices and availability and remember the chosen location for later visits. A visitor may skip the prompt and browse the general catalog, with a clear request to set the delivery location for prices/availability and before adding location-specific items. At checkout, a signed-in customer confirms the full delivery address, recipient and phone. Changing location still rechecks the cart under the agreed rules. Do not assume device location permission or replace an address with an unconfirmed device position.

Sign-in clarification: Better Auth remains the authentication system. The earlier question concerned the customer-facing choices such as email/password or Continue with Google, not choosing or rebuilding authentication. Better Auth supports both examples; see its [basic usage documentation](https://better-auth.com/docs/basic-usage). Do not claim which are currently configured without a requested inspection. Existing approved choices need no new design discussion merely because authentication was listed as a gap. The owner's new payment-method list below does not select new sign-in methods; Google Pay is a payment choice, not Google sign-in.

Owner-approved future payment presentation: prepare visible but disabled/unclickable choices for GCash, GrabPay, Maya, Google Pay, Visa and Mastercard, BDO, BPI, Landbank, Metrobank, RCBC and UBP. The owner will enable each method through an ordinary code change when ready. Payment-method availability is defined in code; do not build a feature-flag system, runtime settings record or admin enable/disable screen for this purpose. Show a clear unavailable/not-yet-enabled explanation rather than suggesting selection will work. This is a requested frontend behavior in the discussion plan, not authorization to implement that frontend now or to activate a provider. The list is not evidence that PayMongo or this merchant account supports every named option. Verify the actual payment channel/account/device readiness before enabling each choice, and reject unavailable methods at checkout as well as disabling their controls. Do not infer a bank's transfer or card payment mechanism from its name, invent working provider mappings or let disabled choices initiate payment. Which methods become active remains pending the owner's provider setup and code changes.

The owner approves Instant checkout, payment, paid order appearing at the fulfillment location, and packing overlapping with calling the driver. Payment at checkout also applies to Scheduled; the Instant distinction is preparing the current order for delivery now. Approved automation: after payment is confirmed, staff sees the order and starts preparing; once all items are checked and final packing starts, the app automatically requests the chosen courier while staff finishes packing. Complete packing before handover. This replaces the earlier explicit staff-booking step for ordinary Instant delivery while preserving its readiness condition and the existing Instant cancellation deadline. Do not book solely because the customer clicked Pay or create duplicate courier attempts.

Provider rationale: Lalamove says an immediate-order driver heads to pickup after accepting the order; see [Lalamove's API reference](https://developers.lalamove.com/). Finding a driver is not a promise that one is assigned immediately. The approved timing allows packing and rider search to overlap with a credible pickup readiness state. Before implementation, verify the actual enabled provider behavior. Keep the customer's accepted delivery charge fixed if the later booking cost differs.

Owner-approved customer timing approach: show a realistic estimated delivery range before payment based on the first location's actual preparation and delivery experience, then show honest preparation, rider-search and delivery progress with updated estimates when available. The actual range still needs operational input; no fixed 30-minute or other numerical guarantee is selected. Scheduled continues to display the configured delivery date/window.

## Saved scope and deferred details

The main ordinary customer and staff journeys have been discussed, and the owner has requested saving the discussion for now. The following distinguishes settled scope from remaining setup values and deferred suggestions. It does not approve additional features or reopen settled rules.

- Whole produce and packing: local sorting/count entry, approximate weights for each selling option and automatic source deduction on Global dispatch are agreed. The receiving screen presentation remains a recommendation; practical weight variation, packaging values and exact pack contents still need operational input. Reconcile the approved count workflow with older stock rules before implementation, without treating approximate weight as an exact conversion.
- Product sales: chosen quantities per location and no sale discount when the full requested item quantity exceeds the remaining sale allowance are agreed, including multiple units. Ordinary Instant stock limits still apply independently. Overlapping-offer authoring and interaction with ordinary stock depletion remain deferred details; fixed product discounts remain optional.
- After-delivery support: administrators alone handle reports, check them daily and resolve them manually. Keep the single order-level Report a problem action. No numerical reporting deadline, automatic refund formula or guaranteed resolution time is adopted by this checkpoint. The proposed Problems list remains a presentation suggestion; daily administrator review is sufficient for the owner's current discussion scope.
- Unsuccessful delivery: use manual administrator contact/resolution with daily review under the agreed responsibility. Retain the accepted customer charge and actual refund/payment safeguards. No fleet, routing or exception-management project is authorized. Scheduled emergency manual delivery remains approved.
- Sign-in and payment choices: retain Better Auth and any already-approved sign-in choices. The owner's named payment choices should be visible but disabled until provider setup and explicit enablement in code; no payment-method feature-flag system or admin toggle is wanted. Actual supported channels and which methods are enabled remain launch setup work. Do not infer them from changing code or equate Google Pay with Google sign-in.
- First visit before an address is known: the address/pin prompt, optional general browsing and location selection before location-specific cart additions are now approved.
- Instant booking and delivery promise: automatic booking when checked items enter final packing and the estimated delivery-range approach are now approved. Actual preparation/delivery times and Scheduled windows still need operational input. Real boundaries, contacts, hours and weekly cutoffs are configuration values.

The weekly page presentation and suggested Scheduled-to-Instant changeover sequence remain optional proposals. Normal Instant paid additions remain unavailable pending a separate decision. Dashboard report calculations need clear definitions before implementation, but no separate analytics product is implied. This discussion review is not a codebase implementation audit or a claim that every possible operational exception has been reviewed.

Coverage checkpoint: the owner has settled the full-item sale-quantity rule, confirmed daily manual administrator review and approved automatic Global stock deduction on dispatch, then asked to save the discussion for now. The ordinary customer, catalog, stock, Scheduled, Instant, preparation, delivery and administrator responsibilities define the agreed product direction. Opening hours, delivery windows, real boundaries, packing/weight values, payment activation and report definitions remain setup or implementation-detail work; other deferred suggestions remain marked above. Do not expand the feature list or imply that every earlier suggestion has been approved. Saving this checkpoint does not authorize implementation or certify the changing codebase. A future code review must compare actual behavior against the agreed rules rather than re-derive the business from code.

## Canonical reconciliation and remaining discussion

This is a saved owner-decision record for the continuing discussion, not a replacement implementation specification. Before implementing the changed behavior, reconcile [AGENTS.md](../../AGENTS.md), [DOMAIN_MODEL.md](../architecture/DOMAIN_MODEL.md), [STATE_MACHINES.md](../architecture/STATE_MACHINES.md), [API_CONTRACTS.md](../architecture/API_CONTRACTS.md), [DATA_MODEL.md](../architecture/DATA_MODEL.md), [ARCHITECTURE.md](../architecture/ARCHITECTURE.md), [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), and relevant design guidance with the owner's settled decisions.

Known reconciliation items include the earlier no-customer-courier-choice rule, restricted customer profile fields versus account/contact editing, the total packed-weight cap, five-image editing/gallery behavior, duplicate first-order/new-customer choices, selected-product sales and per-location quantity limits, the revised discount combination/basis rule, removal of the general minimum-checkout requirement in both modes, the approved simple preparation/delivery screen with automatic Instant booking at the readiness boundary, administrator-only handling of order-level customer reports without mandatory item selection, the two starting staff responsibility groups with explicit location restrictions, location-scoped staff reporting with business-wide administrator visibility, the configurable weekly Scheduled business sequence, the one-location launch without a separate central-warehouse transfer flow, the simple Instant stock screen, and bulk produce received by weight then sorted into actual local piece/pack counts. The approved local counting workflow needs reconciliation with older canonical base-unit and stock-ownership rules; the business choice to count locally is no longer an open question. First-visit location selection and the requested disabled payment options also need future UI/contract reconciliation. Do not describe any of these as implemented merely because this record exists. Keep actual retained records distinct from unwanted active membership features.

Final saved checkpoint for this discussion: the nearest eligible fulfillment location serves the whole order; first-visit location selection and automatic Instant courier booking at checked-items/final-packing readiness are approved. Global dispatch automatically deducts the sent quantity from Global stock. Receiving staff confirms actual receipt and local piece/pack counts; sending does not itself credit the destination. Approximate selling-option weights remain distinct from those counts. The full requested item quantity must fit the remaining product-sale allowance for that sale to apply, and physical stock availability remains independently enforced. Administrators review problems daily and resolve them manually. The requested payment options remain disabled until the owner enables them in code after provider setup; no feature-flag system is requested. The receiving-screen presentation, one-page weekly presentation, recommended changeover sequence and earlier full store-settings list remain proposals beyond explicitly settled controls. The owner declined expansion into the supplier-shortage scenario and requested saving only for now. Earlier confirmations stand; revisit them only when a new requirement exposes a concrete conflict. No saved decision or proposal is certified as implemented.
