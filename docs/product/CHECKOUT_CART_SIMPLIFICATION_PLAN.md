# Checkout and Cart Simplification Plan

Prepared and authorized by the owner on 19 September 2026. This implementation plan continues
[COMMERCE_ALIGNMENT_E2E_PLAN.md](COMMERCE_ALIGNMENT_E2E_PLAN.md), Phase 7 — Complete journeys and
activation evidence. PRODUCT owns business meaning; API_CONTRACTS, STATE_MACHINES and DATA_MODEL own
their technical boundaries. This plan does not authorize deployment, a live fulfillment-mode switch,
real courier/payment transactions or a new provider integration.

## Outcome

Implement the seven checkout/cart requests without replacing the existing checkout engine, shared
Cart cache, Core write authority, payment guards or storefront visual language.

| ID | Required result | Acceptance summary |
| --- | --- | --- |
| CK-01 | Persistent Deliver to destination plus saved alternatives | A browsing-only point remains visible and completable; current saved identity is not duplicated; ownership/confirmation and newer explicit selection win over stale draft state. |
| CK-02 | Compact provider-aware courier selection | Render only Core-returned configured options; provider/service intent survives refreshed opaque IDs; unavailable options cannot be selected; one eligible Instant option auto-selects. |
| CK-03 | Instant-only new customer checkout | No Scheduled control/date selection or fallback in new checkout; Core mode/readiness remains authoritative; retained Scheduled Orders and operations are unchanged. |
| CK-04 | One quote-backed summary and payment action | One financial snapshot includes applicable discounts, delivery, tax, expiry and terms; payment retains exact quote/version/expected-money guards. |
| CK-05 | Automatic quote lifecycle and resolved-value motion | One lifecycle owner quotes when valid inputs exist, requotes after relevant completed changes, ignores stale UI responses while safely superseding server attempts, and never enables payment on stale money. Motion is small, stable and reduced-motion safe. |
| CK-06 | Atomic Clear All | One authenticated Core command (or one guest-local mutation), full rollback on any guard/effect failure, stable retry identity after unknown outcomes, and immutable replay that cannot remove later additions. |
| CK-07 | Promo entry in Cart with shared reactive intent | Drawer and `/cart` share normalized account/Cart-scoped draft state with checkout; entered is distinct from Core-applied; successful clear/successor Cart resets intent without cross-account leakage. |

## Dependency order

1. **Sequence A — CK-06 atomic Clear All.** Add the typed contract, Web adapter, Core transaction,
   browser serialization/cache acceptance and Worker/D1/browser-facing tests.
2. **Sequence B — CK-07 shared promotion draft.** Establish the reactive owner before automatic quote
   dependencies consume promotion changes.
3. **Sequence C — CK-01, CK-03 and CK-02 authoritative delivery inputs.** Resolve destination,
   Instant-only scope and provider presentation/default selection together without operationally
   activating a mode.
4. **Sequence D — CK-04 and CK-05 summary/quotation lifecycle.** Transfer unique receipt/terms
   information before removing the duplicate review surface; retain abandonment, expiry and payment
   safeguards.
5. **Sequence E — integrated verification.** Exercise combined edits, delayed responses, payment
   locks, responsive/keyboard/reduced-motion behavior and safe environment acceptance.

Each sequence is a cohesive implementation slice. The active checkpoint records exact revision,
commands, acceptance level and remaining obligations. Provider discovery must remain provider-call
free, displayed money must come from one current Core quote, and no UI filtering may be presented as
proof that Instant is operational.
