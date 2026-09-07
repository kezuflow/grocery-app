# Commerce Alignment Decisions — 2026-09-07

This is the Phase 0 design record for the owner-authorized [completion plan](../product/COMMERCE_ALIGNMENT_E2E_PLAN.md). The canonical documents incorporate these decisions; this record does not establish application acceptance.

## Authority and access

Both modes are authenticated pay-as-you-go. Membership, trials, recurring billing, membership pricing, and membership-only promotion eligibility leave the active product. Payments continues to own financial observations, refunds, and recovery.

Global owns catalog definition and exact-location price writes. Add `prices.read` and `prices.manage` to the closed capability vocabulary; writes additionally require global scope. Local activation keeps `catalog.manage` plus operational scope, without price authority. Add Global `locations.read`/`locations.manage` for site/serviceability authoring, and `transfers.read`/`transfers.manage` with Global dispatch/resolution and exact-destination receipt scope. Existing `procurement.*`, `fulfillment.*`, and `delivery.*` capabilities remain the owning operational permissions. Invitation acceptance authenticates the invited email identity and grants only the invitation's explicit roles/scopes.

Customer-owned profile fields are preferred language and notification preferences; staff support annotations are append-only, author-attributed notes, not authentication display name/email or delivery recipient/phone. Those identity/contact facts stay with Better Auth and CustomerAddress respectively. Profile commands use explicit bounded fields and versions rather than arbitrary patches. Closure intake records requester, verification, reason, status, responsible staff and resolution. Irreversible anonymization cannot complete without an owner-approved field/retention policy; no duration, legal exemption, or deletion eligibility is inferred. Existing paid records and recovery remain available to authorized operations after access disablement.

## Physical and Scheduled supply

An inventory-only central warehouse receives and stores goods. It has no customer dispatch eligibility and does not block selling for missing packing/courier settings. Locations carry versioned structured address, one coordinate pair, capability flags, operating hours/closures, and factual pickup profile where dispatch is enabled.

Inventory owns transfers: one warehouse source, one destination, immutable Product-pool lines, dispatch and receipt movements, and reasoned discrepancies. Source deduction and creation of transit share one guarded transaction that excludes held/reserved stock. Accepted receipts atomically reduce outstanding transit and credit only the authorized destination. Per-line identities prevent duplicate movement. Conservation is source + destination + outstanding transit + explicitly recorded loss/return disposition; units never mix.

Procurement owns cutoff aggregation and purchase confirmation. Receiving owns accepted/rejected/short quantities and creates cycle/location/pool allocations. Fulfillment consumes those allocations for Scheduled packing, without touching Instant stock. An inspected surplus release atomically reduces available cycle allocation and credits physical stock; rejected/spoiled goods cannot be released as sellable. Allocation and transfer ledgers retain distinct immutable effect identities.

## Delivery attempts and preparation

Lalamove quotation is required for both modes; customers choose only FreshMarkets' promise/window. Pickup planning and customer arrival window are separate. A missing or out-of-horizon quote fails closed; manual fallback never bypasses checkout quotation.

One DeliveryJob owns many immutable execution attempts, with a partial unique constraint for at most one active/uncertain attempt. Attempts have unique merchant references and method `EXTERNAL` or `MANUAL`; external attempts hold provider evidence, manual attempts hold a reason and delivery person's name/phone. Manual is Scheduled-only. Recorded actual cost is nullable with currency; variance is unavailable until cost is known. No new rider accounts or fleet model is introduced.

Owner clarification, 2026-09-07: Scheduled-only eligibility and manual lifecycle/handover/completion prerequisites belong in Core policy and guarded commands, not permanent schema triggers or method-specific lifecycle checks. Migration 0069 keeps storage flexible while retaining assignment structure, timestamp consistency, immutable history and active/uncertain-attempt protection. Alignment Phase 6 must implement and test these policies before exposing manual commands; schema support alone is not delivery permission. Other changeable policies are reviewed in their owning phases under the completion plan's enforcement-boundary checklist.

Preparation start atomically locks Order cancellation and starts picking. Instant booking requires picked/checked lines and `PACKING`; Scheduled future booking requires checked cycle goods and recorded ready time. Normal handover requires `PACKED`. Webhook, refresh and reconciliation use one normalized application path with distinct searching/assigned/pickup/delivered facts. Conflicting pickup evidence is retained as an exception. An uncertain create/cancel outcome blocks another attempt; definite closure precedes replacement. Provider cancellation cannot write grocery Order cancellation.

## Media and publication

Reuse Core's `PRODUCT_MEDIA` R2 bucket with separate product/promotion namespaces and typed D1 attachment metadata. JPEG/PNG/WebP content is bounded to 5 MiB and signature-validated. Core generates object keys. Public reads use opaque media identity/version through a same-origin Web adapter; only active published owner/attachment pairs are readable. Replacement/deactivation revalidates publication and invalidates stale URLs/cache evidence. Failed attachment/deletion leaves durable bounded cleanup work; an R2 upload alone is not publication.

## Schema and environments

Further owner-approved policy placement: 0069 replaces component-count uniqueness with individual benefit/redemption identities, removes promotion usage-count triggers and cadence coupling CHECKs, and removes the retired fee-activation flag. Core still owns and enforces today's stacking, usage limits, Weekly-only Scheduled cadence and zero new service fee. Usage checks share the complete commitment transaction, including system grants; unsupported stored cadence fails closed. See the saved plan's Additional policy placement checklist for future policy changes and phase acceptance. Historical configuration and financial evidence remain preserved.

No reset is authorized or executed by this design. Vitest's fresh isolated Worker/D1 instances and newly created verifier databases are disposable. Existing `.wrangler/state`, existing `.wrangler/e2e-state`, shared development, staging and production are retained/unclassified until actual ownership/data is checked. Remote resets, deployment and live payments/bookings remain prohibited without explicit authorization.

Use the current migration chain as the supported starting baseline while correcting Phase 1 invariants. Introduce coherent forward changes for new transfer/allocation/attempt/media/setup ownership and test clean creation plus upgrade of the retained baseline. A later squash is allowed only after identifying its consumers and regenerating seeds/verifiers; changing old migration files alone cannot upgrade an existing database. No indefinite compatibility abstraction is required for unused pre-launch membership or fleet contracts.

## Implementation inspection

| Area | Actual call path and gap observed at Phase 0 |
| --- | --- |
| Commitment | The multi-pool identities, full hold entitlement and already-started-payment expiry fixes are present at `619df3c`. The current pay-as-you-go slice removes Scheduled membership checks at quote creation, revalidation, compatibility eligibility and paid commitment. Worker tests cover no-subscription payment initiation/reconciliation/commitment and stable replay; release acceptance remains separate. |
| Receiving | The baseline now validates start before mutation and aborts the complete batch on a lost requirement/receipt claim. Reachable purchase confirmation and cycle allocation remain Phase 5 work; current receiving must not be mistaken for accepted Scheduled supply. |
| Price authority | `admin/application/catalog-administration-access.ts` permits catalog writes with operational scope; price commands need a separate Global capability boundary. |
| Delivery | `delivery/application/request-provider-delivery.ts` projects create success to `ASSIGNED`; booking success is not rider acceptance. Attempt/reconciliation and prerequisite work remain open. |
| Media | Product R2 authoring exists; canonical catalog reads still use bundled compatibility assets. Campaign publication and cleanup need completion. |
| Setup | Saved staff grants and verified-identity invitation acceptance are implemented at `619df3c`; full onboarding/browser acceptance and location, cycle and warehouse-transfer setup remain open. |

These are source observations, not reproduced runtime defects or an exhaustive audit. Phase status and executed evidence belong in `IMPLEMENTATION_STATUS.md`; no phase is accepted merely by this record.
