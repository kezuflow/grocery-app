# FreshMarkets State Machines

Focused technical reference; load the sections affected by the current command or data change. Business meaning is in [PRODUCT.md](../product/PRODUCT.md); technique and verification are in [ENGINEERING.md](ENGINEERING.md). The decision reconciliation in PRODUCT identifies approved intent still needing implementation. This specification does not certify the current code. Historical source and requirement accounting are in [the GD-1 audit](../operations/GUIDANCE_REBUILD_AUDIT.md).

## Enforcement Rules

States are changed only through named application commands. Client, application, and admin lifecycle commands check current state, actor capability/scope, business preconditions, a stable idempotency key where replay is possible, and the expected aggregate version where concurrent mutation is possible. Repositories must not expose generic status setters.

Eligibility and transition prerequisites belong to Core policy and guarded command writes, not permanent schema triggers. In particular, Scheduled-only manual eligibility, manual transition rules, and packed-handover/completion requirements must be enforced and tested in the delivery commands before exposure. Storage retains valid state vocabulary, assignment identity, timestamp consistency, immutable history and protections against overlapping or unresolved attempts; accepting a row directly in SQL is not permission to execute that business operation.

External provider events are not client commands and never supply or invent an `expectedVersion`. Ingestion requires unique `(provider, providerEventId)` identity and a durable inbox. The handler loads current aggregate state, applies legal-transition and compare-and-swap protection, and safely retries or reconciles if another command changed the aggregate concurrently.

A provider-confirmed canonical Payments outcome sufficient under the configured commitment policy is the customer commitment boundary for paid Orders and paid additions. For the current release, provider captured/success states map to canonical Payments `SUCCEEDED`. For `SCHEDULED`, delivery-cycle cutoff is the later operational/procurement commitment boundary. `INSTANT` has no fabricated cycle transition; its operational boundary is expressed by the snapshotted promise, expiring checkout inventory hold, committed reservation, and Fulfillment transitions. These events are deliberately separate. Global `OPEN|PAUSED` selling state is a separate versioned lifecycle: `PAUSED` blocks new options, Quotes, and payment initiation but does not prevent reconciliation or exactly-once commitment of an already-started payment.

## Global Commerce Configuration

```text
OPEN -> PAUSED -> OPEN
          |
          +-> change INSTANT|SCHEDULED mode while remaining PAUSED
```

`PauseSelling`, `ActivateGlobalFulfillmentMode`, and `OpenSelling` are audited, idempotent, expected-version commands. Mode change while `OPEN` is illegal. Reopening fails closed until mode-specific readiness is proven. None of these transitions mutates committed Order evidence.

## Retired Subscription

Subscription, trial and recurring-billing lifecycles are not active release workflows. Neither commerce mode depends on them. Historical data does not authorize new membership commands/jobs.

## Delivery Cycle

DeliveryCycle exists only for `SCHEDULED`; `WEEKLY` is a configured cadence. Global mode switching is an explicit versioned configuration command, not a DeliveryCycle state transition. Operators pause selling, preserve and review committed work, activate the new mode, verify readiness, and reopen. Completion of every historical Order is not a prerequisite. The switch invalidates uncommitted commerce and never advances or rewrites existing Orders.

```text
DRAFT -> SCHEDULED -> OPEN -> CUTOFF_REACHED
      -> PROCUREMENT -> RECEIVING -> PACKING
      -> DISPATCHING -> DELIVERING -> CLOSED

DRAFT / SCHEDULED / OPEN -> CANCELED
later cancellation -> explicit exceptional operations command
```

Commands include `ScheduleCycle`, `OpenCycle`, `ReachCycleCutoff`, `BeginProcurement`, `BeginReceiving`, `BeginPacking`, `BeginDispatch`, `BeginDelivery`, `CloseCycle`, and `CancelCycle`.

Rules:

- New customer Orders/amendments and their payment initiation enter only while the cycle is `OPEN` and current time is before cutoff. Already-started payments may commit after cutoff; addition commitment requires its recorded payment start before the Order's immutable cutoff, the original Order still eligible and no conflicting refund. Purchasing waits until these original/addition outcomes are accounted for. A cycle has no order, customer, zone, seat, or other capacity.
- Reaching cutoff prevents normal procurement-affecting customer modifications.
- Time-based advancement is still an explicit idempotent command invoked by a request or scheduled trigger.
- Draft save and `DRAFT -> SCHEDULED` require Global fulfillment authority, the reviewed version, complete ordered timing and eligible destination participation. Every required relation, audit and original command receipt shares the guarded transaction. Published schedules are not editable through draft save. `SCHEDULED -> OPEN` occurs no earlier than `order_opens_at`; `OPEN -> CUTOFF_REACHED` occurs at cutoff, each with stable transition identity and atomic audit/receipt. After scheduler downtime, opening followed by cutoff remains safe because checkout independently enforces the opening/cutoff interval.
- Cancelling a cycle with commitments requires an operational compensation plan; a raw transition is forbidden.
- Unpaid `DRAFT / SCHEDULED / OPEN -> CANCELED` requires Global fulfillment authority, a reason and current version. Orders, Payments other than definitive failure/cancellation, or retained checkout holds block it. The command atomically invalidates unstarted Quotes/attempts and persists audit/original receipt; deactivated destinations do not block recovery. A concurrent payment initiation must either win and block cancellation, or lose against the canceled cycle and invalidated Quote.
- No `INSTANT` Order is assigned a synthetic cycle merely to reuse these transitions.

## Order

```text
PENDING_PAYMENT -> COMMITTED -> FULFILLMENT_PENDING
                 -> FULFILLMENT_READY -> OUT_FOR_DELIVERY
                 -> DELIVERED

PENDING_PAYMENT -> EXPIRED / CANCELED
COMMITTED or later -> CANCELLATION_REQUESTED -> CANCELED
COMMITTED or later -> EXCEPTION
EXCEPTION -> prior valid flow / CANCELED
```

`PENDING_PAYMENT` may be represented as a checkout attempt rather than a durable Order if the implementation can preserve payment recovery and idempotency. A durable Order is never considered commercially committed until Payments records a provider-confirmed canonical outcome sufficient under the configured commitment policy and the explicit idempotent order-commitment command completes.

Commands include `CommitOrderAfterPayment`, `RequestOrderCancellation`, `ApproveOrderCancellation`, `MarkFulfillmentPending`, `MarkFulfillmentReady`, `MarkOutForDelivery`, `MarkOrderDelivered`, and `RecordOrderException`.

Rules:

- Committed order items and snapshots are immutable.
- Commitment snapshots the resolved fulfillment mode, location, service area/zone, delivery promise/window/ETA, and `SCHEDULED` cycle identifiers only when applicable.
- `INSTANT` commitment converts the checkout attempt's valid stock hold into a committed reservation atomically; an expired/missing hold cannot be ignored after payment and instead enters visible retry/reconciliation policy.
- `SCHEDULED` commitment atomically records each paid line's exact sold units, base-unit purchase demand, and shipping grams without reading, reserving, decrementing, or netting physical inventory and without allocating capacity.
- Additions create an `OrderAmendment`; removal/repricing is not normal mutation.
- Cancellation is policy-driven by fulfillment mode, Scheduled cutoff/procurement where applicable, fulfillment/dispatch progress, hold/reservation/demand, and refund state.
- Delivery/fulfillment projections may advance order state only through application orchestration after their own transition succeeds.

## Order Amendment

```text
DRAFT -> PENDING_PAYMENT -> COMMITTED
DRAFT / PENDING_PAYMENT -> CANCELED / EXPIRED
COMMITTED -> REFUND_PENDING / REFUNDED (exceptional resolution)
```

An amendment is additive-only and has its own payment and item snapshots. `SCHEDULED` normally requires the original cycle to remain open and before cutoff. The normal customer deadline for `INSTANT` amendments is not yet approved, so Instant amendment creation fails closed until that policy is defined. Commitment creates the applicable incremental Instant hold/reservation or Scheduled exact-demand effects without modifying original order lines.

## Payment Attempt

```text
INITIATED -> REQUIRES_ACTION -> PROCESSING -> SUCCEEDED
INITIATED / REQUIRES_ACTION / PROCESSING -> FAILED
INITIATED / REQUIRES_ACTION -> EXPIRED
SUCCEEDED -> PARTIALLY_REFUNDED -> REFUNDED
SUCCEEDED -> REFUNDED
```

Provider states map into stable application states behind the payment adapter. `SUCCEEDED` means funds reached the configured payment-commitment boundary (captured for the current release), not merely that a browser returned successfully or that payment was initiated. Orders react through explicit idempotent application commands.

Commands/events include `InitiatePayment`, `RecordActionRequired`, `ProcessPaymentWebhook`, `ReconcilePayment`, and `MarkPaymentExpired`.

Rules:

- Provider events are durably unique by `(provider, providerEventId)`; application checkout/payment commands have their own stable idempotency keys.
- Duplicate webhooks return the previously recorded inbox outcome. Provider events do not carry `expectedVersion`; the handler uses current-state validation, conditional aggregate updates, and safe retry/reconciliation on concurrent change.
- An exhausted verified financial inbox event may enter `RETRY_REQUIRED` only through a reviewed, versioned Global recovery command. The new bounded window preserves original receipt evidence and audits prior attempts; replay uses the existing verified application path. This transition does not override Payment/Refund state or close its financial case.
- An exhausted commerce Payment reaction may move `ESCALATED -> PENDING` through reviewed Global recovery only while its original Payment remains captured and refund exposure is absent. The same owning Order/amendment command determines commitment; `SUCCEEDED` remains evidence of actual application. Reaction escalation, its case and audit are atomic. Retry does not clear the case or authorize retired membership work.
- A commerce reaction that never committed may instead complete `ESCALATED -> FAILED` after reviewed canonical full refund. Retained `FAILED` reactions may finish the same cleanup without becoming successful. The explicit `REFUNDED_WITHOUT_COMMITMENT` outcome coordinates unused checkout entitlements, failed uncommitted additions and financial case closure atomically. It never independently cancels a committed paid addition or Order.
- If canonical Payments reaches `SUCCEEDED` but commitment initially fails or the response is lost, recovery must either commit the same order exactly once or create a visible refund/finance exception. Money must never become an invisible orphan.
- Successful Order commitment resolves its matching Orders finance exceptions atomically with per-exception audit evidence. Retained stale exceptions may be repaired by the owning commitment replay or the versioned Global financial-case resolution command, only from the exact committed Order/payment/reaction link. Financial-case review remains explicit; repairing the Orders projection does not itself close a Payments reconciliation case.
- A payment state is never inferred solely from client state.
- Provider lookup and signed-event application validate provider/reference, amount, currency and the current Payment subject. The Payment compare-and-swap, observed attempt, required downstream reaction, continuation consumption and settlement evidence share a guarded transaction. A zero-row claim or ignored dependent write aborts that transition. Replaying a consistent captured state repairs a missing historical reaction without incrementing its Payment version.

- Identical payment-command replay is resolved before quote state/expiry validation and returns the original unexpired continuation. New payment readiness recalculates without persisting or superseding the accepted Quote; the Payment subject remains that accepted Quote ID.
- Provider redirect/SDK actions are durable while `ACTIVE`, become `CONSUMED` on a terminal provider observation, and become `EXPIRED` at their exact expiry through both access-time checks and the every-minute scheduler sweep. Missing/expired continuation data never produces `REQUIRES_ACTION` with null action data.
- A thrown provider call is ambiguous, not a legal transition to `FAILED`; Core preserves the processing claim and opens reconciliation. Provider-declared rejection may transition to `FAILED`.

## Refund

Provider lookup and verified event ingress apply the same guarded financial status persistence. Read-only lookup never interprets absence as rejection and never retries a provider submission. A provider-confirmed terminal observation may precede completion of dependent Order projections; a durable bounded recovery lease preserves that unfinished work without downgrading the financial state. Operator recheck is a versioned, audited queue action against the same Refund identity, not a new Refund or a financial status override.


```text
REQUESTED -> PROCESSING -> SUCCEEDED
REQUESTED / PROCESSING -> FAILED -> PROCESSING / ESCALATED
SUCCEEDED may represent partial or full amount
```

Normal eligible customer cancellation automatically initiates PayMongo refunds. Post-delivery exception refunds are reviewed and confirmed by authorized staff in the FreshMarkets dashboard; Core executes them through PayMongo and verifies/synchronizes provider evidence. An accepted request means processing, never immediate bank credit or fabricated success. Use one or more refund records so each provider operation has a stable identity. Aggregate payment/order projections derive `PARTIALLY_REFUNDED` or `REFUNDED` from successful refund amounts. Retrying a failed provider request preserves the same application idempotency identity where the provider permits it.

A verified Refund observation must resolve one Refund under the owning provider and match its exact amount/currency. Ambiguous legacy provider/reference mappings remain visible for reconciliation. `SUCCEEDED` is absorbing financial evidence: a delayed pending observation cannot downgrade it, and a conflicting failed observation opens reconciliation. Successful Refund mutation, settlement evidence and the derived Payment refunded-total state share one transaction. Duplicate successful observations repair retained incomplete projections without repeatedly incrementing the Payment version; the provider inbox is applied only after the Order cancellation projection also succeeds.

The refundable captured amount is claimed with one guarded insert. Outstanding `REQUESTED`, `APPROVED`, `PROCESSING`, and `ESCALATED` amounts remain reserved alongside `SUCCEEDED`; definitive `FAILED` releases its reservation. Concurrent claims cannot collectively exceed the captured amount.

## Procurement

```text
OPEN -> AGGREGATED -> REQUIREMENT_APPROVED -> ORDERED
     -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED

AGGREGATED / APPROVED / ORDERED / PARTIALLY_RECEIVED -> EXCEPTION
EXCEPTION -> REQUIREMENT_APPROVED / ORDERED / PARTIALLY_RECEIVED / CLOSED
```

Commands include `AggregateCommittedDemand`, `ApproveProcurementRequirement`, `PlacePurchaseOrder`, `RecordProcurementException`, and `CloseProcurementRun`.

The approved ordinary purchase-confirmation command coordinates exact-demand aggregation and `AGGREGATED -> ORDERED` for one selling option. It requires the reviewed paid quantities and current requirement version, records the manual supplier purchase in `purchase_order`, and creates or updates its not-started receiving record in the same guarded batch. It does not require a separate approval screen or contact the supplier. Existing aggregate-only callers retain their behavior. Rejected/stale confirmation leaves no requirement, receipt, purchase, audit-success or idempotency-success effect. Purchased quantities are not silently recalculated; later supply changes require the separate exception path.

Rules:

- Aggregation occurs at/after operational cutoff and copies exact paid Scheduled demand. It uses no usable inventory, incoming stock, safety buffer, forecasting, or capacity.
- Cancelling an order after procurement starts does not silently subtract purchased supply; an explicit resolution determines inventory/refund effects.
- Requirement recalculation is versioned/audited and cannot erase prior approvals/orders.

## Receiving

```text
NOT_STARTED -> IN_PROGRESS -> COMPLETED
IN_PROGRESS -> DISCREPANCY -> IN_PROGRESS / COMPLETED
IN_PROGRESS / DISCREPANCY -> CANCELED (authorized exceptional case)
```

Commands include `StartReceiving`, `RecordReceivedLine`, `RecordQualityRejection`, `RecordReceivingShortage`, `ResolveReceivingDiscrepancy`, and `CompleteReceiving`.

Each receipt records expected, accepted, and rejected base-unit quantities. Accepted Scheduled quantities create cycle/location allocation movements; rejected quantities do not become usable goods. Inspected surplus release is a separate atomic allocation-to-physical-stock command. Completion requires every expected line to be received or explicitly resolved.

## Fulfillment

```text
NOT_STARTED -> PICKING -> READY_TO_PACK -> PACKING -> PACKED
            -> HANDED_OFF -> COMPLETED

PICKING / READY_TO_PACK / PACKING -> SHORTED
SHORTED -> PICKING / READY_TO_PACK / CANCELED / ESCALATED
```

Commands include `StartPicking`, `RecordPickedQuantity`, `RecordFulfillmentShortage`, `ResolveFulfillmentException`, `StartPacking`, `MarkPacked`, `HandOffToDelivery`, and `CompleteFulfillment`.

Instant packed quantities consume reservations/stock through explicit ledger movements. Scheduled packing consumes cycle/location allocation exactly once and never deducts the location inventory balance. For Instant, the staff acceptance/start-picking command requires successful payment evidence and atomically moves the Order from `COMMITTED` to `FULFILLMENT_PENDING`, closing customer cancellation. Scheduled customer cancellation closes strictly at the snapshotted cutoff; earlier preparation never shortens that window. `PACKED` does not imply dispatched or delivered.

The lifecycle is shared by `INSTANT` and `SCHEDULED`; mode-specific differences live in Fulfillment policies that construct tasks, deadlines, queues, and allowed actions. Repeated mode conditionals must not be scattered across unrelated state machines.

## Historical Internal Delivery Lifecycles

Delivery Batch, Delivery Stop sequencing, Rider assignment, internal route preview, and Rider task transitions are retired. Their persisted states/events remain readable only to preserve historical deliveries and migration/audit evidence. No active command, contract, navigation item, readiness check, or customer-delivery workflow may advance them.

## External Delivery Provider Dispatch

Lalamove prices and normally executes both modes. Customers may choose an available verified courier. Instant automatically starts booking when all items are picked/checked and final packing starts; the durable intent and one-attempt safeguards still apply. Scheduled future booking requires received/checked goods and a credible ready time. Normal handover requires `PACKED`; conflicting provider pickup evidence is retained and escalated.

One active/uncertain execution attempt is allowed per job. Scheduled manual fallback requires definite prior-attempt closure and reason/name/phone. Instant manual delivery is rejected in Core. Searching is distinct from rider assignment; refresh, webhook and inbox recovery share one normalized applying path. Provider cancellation never cancels a grocery Order.

```text
PENDING -> CREATING -> ACTIVE -> COMPLETED
                    -> FAILED
                    -> OUTCOME_UNKNOWN -> RECONCILIATION_REQUIRED
PENDING / RETRY_REQUIRED -> CREATING
ACTIVE -> CANCELED / RETURNED / FAILED
ACTIVE -> OUTCOME_UNKNOWN (cancellation submitted) -> CANCELED (confirmed)
```

`RETRY_REQUIRED` is allowed only when Core knows the create request did not reach the provider,
such as failure to acquire an access token. A network interruption, retryable provider response,
or local persistence failure after create may mean the courier accepted the booking; those paths
enter `OUTCOME_UNKNOWN`/`RECONCILIATION_REQUIRED` and cannot issue another create automatically.
An exact application replay returns the existing dispatch. A changed request for the same
DeliveryJob is `IDEMPOTENCY_CONFLICT`.

Admin provider commands retain `SUBMITTING -> OUTCOME_UNKNOWN|OBSERVED|REJECTED` and `OBSERVED -> SUCCEEDED` evidence. A confirmed cancellation completes the originating command even if delivered through webhook, refresh or inbox recovery. A nonterminal refresh does not clear a pending cancellation's uncertainty. Definitive rejection permits a fresh authorized command after current-version revalidation; a timeout does not. Confirmed incompatible terminal evidence rejects the cancellation intent rather than fabricating cancellation success.

Provider-neutral observations such as `ALLOCATING`, `PENDING_PICKUP`, `PICKING_UP`,
`PENDING_DROP_OFF`, `IN_DELIVERY`, `IN_RETURN`, `COMPLETED`, `CANCELED`, `RETURNED`, and `FAILED`
are retained as provider status. Lalamove `ASSIGNING_DRIVER`, `ON_GOING`, `PICKED_UP`,
`COMPLETED`, `CANCELED`, `REJECTED`, and `EXPIRED` are translated at the adapter/ingress boundary.
Mapping any observation into the canonical Delivery Job/Stop state machine requires an
explicit Delivery application command and legal transition; the adapter does not fabricate
`ARRIVED` or any other missing FreshMarkets event.

## Cancellation Effects by Stage

| Stage                                                                | Normal authority                   | Inventory/demand effect                                                                   | Financial effect                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before payment                                                       | Customer/system                    | None                                                                                      | None                                                                                                                                                                |
| Paid before Scheduled cutoff or before Instant `FULFILLMENT_PENDING` | Customer request under mode policy | Release Instant reservation or close Scheduled exact demand once cancellation is accepted | Refund the coordinated paid set; retain only an actual documented non-refundable courier charge when the approved customer-caused stage policy permits it |
| After cutoff before procurement                                      | Operations                         | Explicit demand adjustment                                                                | Full/partial refund by policy                                                                                                                                       |
| Procurement started                                                  | Operations                         | Preserve supplier commitment; route resulting supply to inventory/resolution              | Partial/full refund or credit by approved policy                                                                                                                    |
| After receiving                                                      | Operations/support                 | Inventory remains auditable; reverse allocation if usable                                 | Affected-line or policy refund                                                                                                                                      |
| After packing                                                        | Operations/support                 | Packed goods require explicit disposition                                                 | Policy refund/credit                                                                                                                                                |
| After dispatch                                                       | Delivery/support                   | Failed-delivery resolution                                                                | Retry/reschedule/refund/credit                                                                                                                                      |
| Delivered                                                            | Support/finance                    | No cancellation                                                                           | Separate return/refund adjustment                                                                                                                                   |

Paid cancellation has its own aggregate lifecycle: `REQUESTED -> REFUNDS_PROCESSING -> COMPLETED`, with `EXCEPTION` for any failed, escalated, or unresolved member. Each original payment and committed paid addition is validated, including previously fully refunded payments. A refund member is persisted only for its remaining refundable balance after canonical successful Refunds. Zero remaining balance completes in the cancellation admission transaction; retained accepted zero-refund intents have a guarded recovery path. Partial success never marks the Order canceled; canonical verified success for every member is required. Operational reservations/demand close once when a valid cancellation is accepted, independently of retryable financial completion. FreshMarkets-caused cancellation may proceed after the customer lock and refunds the full remaining paid amount. A delivered Order is never reopened by normal cancellation; a global-scope staff actor with `refunds.manage` may issue a separately audited exception refund with a required reason.

The cancellation command returns its immutable acceptance receipt. Current aggregate progress is a separate query; replay cannot change the accepted operation's response. Saved refund members are durable submission intents with bounded, conditionally claimed retries. Existing Refund identities are reconciled without another submission, including a surviving `REQUESTED` identity whose external outcome may be unknown. Canonical Refund observations own member success and terminal completion; neither a late submission response nor notification failure may reverse that evidence.

## Transition Test Expectations

For every state machine, test all allowed transitions, representative illegal transitions, authorization/scope failures, duplicate commands, stale versions for versioned lifecycle commands, and cross-domain effects. Provider-event tests instead cover duplicate `(provider, providerEventId)`, out-of-order delivery, handler compare-and-swap conflict, retry, and reconciliation. Time-boundary tests must cover exactly-at-cutoff behavior using an injected clock.

## Customer Follow-up Supporting Lifecycles

```text
OrderIssue: SUBMITTED -> CLAIMED -> INVESTIGATING -> RESOLVED
                   \-----------------------------> ESCALATED

Notification: PENDING -> QUEUED -> PROCESSING -> SENT
                   ^          ^          \-> PENDING (retry/redrive)
                   \----------\------------- expired lease/publication recovery
                                         \-> DEAD_LETTERED (bounded exhaustion)

InvoiceReadiness: PENDING_TAX_CONFIGURATION -> READY_FOR_ISSUANCE -> ISSUED
```

Notification publication and sending are separate persisted facts. A send lease and its required attempt record commit before contacting the provider. Definite pre-send rejection may return to PENDING with bounded backoff, at most five sends. An unknown send outcome stops automatic delivery with `FAILED` / `SEND_OUTCOME_UNKNOWN`; it is not proof that the recipient was not contacted. Expired in-flight attempts, including the fifth attempt, cannot produce a replacement send. A late known result may complete that same attempt atomically. `SENT` records provider acceptance, not verified inbox delivery.

Issue submission is customer-owned, typed, idempotent, and version-safe; handling by administrators is a separate capability-based authority and does not imply a financial action. Customer projection collapses `CLAIMED` and `INVESTIGATING` to `IN_REVIEW` while preserving `SUBMITTED`, `RESOLVED`, and `ESCALATED`. Notification Queue retries never replay the source transition; each message is handled independently with conditional D1 leasing, idempotent send evidence, explicit acknowledgement/retry, bounded backoff, and dead-letter visibility. Invoice readiness advances only when the required approved accounting evidence exists; `ISSUED` additionally requires an immutable identifier, issue instant, seller snapshot, and tax breakdown.

The approved administrator Problems list presents New / Being handled / Resolved with contact details and a short resolution note. Reconcile the internal issue vocabulary above with those ordinary actions without treating Resolved as refund or delivery success; retained escalation evidence remains truthful. The weekly view and receiving form similarly organize independently owned cycle, purchasing, receiving and fulfillment states rather than merging their authority.

The existing `OrderAmendment` lifecycle applies only to additive paid additions. A customer may draft one active amendment for a committed Scheduled Order before cutoff. Its dedicated `ORDER_AMENDMENT` Payment must reach canonical `SUCCEEDED` before the amendment commits. Failed/expired payment fails the amendment; duplicate provider reactions replay safely.

## Warehouse Transfer

`DRAFT -> IN_TRANSIT -> PARTIALLY_RECEIVED -> RECEIVED`; a full first receipt may move directly from `IN_TRANSIT` to `RECEIVED`. `DRAFT -> CANCELED` has no stock effects. Dispatch deducts available source stock and creates transit atomically. Checked receipt credits only newly accepted destination quantities and records the remaining observed damaged/missing quantities. These observations classify outstanding transit and never deduct it or create sellable stock. Rechecking recovered goods may reduce reported damage/shortage and accept them in the same versioned receipt; preserve immutable checking history.

Global resolution records a positive quantity from unclassified, damaged or missing outstanding goods as either a documented loss or a verified physical return. A return credits warehouse sellable stock only after explicit confirmation that the goods were physically received there and inspected as sellable. Damaged/uninspected goods are not eligible for that credit. The selected outstanding category, cumulative loss/return, optional source stock credit, immutable resolution/ledger/audit and command result change atomically. Resolution cannot consume accepted goods or another disposition. No deletion reverses dispatch.

A dispatched transfer stays `IN_TRANSIT` while none has been accepted, or `PARTIALLY_RECEIVED` while acceptance is partial and outstanding goods remain. Once every line is fully accounted, the terminal state is `RECEIVED` only when all dispatched goods were accepted at the destination; otherwise it is `RESOLVED` (one or more losses/returns). Both terminal states have zero outstanding transit and no further receipt/resolution action. Reporting/checking may retain the current active state while advancing the aggregate version.

### Actual size counting

Counting is an atomic inventory movement, not a new lifecycle. An authorized count consumes measured bulk grams and credits staff-recorded pieces/packs for the same Product/location. It rechecks the bulk version, unreserved/unheld quantity, active size identities and every balance/ledger/evidence/audit/success effect. Linked transfer receiving and counting share that transaction; a rejected count leaves the receipt unchanged. Replays return the original result. Approximate shipping grams never determine counts. Scheduled allocation receiving remains separate from physical Instant stock.

### Scheduled replacement receiving

Accepted coordinated Order cancellation may resolve tracked supplier discrepancies with `ORDER_CANCELLATION:<cancellationId>` (CA-5.8). The original receipt must be fully accounted, retain no legacy physical-stock credit, and belong to exact paid purchasing. Only received cycle/destination/pool goods may cover remaining unpacked OPEN demand; packed, disposed and released surplus is unavailable. Resolution/version and immutable per-exception audit evidence share the cancellation's guarded demand-release transaction. Original receipt quantities and purchase snapshots remain unchanged; resolved supply does not mean refunds succeeded. The receiving view presents the resolution without another operator action, while unresolved remaining demand keeps the discrepancy open. Tracked discrepancies resolved by replacement or cancellation leave the outstanding operational list; retained untracked discrepancies remain visible.

A receipt with reported rejected/missing quantities stays `DISCREPANCY` until inspection is closed or the outstanding goods are replaced. Closing inspection does not resolve an OPEN supply exception or create accepted goods. `REPLACE` is available only for a fully accounted original receipt with outstanding quantity and tracked OPEN discrepancy evidence; retained physical-stock receipts require separate evidence review. Partial inspected replacement stays `DISCREPANCY`; when accepted reaches the original expected quantity, the receipt is `COMPLETED` and its tracked exceptions become `RESOLVED / REPLACEMENT_RECEIVED`. Original rejection/missing counts remain visible. Packing still requires sufficient accepted cycle goods; receipt completion never proves fulfillment or financial resolution.

A weighed Scheduled size receipt coordinates the same receiving transitions across one Product's included sizes. A purchased `ORDERED / NOT_STARTED` size can enter its observed received/discrepancy state directly within that one audited receiving command; no uncommitted intermediate Start operation is exposed. All size transitions and the measured-weight evidence commit or reject together. Weighed replacement retains its existing discrepancy eligibility. This adds no independent stock lifecycle, sourcing mode or physical-stock netting.

Inspected surplus release is an audited allocation movement, not a new cycle or receipt lifecycle. It leaves receipt observations and packed quantities unchanged, increments the cycle-goods version and credits the same physical pool exactly once. Paid demand remains protected until its owning cancellation releases it or immutable packing consumes it. A refund alone, missing fulfillment record, closed inspection or expired checkout screen does not prove goods are unused. Already packed canceled goods require a separate inspected return/un-packing operation; surplus release never silently returns them.
