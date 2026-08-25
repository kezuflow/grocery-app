# FreshMarkets State Machines

## Enforcement Rules

States are changed only through named application commands. Every command checks the current state, actor capability/scope, business preconditions, expected version, and idempotency key where replay is possible. Repositories must not expose generic status setters.

Payment success is the customer commitment boundary. Delivery-cycle cutoff is the later operational/procurement commitment boundary. These events are deliberately separate.

## Subscription

```text
TRIALING -> ACTIVE
TRIALING -> CANCELLED -> EXPIRED
TRIALING -> EXPIRED

ACTIVE -> PAST_DUE -> ACTIVE
ACTIVE -> PAUSED -> ACTIVE
ACTIVE -> CANCELLED -> EXPIRED

PAST_DUE -> PAUSED / CANCELLED / EXPIRED
PAUSED -> CANCELLED / EXPIRED
```

Commands include `StartTrial`, `ActivateSubscription`, `RecordMembershipPaymentFailure`, `RecoverSubscription`, `PauseSubscription`, `ResumeSubscription`, `CancelSubscription`, and `ExpireSubscription`.

Only `TRIALING` and `ACTIVE` are checkout-eligible. Eligibility also considers effective dates, not just a stored enum. Trial waives only membership fees. Cancellation may be immediate or end-of-period according to the configured policy and must store requested/effective timestamps.

## Delivery Cycle

```text
DRAFT -> SCHEDULED -> OPEN -> CUTOFF_REACHED
      -> PROCUREMENT -> RECEIVING -> PACKING
      -> DISPATCHING -> DELIVERING -> CLOSED

DRAFT / SCHEDULED / OPEN -> CANCELLED
later cancellation -> explicit exceptional operations command
```

Commands include `ScheduleCycle`, `OpenCycle`, `ReachCycleCutoff`, `BeginProcurement`, `BeginReceiving`, `BeginPacking`, `BeginDispatch`, `BeginDelivery`, `CloseCycle`, and `CancelCycle`.

Rules:

- Customer orders/amendments enter only while the cycle is `OPEN`, current time is before cutoff, and capacity can be atomically allocated.
- Reaching cutoff prevents normal procurement-affecting customer modifications.
- Time-based advancement is still an explicit idempotent command invoked by a request or scheduled trigger.
- Cancelling a cycle with commitments requires an operational compensation plan; a raw transition is forbidden.

## Order

```text
PENDING_PAYMENT -> COMMITTED -> FULFILLMENT_PENDING
                 -> FULFILLMENT_READY -> OUT_FOR_DELIVERY
                 -> DELIVERED

PENDING_PAYMENT -> EXPIRED / CANCELLED
COMMITTED or later -> CANCELLATION_REQUESTED -> CANCELLED
COMMITTED or later -> EXCEPTION
EXCEPTION -> prior valid flow / CANCELLED
```

`PENDING_PAYMENT` may be represented as a checkout attempt rather than a durable Order if the implementation can preserve payment recovery and idempotency. A durable Order is never considered commercially committed until payment succeeds and the order commitment transaction completes.

Commands include `CommitOrderAfterPayment`, `RequestOrderCancellation`, `ApproveOrderCancellation`, `MarkFulfillmentPending`, `MarkFulfillmentReady`, `MarkOutForDelivery`, `MarkOrderDelivered`, and `RecordOrderException`.

Rules:

- Committed order items and snapshots are immutable.
- Additions create an `OrderAmendment`; removal/repricing is not normal mutation.
- Cancellation is policy-driven by cutoff, procurement, fulfillment, dispatch, reservation, demand, and refund state.
- Delivery/fulfillment projections may advance order state only through application orchestration after their own transition succeeds.

## Order Amendment

```text
DRAFT -> PENDING_PAYMENT -> COMMITTED
DRAFT / PENDING_PAYMENT -> CANCELLED / EXPIRED
COMMITTED -> REFUND_PENDING / REFUNDED (exceptional resolution)
```

An amendment is additive-only, normally requires the original cycle to remain open and before cutoff, and has its own payment and item snapshots. Commitment creates additional capacity/demand/reservation effects without modifying original order lines.

## Payment Attempt

```text
INITIATED -> REQUIRES_ACTION -> PROCESSING -> SUCCEEDED
INITIATED / REQUIRES_ACTION / PROCESSING -> FAILED
INITIATED / REQUIRES_ACTION -> EXPIRED
SUCCEEDED -> PARTIALLY_REFUNDED -> REFUNDED
SUCCEEDED -> REFUNDED
```

Provider states map into stable application states behind the payment adapter. `SUCCEEDED` means funds reached the configured commercial-success boundary (normally captured), not merely that a browser returned successfully.

Commands/events include `InitiatePayment`, `RecordActionRequired`, `ProcessPaymentWebhook`, `ReconcilePayment`, and `MarkPaymentExpired`.

Rules:

- Provider event IDs and checkout idempotency keys are unique.
- Duplicate webhooks return the previously recorded outcome.
- If payment succeeds but commitment initially fails or the response is lost, recovery must either commit the same order exactly once or create a visible refund/finance exception. Money must never become an invisible orphan.
- A payment state is never inferred solely from client state.

## Refund

```text
REQUESTED -> APPROVED -> PROCESSING -> SUCCEEDED
REQUESTED -> REJECTED
APPROVED / PROCESSING -> FAILED -> PROCESSING / ESCALATED
SUCCEEDED may represent partial or full amount
```

Use one or more refund records so each provider operation has a stable identity. Aggregate payment/order projections derive `PARTIALLY_REFUNDED` or `REFUNDED` from successful refund amounts. Retrying a failed provider request preserves the same application idempotency identity where the provider permits it.

## Procurement

```text
OPEN -> AGGREGATED -> REQUIREMENT_APPROVED -> ORDERED
     -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED

AGGREGATED / APPROVED / ORDERED / PARTIALLY_RECEIVED -> EXCEPTION
EXCEPTION -> REQUIREMENT_APPROVED / ORDERED / PARTIALLY_RECEIVED / CLOSED
```

Commands include `AggregateCommittedDemand`, `ApproveProcurementRequirement`, `PlacePurchaseOrder`, `RecordProcurementException`, and `CloseProcurementRun`.

Rules:

- Aggregation occurs at/after operational cutoff and uses committed demand, usable inventory, confirmed incoming, and safety buffer.
- Cancelling an order after procurement starts does not silently subtract purchased supply; an explicit resolution determines inventory/refund effects.
- Requirement recalculation is versioned/audited and cannot erase prior approvals/orders.

## Receiving

```text
NOT_STARTED -> IN_PROGRESS -> COMPLETED
IN_PROGRESS -> DISCREPANCY -> IN_PROGRESS / COMPLETED
IN_PROGRESS / DISCREPANCY -> CANCELLED (authorized exceptional case)
```

Commands include `StartReceiving`, `RecordReceivedLine`, `RecordQualityRejection`, `RecordReceivingShortage`, `ResolveReceivingDiscrepancy`, and `CompleteReceiving`.

Each receipt records expected, accepted, and rejected base-unit quantities. Accepted quantities create inventory ledger movements; rejected quantities do not become usable stock. Completion requires every expected line to be received or explicitly resolved.

## Fulfillment

```text
NOT_STARTED -> PICKING -> READY_TO_PACK -> PACKING -> PACKED
            -> HANDED_OFF -> COMPLETED

PICKING / READY_TO_PACK / PACKING -> SHORTED
SHORTED -> PICKING / READY_TO_PACK / CANCELLED / ESCALATED
```

Commands include `StartPicking`, `RecordPickedQuantity`, `RecordFulfillmentShortage`, `ResolveFulfillmentException`, `StartPacking`, `MarkPacked`, `HandOffToDelivery`, and `CompleteFulfillment`.

Packed quantities consume reservations/stock through explicit ledger movements. `PACKED` does not imply dispatched or delivered.

## Delivery Batch

```text
DRAFT -> READY -> ASSIGNED -> DISPATCHED -> IN_PROGRESS -> COMPLETED
DRAFT / READY / ASSIGNED -> CANCELLED
IN_PROGRESS -> EXCEPTION -> IN_PROGRESS / COMPLETED
```

Batch assignment requires rider capability and allowed scope. Reordering stops, changing riders, or moving jobs is an audited command with concurrency/version checks.

## Delivery Job / Stop

```text
UNASSIGNED -> ASSIGNED -> EN_ROUTE -> ARRIVED -> DELIVERED
                                      -> FAILED
FAILED -> RETRY_SCHEDULED -> ASSIGNED
FAILED -> ESCALATED / CANCELLED
```

Commands include `AssignDeliveryJob`, `MarkEnRoute`, `MarkArrived`, `MarkDelivered`, `MarkDeliveryFailed`, `ScheduleDeliveryRetry`, and `EscalateFailedDelivery`.

Failure reasons include customer unavailable, invalid address, no response, refused, access issue, rider/vehicle issue, weather, and other. Failure alone does not choose refund, retry, or reschedule; an explicit resolution command does.

MVP delivery proof records delivered timestamp, rider, and event/status. Later photo, recipient identity, and signature metadata attach without changing the transition model.

## Cancellation Effects by Stage

| Stage | Normal authority | Inventory/demand effect | Financial effect |
|---|---|---|---|
| Before payment | Customer/system | None | None |
| Paid before cutoff | Customer request under policy | Release stocked reservation; cancel planned demand if not operationally locked | Normally full refund, subject to configured fee policy |
| After cutoff before procurement | Operations | Explicit demand adjustment | Full/partial refund by policy |
| Procurement started | Operations | Preserve supplier commitment; route resulting supply to inventory/resolution | Partial/full refund or credit by approved policy |
| After receiving | Operations/support | Inventory remains auditable; reverse allocation if usable | Affected-line or policy refund |
| After packing | Operations/support | Packed goods require explicit disposition | Policy refund/credit |
| After dispatch | Delivery/support | Failed-delivery resolution | Retry/reschedule/refund/credit |
| Delivered | Support/finance | No cancellation | Separate return/refund adjustment |

## Transition Test Expectations

For every state machine, test all allowed transitions, representative illegal transitions, authorization/scope failures, duplicate commands, stale versions, and cross-domain effects. Time-boundary tests must cover exactly-at-cutoff behavior using an injected clock.

