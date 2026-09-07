# FreshMarkets State Machines

The owner-authorized 2026-09-07 commerce alignment is the active target. Both modes are pay-as-you-go without membership; Lalamove prices both modes; Scheduled alone permits emergency manual delivery; Global owns exact-location price writes. See [Phase 0 design decisions](COMMERCE_ALIGNMENT_DECISIONS.md) for ownership, capabilities, profiles/closure, warehouse transit, cycle goods, execution attempts, publication and the retained-baseline strategy. Implementation and migration descriptions below are evidence of the previous baseline where explicitly labeled historical, not acceptance of the target.

Engineering enforcement follows [CODING_STANDARDS.md](CODING_STANDARDS.md#commands-state-and-authorization) and [TESTING.md](TESTING.md). Test reachable command paths, rejected-command atomicity, duplicate/reordered events, and cross-context effects; a transition table alone is not proof that implementation obeys it.

## Enforcement Rules

States are changed only through named application commands. Client, application, and admin lifecycle commands check current state, actor capability/scope, business preconditions, a stable idempotency key where replay is possible, and the expected aggregate version where concurrent mutation is possible. Repositories must not expose generic status setters.

External provider events are not client commands and never supply or invent an `expectedVersion`. Ingestion requires unique `(provider, providerEventId)` identity and a durable inbox. The handler loads current aggregate state, applies legal-transition and compare-and-swap protection, and safely retries or reconciles if another command changed the aggregate concurrently.

A provider-confirmed canonical Payments outcome sufficient under the configured commitment policy is the customer commitment boundary for paid membership and paid orders. For the current release, provider captured/success states map to canonical Payments `SUCCEEDED`. For `SCHEDULED`, delivery-cycle cutoff is the later operational/procurement commitment boundary. `INSTANT` has no fabricated cycle transition; its operational boundary is expressed by the snapshotted promise, expiring checkout inventory hold, committed reservation, and Fulfillment transitions. These events are deliberately separate. Global `OPEN|PAUSED` selling state is a separate versioned lifecycle: `PAUSED` blocks new options, Quotes, and payment initiation but does not prevent reconciliation or exactly-once commitment of an already-started payment.

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

DeliveryCycle exists only for `SCHEDULED`; `WEEKLY` is a configured cadence. Global mode switching is an explicit versioned configuration command, not a DeliveryCycle state transition. Operators first pause selling, resolve committed work, activate the new mode, verify location readiness, and reopen. The switch invalidates uncommitted commerce and never advances or rewrites existing Orders.

```text
DRAFT -> SCHEDULED -> OPEN -> CUTOFF_REACHED
      -> PROCUREMENT -> RECEIVING -> PACKING
      -> DISPATCHING -> DELIVERING -> CLOSED

DRAFT / SCHEDULED / OPEN -> CANCELED
later cancellation -> explicit exceptional operations command
```

Commands include `ScheduleCycle`, `OpenCycle`, `ReachCycleCutoff`, `BeginProcurement`, `BeginReceiving`, `BeginPacking`, `BeginDispatch`, `BeginDelivery`, `CloseCycle`, and `CancelCycle`.

Rules:

- Customer Orders/amendments enter only while the cycle is `OPEN` and current time is before cutoff. A cycle has no order, customer, zone, seat, or other capacity.
- Reaching cutoff prevents normal procurement-affecting customer modifications.
- Time-based advancement is still an explicit idempotent command invoked by a request or scheduled trigger.
- Cancelling a cycle with commitments requires an operational compensation plan; a raw transition is forbidden.
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
- If canonical Payments reaches `SUCCEEDED` but commitment initially fails or the response is lost, recovery must either commit the same order exactly once or create a visible refund/finance exception. Money must never become an invisible orphan.
- A payment state is never inferred solely from client state.
- Identical payment-command replay is resolved before quote state/expiry validation and returns the original unexpired continuation. New payment readiness recalculates without persisting or superseding the accepted Quote; the Payment subject remains that accepted Quote ID.
- Provider redirect/SDK actions are durable while `ACTIVE`, become `CONSUMED` on a terminal provider observation, and become `EXPIRED` at their exact expiry through both access-time checks and the every-minute scheduler sweep. Missing/expired continuation data never produces `REQUIRES_ACTION` with null action data.
- A thrown provider call is ambiguous, not a legal transition to `FAILED`; Core preserves the processing claim and opens reconciliation. Provider-declared rejection may transition to `FAILED`.

## Refund

```text
REQUESTED -> PROCESSING -> SUCCEEDED
REQUESTED / PROCESSING -> FAILED -> PROCESSING / ESCALATED
SUCCEEDED may represent partial or full amount
```

Use one or more refund records so each provider operation has a stable identity. Aggregate payment/order projections derive `PARTIALLY_REFUNDED` or `REFUNDED` from successful refund amounts. Retrying a failed provider request preserves the same application idempotency identity where the provider permits it.

The refundable captured amount is claimed with one guarded insert. Outstanding `REQUESTED`, `PROCESSING`, and `ESCALATED` amounts remain reserved alongside `SUCCEEDED`; definitive `FAILED` releases its reservation. Concurrent claims cannot collectively exceed the captured amount.

## Procurement

```text
OPEN -> AGGREGATED -> REQUIREMENT_APPROVED -> ORDERED
     -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED

AGGREGATED / APPROVED / ORDERED / PARTIALLY_RECEIVED -> EXCEPTION
EXCEPTION -> REQUIREMENT_APPROVED / ORDERED / PARTIALLY_RECEIVED / CLOSED
```

Commands include `AggregateCommittedDemand`, `ApproveProcurementRequirement`, `PlacePurchaseOrder`, `RecordProcurementException`, and `CloseProcurementRun`.

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

Instant packed quantities consume reservations/stock through explicit ledger movements. Scheduled packing consumes cycle/location allocation exactly once and never deducts the location inventory balance. Preparation start also locks customer Order cancellation atomically. `PACKED` does not imply dispatched or delivered.

The lifecycle is shared by `INSTANT` and `SCHEDULED`; mode-specific differences live in Fulfillment policies that construct tasks, deadlines, queues, and allowed actions. Repeated mode conditionals must not be scattered across unrelated state machines.

## Historical Internal Delivery Lifecycles

Delivery Batch, Delivery Stop sequencing, Rider assignment, internal route preview, and Rider task transitions are retired. Their persisted states/events remain readable only to preserve historical deliveries and migration/audit evidence. No active command, contract, navigation item, readiness check, or customer-delivery workflow may advance them.

## External Delivery Provider Dispatch

Lalamove prices and normally executes both modes. Customers select no courier. Instant booking is legal after all items are picked/checked and final packing starts. Scheduled future booking requires received/checked goods and a credible ready time. Normal handover requires `PACKED`; conflicting provider pickup evidence is retained and escalated.

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

Paid cancellation has its own aggregate lifecycle: `REQUESTED -> REFUNDS_PROCESSING -> COMPLETED`, with `EXCEPTION` for any failed, escalated, or unresolved member. One refund member is persisted for the original payment and each committed paid addition. Partial success never marks the Order canceled; canonical verified success for every member is required. Operational reservations/demand close once when a valid cancellation is accepted, independently of retryable financial completion. FreshMarkets-caused cancellation may proceed after the customer lock and refunds the full remaining paid amount. A delivered Order is never reopened by normal cancellation; a global-scope staff actor with `refunds.manage` may issue a separately audited exception refund with a required reason.

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

Issue submission is customer-owned, typed, idempotent, and version-safe; staff handling is a separate Admin authority and does not imply a financial action. Customer projection collapses `CLAIMED` and `INVESTIGATING` to `IN_REVIEW` while preserving `SUBMITTED`, `RESOLVED`, and `ESCALATED`. Notification Queue retries never replay the source transition; each message is handled independently with conditional D1 leasing, idempotent send evidence, explicit acknowledgement/retry, bounded backoff, and dead-letter visibility. Invoice readiness advances only when the required approved accounting evidence exists; `ISSUED` additionally requires an immutable identifier, issue instant, seller snapshot, and tax breakdown.

The existing `OrderAmendment` lifecycle applies only to additive paid additions. A customer may draft one active amendment for a committed Scheduled Order before cutoff. Its dedicated `ORDER_AMENDMENT` Payment must reach canonical `SUCCEEDED` before the amendment commits. Failed/expired payment fails the amendment; duplicate provider reactions replay safely.

## Warehouse Transfer

`DRAFT -> IN_TRANSIT -> PARTIALLY_RECEIVED -> RECEIVED`; a full first receipt may move directly from `IN_TRANSIT` to `RECEIVED`. `DRAFT -> CANCELED` has no stock effects. Dispatched shortages/damage require explicit discrepancy resolution; no deletion reverses dispatch. Dispatch deducts available source stock and creates transit atomically. Receipt credits accepted destination quantities exactly once. Resolution separately records losses or verified returns, then closes all transit.
