# FreshMarkets State Machines

## Enforcement Rules

States are changed only through named application commands. Client, application, and admin lifecycle commands check current state, actor capability/scope, business preconditions, a stable idempotency key where replay is possible, and the expected aggregate version where concurrent mutation is possible. Repositories must not expose generic status setters.

External provider events are not client commands and never supply or invent an `expectedVersion`. Ingestion requires unique `(provider, providerEventId)` identity and a durable inbox. The handler loads current aggregate state, applies legal-transition and compare-and-swap protection, and safely retries or reconciles if another command changed the aggregate concurrently.

A provider-confirmed canonical Payments outcome sufficient under the configured commitment policy is the customer commitment boundary for paid membership and paid orders. For the current release, provider captured/success states map to canonical Payments `SUCCEEDED`. For `SCHEDULED`, delivery-cycle cutoff is the later operational/procurement commitment boundary. `INSTANT` has no fabricated cycle transition; its operational boundary is expressed by the snapshotted promise, expiring checkout inventory hold, committed reservation, and Fulfillment transitions. These events are deliberately separate.

## Subscription

```text
PENDING -> TRIALING / ACTIVE / CANCELED / EXPIRED
TRIALING -> ACTIVE / CANCELED / EXPIRED
ACTIVE -> PAST_DUE / PAUSED / CANCELED / EXPIRED
PAST_DUE -> ACTIVE / PAUSED / CANCELED / EXPIRED
PAUSED -> ACTIVE / CANCELED / EXPIRED

CANCELED (terminal)
EXPIRED (terminal)
```

Commands include `BeginMembershipEnrollment`, `StartPromotionalTrial`, `ActivateSubscriptionFromPayment`, `InitiateMembershipRenewal` (only where the application, not the provider, owns renewal attempts), `RecordMembershipPaymentFailure`, `RecoverSubscriptionFromPayment`, `PauseSubscription`, `ResumeSubscription`, `RequestSubscriptionCancellation`, `ApplyScheduledSubscriptionCancellation`, and `ExpireSubscription` (also the grace-exhaustion transition for `PAST_DUE`).

Rules:

- `PENDING` is not eligible. It may enter `TRIALING` only when Promotions supplies a valid introductory-trial grant/redemption, or `ACTIVE` only after a provider-confirmed canonical Payments outcome satisfies the payment commitment policy.
- Entering `TRIALING` additionally requires an existing recurring-capable payment authorization. Establishing that authorization is not payment success, no zero-value payment is synthesized for the trial, and the first paid charge becomes due at `trialEndsAt`.
- Only `TRIALING`, `ACTIVE`, and `PAST_DUE` inside its grace window are checkout-eligible. Eligibility also considers exact effective timestamps, not just a stored enum.
- Paid renewal requires a provider-confirmed canonical Payments `SUCCEEDED` outcome. A failed renewal at a due boundary transitions `ACTIVE -> PAST_DUE`. `PAST_DUE` carries a 7-calendar-day grace window during which membership entitlement, including checkout eligibility, persists. `RecoverSubscriptionFromPayment` returns `PAST_DUE -> ACTIVE` only on verified provider-confirmed success. Grace exhaustion without verified success applies `ExpireSubscription` (`PAST_DUE -> EXPIRED`). Immediate intentional cancellation during `PAST_DUE` transitions directly to terminal `CANCELED` and terminates all further renewal attempts for that subscription.
- No production automatic renewal initiation or retry owner is currently approved. The scheduler therefore fails closed behind an explicit renewal-initiation ownership gate while continuing to apply confirmed outcomes and grace expiry. A future provider integration must choose exactly one retry owner and must not layer application attempts on provider-managed retries. The provider-neutral lifecycle may consume explicit canonical success/failure outcomes in tests, while production initiation cadence and retry timing remain an owner decision. Calendar-month billing semantics and the nominal billing anchor are preserved across short-month clamping.
- The introductory trial lasts exactly one calendar billing month as calculated in the Market's configured business timezone under `DOMAIN_MODEL.md`; persisted start/end values are UTC instants.
- Immediate intentional termination transitions an allowed nonterminal state to `CANCELED`.
- Cancel-at-period-end records `cancelAtPeriodEnd` and `scheduledCancellationAt`/`endsAt` without changing `TRIALING` or `ACTIVE`. At the effective instant, `ApplyScheduledSubscriptionCancellation` performs the guarded transition to `CANCELED`.
- `EXPIRED` is used only when entitlement naturally ends without continuation, including a timed-out pending enrollment or an uncontinued trial/entitlement. It is not the successor of `CANCELED`.
- `CANCELED` and `EXPIRED` are terminal. Neither may transition to the other or back to an entitled state; a later membership requires a new subscription aggregate subject to eligibility policy.

## Delivery Cycle

DeliveryCycle exists only for `SCHEDULED`; `WEEKLY` is a configured cadence. Location mode switching is an explicit versioned configuration command, not a DeliveryCycle state transition. Activating a new configuration atomically retires the prior effective configuration so the location has exactly one active `INSTANT`/`SCHEDULED` mode, and it never advances or rewrites existing Orders.

```text
DRAFT -> SCHEDULED -> OPEN -> CUTOFF_REACHED
      -> PROCUREMENT -> RECEIVING -> PACKING
      -> DISPATCHING -> DELIVERING -> CLOSED

DRAFT / SCHEDULED / OPEN -> CANCELED
later cancellation -> explicit exceptional operations command
```

Commands include `ScheduleCycle`, `OpenCycle`, `ReachCycleCutoff`, `BeginProcurement`, `BeginReceiving`, `BeginPacking`, `BeginDispatch`, `BeginDelivery`, `CloseCycle`, and `CancelCycle`.

Rules:

- Customer orders/amendments enter only while the cycle is `OPEN`, current time is before cutoff, and capacity can be atomically allocated.
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
- `SCHEDULED` commitment atomically allocates cycle/zone/location capacity and records configured stocked reservation and/or planned demand effects.
- Additions create an `OrderAmendment`; removal/repricing is not normal mutation.
- Cancellation is policy-driven by fulfillment mode, Scheduled cutoff/procurement where applicable, fulfillment/dispatch progress, hold/reservation/demand, and refund state.
- Delivery/fulfillment projections may advance order state only through application orchestration after their own transition succeeds.

## Order Amendment

```text
DRAFT -> PENDING_PAYMENT -> COMMITTED
DRAFT / PENDING_PAYMENT -> CANCELED / EXPIRED
COMMITTED -> REFUND_PENDING / REFUNDED (exceptional resolution)
```

An amendment is additive-only and has its own payment and item snapshots. `SCHEDULED` normally requires the original cycle to remain open and before cutoff. The normal customer deadline for `INSTANT` amendments is not yet approved, so Instant amendment creation fails closed until that policy is defined. Commitment creates the applicable incremental hold/reservation, capacity, and/or demand effects without modifying original order lines.

## Payment Attempt

```text
INITIATED -> REQUIRES_ACTION -> PROCESSING -> SUCCEEDED
INITIATED / REQUIRES_ACTION / PROCESSING -> FAILED
INITIATED / REQUIRES_ACTION -> EXPIRED
SUCCEEDED -> PARTIALLY_REFUNDED -> REFUNDED
SUCCEEDED -> REFUNDED
```

Provider states map into stable application states behind the payment adapter. `SUCCEEDED` means funds reached the configured payment-commitment boundary (captured for the current release), not merely that a browser returned successfully or that payment was initiated. Membership and Order react through separate explicit idempotent application commands.

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
REQUESTED -> APPROVED -> PROCESSING -> SUCCEEDED
REQUESTED -> REJECTED
APPROVED / PROCESSING -> FAILED -> PROCESSING / ESCALATED
SUCCEEDED may represent partial or full amount
```

Use one or more refund records so each provider operation has a stable identity. Aggregate payment/order projections derive `PARTIALLY_REFUNDED` or `REFUNDED` from successful refund amounts. Retrying a failed provider request preserves the same application idempotency identity where the provider permits it.

The refundable captured amount is claimed with one guarded insert. Outstanding `REQUESTED`, `APPROVED`, `PROCESSING`, and `ESCALATED` amounts remain reserved alongside `SUCCEEDED`; `REJECTED` and definitive `FAILED` release their reservation. Concurrent claims cannot collectively exceed the captured amount.

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
IN_PROGRESS / DISCREPANCY -> CANCELED (authorized exceptional case)
```

Commands include `StartReceiving`, `RecordReceivedLine`, `RecordQualityRejection`, `RecordReceivingShortage`, `ResolveReceivingDiscrepancy`, and `CompleteReceiving`.

Each receipt records expected, accepted, and rejected base-unit quantities. Accepted quantities create inventory ledger movements; rejected quantities do not become usable stock. Completion requires every expected line to be received or explicitly resolved.

## Fulfillment

```text
NOT_STARTED -> PICKING -> READY_TO_PACK -> PACKING -> PACKED
            -> HANDED_OFF -> COMPLETED

PICKING / READY_TO_PACK / PACKING -> SHORTED
SHORTED -> PICKING / READY_TO_PACK / CANCELED / ESCALATED
```

Commands include `StartPicking`, `RecordPickedQuantity`, `RecordFulfillmentShortage`, `ResolveFulfillmentException`, `StartPacking`, `MarkPacked`, `HandOffToDelivery`, and `CompleteFulfillment`.

Packed quantities consume reservations/stock through explicit ledger movements. `PACKED` does not imply dispatched or delivered.

The lifecycle is shared by `INSTANT` and `SCHEDULED`; mode-specific differences live in Fulfillment policies that construct tasks, deadlines, queues, and allowed actions. Repeated mode conditionals must not be scattered across unrelated state machines.

## Delivery Batch

```text
DRAFT -> READY -> ASSIGNED -> DISPATCHED -> IN_PROGRESS -> COMPLETED
DRAFT / READY / ASSIGNED -> CANCELED
IN_PROGRESS -> EXCEPTION -> IN_PROGRESS / COMPLETED
```

Batch assignment requires rider capability and allowed scope. Reordering stops, changing riders, or moving jobs is an audited command with concurrency/version checks.

`CreateAndAssignDeliveryBatch` is one reviewed, idempotent Delivery orchestration,
not two client-visible commands. In one guarded transaction it creates a `DRAFT`
batch, records the manually ordered stops, advances `DRAFT -> READY -> ASSIGNED`,
and advances every selected job through its legal assignment transition. New
jobs use `UNASSIGNED -> ASSIGNED`; retryable jobs must already have completed
`FAILED -> RETRY_SCHEDULED` before `RETRY_SCHEDULED -> ASSIGNED`. All selected
jobs must share the Core-resolved location and compatible mode/cycle context,
have coordinates, match their expected versions, and be free of conflicting
active assignment. A failed guard or concurrent compare-and-swap changes
nothing. The intermediate batch states are recorded for audit but are not
separate Web authorization points.

Route preview causes no transition, never reorders stops, and neither authorizes
nor blocks `CreateAndAssignDeliveryBatch`. Before a provider is called, preview
must nevertheless pass the same scoped open/selectable, expected-version,
active-batch, and reciprocal job/stop coherence policy as dispatch assignment;
these policy failures are authoritative rather than provider warnings.

## Delivery Job / Stop

```text
UNASSIGNED -> ASSIGNED -> EN_ROUTE -> ARRIVED -> DELIVERED
                                      -> FAILED
FAILED -> RETRY_SCHEDULED -> ASSIGNED
FAILED -> ESCALATED / CANCELED
```

Commands include `AssignDeliveryJob`, `MarkEnRoute`, `MarkArrived`, `MarkDelivered`, `MarkDeliveryFailed`, `ScheduleDeliveryRetry`, and `EscalateFailedDelivery`.

Failure reasons include customer unavailable, invalid address, no response, refused, access issue, rider/vehicle issue, weather, and other. Failure alone does not choose refund, retry, or reschedule; an explicit resolution command does.

current release delivery proof records delivered timestamp, rider, and event/status. Later photo, recipient identity, and signature metadata attach without changing the transition model.

## Cancellation Effects by Stage

| Stage                                                                  | Normal authority                   | Inventory/demand effect                                                                | Financial effect                                       |
| ---------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Before payment                                                         | Customer/system                    | None                                                                                   | None                                                   |
| Paid before Scheduled cutoff or before Instant fulfillment work begins | Customer request under mode policy | Release Instant/stocked reservation; cancel planned demand if not operationally locked | Normally full refund, subject to configured fee policy |
| After cutoff before procurement                                        | Operations                         | Explicit demand adjustment                                                             | Full/partial refund by policy                          |
| Procurement started                                                    | Operations                         | Preserve supplier commitment; route resulting supply to inventory/resolution           | Partial/full refund or credit by approved policy       |
| After receiving                                                        | Operations/support                 | Inventory remains auditable; reverse allocation if usable                              | Affected-line or policy refund                         |
| After packing                                                          | Operations/support                 | Packed goods require explicit disposition                                              | Policy refund/credit                                   |
| After dispatch                                                         | Delivery/support                   | Failed-delivery resolution                                                             | Retry/reschedule/refund/credit                         |
| Delivered                                                              | Support/finance                    | No cancellation                                                                        | Separate return/refund adjustment                      |

## Transition Test Expectations

For every state machine, test all allowed transitions, representative illegal transitions, authorization/scope failures, duplicate commands, stale versions for versioned lifecycle commands, and cross-domain effects. Provider-event tests instead cover duplicate `(provider, providerEventId)`, out-of-order delivery, handler compare-and-swap conflict, retry, and reconciliation. Time-boundary tests must cover exactly-at-cutoff behavior using an injected clock.

## Customer Follow-up Supporting Lifecycles

```text
OrderIssue: SUBMITTED -> CLAIMED -> INVESTIGATING -> RESOLVED
                   \-----------------------------> ESCALATED

Notification: PENDING -> PROCESSING -> SENT
                   ^          \-> PENDING (retry)
                   \------------- expired lease recovery
                              \-> FAILED (bounded terminal exhaustion)

InvoiceReadiness: PENDING_TAX_CONFIGURATION -> READY_FOR_ISSUANCE -> ISSUED
```

Issue submission is customer-owned, typed, idempotent, and version-safe; staff handling is a separate Admin authority and does not imply a financial action. Customer projection collapses `CLAIMED` and `INVESTIGATING` to `IN_REVIEW` while preserving `SUBMITTED`, `RESOLVED`, and `ESCALATED`. Notification retries never replay the source transition. Invoice readiness advances only when the required approved accounting evidence exists; `ISSUED` additionally requires an immutable identifier, issue instant, seller snapshot, and tax breakdown.

The existing `OrderAmendment` lifecycle applies only to additive paid additions. A customer may draft one active amendment for a committed Scheduled Order before cutoff. Its dedicated `ORDER_AMENDMENT` Payment must reach canonical `SUCCEEDED` before the amendment commits. Failed/expired payment fails the amendment; duplicate provider reactions replay safely.
