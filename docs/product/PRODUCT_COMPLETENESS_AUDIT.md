# FreshMarkets Product Completeness Audit

Status: APPROVED BASELINE (2026-08-26). This record captures the Instant-vs-Scheduled-vs-shared
product completeness pass, the verification evidence behind it, and the user rulings D1-D11 that
resolve every identified gap decision. It is descriptive audit output; scope authority remains
`MVP_SCOPE.md` and lifecycle/contract authority remains the canonical architecture set named in
`AGENTS.md`.

## Method and Sources

Every checklist item was verified against all of the following before being classified. No item
was reported missing until confirmed absent from documentation, designs, contracts, code, and
remediation plans simultaneously.

- Canonical documents on branch `remediation/2026-08-26`: `DOMAIN_MODEL.md`, `STATE_MACHINES.md`,
  `API_CONTRACTS.md`, `DATA_MODEL.md`, `ARCHITECTURE.md`.
- Product documents: `MVP_SCOPE.md`, `IMPLEMENTATION_PLAN.md`, `IMPLEMENTATION_STATUS.md`.
- Designs: `docs/design/marketplace/*`, `docs/design/admin/*`.
- Implementation: `apps/core/src`, `packages/contracts/src`, `apps/web/app`,
  `apps/core/migrations/0001-0018`.
- Remediation plans: `docs/superpowers/plans/2026-08-26/*.md`.

## Baseline at Audit Time

Per the Remediation Program Final Report (recorded in `IMPLEMENTATION_STATUS.md` on
`remediation/2026-08-26`): Plans 01-07 and the Plan 08 P1 core are complete and verified
(180 Core + 27 Web + 15 contracts + 2 validation tests green; migrations `0001`-`0018` apply
fresh). Canonical expiring quotes, provider-neutral payment intents with signed inbox/CAS,
non-synthetic refunds, promotion-consumed trials, Payments-driven membership activation,
versioned order commitment with `Orders.requestCancellation`, scoped operational commands, and
domain routes replacing `/api/operations` exist. Open: production payment provider,
renewal/dunning automation, default cancellation UX choice, paid-success downstream recovery
policy, post-clamp billing anchor, Plan 08 read models/screens/Playwright, composition-root
extraction.

## Coverage Matrix

Legend: IMPLEMENTED / SPECIFIED (not built) / PARTIAL / MISSING / DEFERRED / EXCLUDED.
"(P08R)" = remaining Plan 08 follow-on scope.

### Instant mode

| Flow | Status | Evidence |
|---|---|---|
| Live serviceability | IMPLEMENTED | Serviceability module; persisted outcomes (`0014`) |
| Current inventory / expiring holds | PARTIAL | Hold/ledger mechanics exist and are mode-agnostic; no instant-specific path exercises them |
| Instant delivery fee/promise configuration | PARTIAL | Quote carries `deliveryFeeMinor`; zone fees mode-agnostic; no instant promise/fee configuration concept |
| Minimum order | IMPLEMENTED | Persisted market policy, mode-agnostic |
| ETA/promise UX | MISSING | Design docs rejected instant patterns (reconciled by ruling D1; dedicated design program required) |
| Rider/dispatch capacity model | PARTIAL | Capacity tables are SCHEDULED-only by design; no instant rider-supply concept |
| Preparation/fulfillment | SPECIFIED (P08R) | Shared Fulfillment machine with mode policies |
| Out-of-stock/shorts | SPECIFIED (P08R) | SHORTED state + shortage/resolution commands; substitutions excluded |
| Cancellation timing | PARTIAL | Stage-effects table specified; instant mode policy defaults open |
| Payment failure/recovery | SPECIFIED | Canonical reactions implemented for membership/order commitment; instant-specific recovery rides shared machinery |
| Delivery tracking (customer) | PARTIAL | Timeline designed; order detail/tracking page absent (Program 9) |
| Failed delivery | SPECIFIED (P08R) | Reasons/retry/reschedule/escalate specified |
| Proof of delivery | DEFERRED | Metadata-only extensible proof |

### Scheduled mode

| Flow | Status | Evidence |
|---|---|---|
| Cycles/windows, cutoffs, capacity | PARTIAL | Allocations + concurrency guards implemented; cycle administration seed-only (P08R) |
| Planned procurement/aggregation | PARTIAL (P08R) | Manual requirement RPC exists; demand aggregation unbuilt |
| Cutoff reminders | MISSING -> APPROVED LAUNCH | No notification capability existed; ruling D5 moves minimal email set into launch (Program 6) |
| Modification before cutoff | PARTIAL (P08R) | Additive amendments specified; amendment execution unbuilt |
| Cancellation pre/post commitment | IMPLEMENTED (core) | `Orders.requestCancellation` replaced legacy `advanceOrder`; refund reactions specified |
| Sold-out windows/alternatives | PARTIAL | CYCLE_FULL + alternate cycles specified/designed |
| Customer window reschedule | EXCLUDED (D10) | Use cancellation + reorder paths |
| Cycle closeout | PARTIAL | `CloseCycle` specified; no time-driven owner until Program 2 |
| Fulfillment/rider assignment/failed delivery | SPECIFIED (P08R) | Plan 08 remainder |

### Shared commerce and platform

| Flow | Status | Evidence |
|---|---|---|
| Catalog/search/pricing/units | IMPLEMENTED | Dedicated category/search pages are polish |
| Product media | MISSING -> APPROVED LAUNCH | Hardcoded static assets; D6 rules in R2 canonical media (Program 8) |
| Variable weight / substitutions / hubs | EXCLUDED | Documented exclusions retained (D10) |
| Cart/checkout | IMPLEMENTED (core) | Canonical quote/payment-intent flow; mock commitment removed; cart command breadth partial |
| Addresses | IMPLEMENTED | Phase 4B incl. persisted serviceability outcomes; address-book page absent (polish) |
| Delivery instructions | PARTIAL -> APPROVED LAUNCH | `notes` plumbed in contracts/persistence; no UI input, not exposed in view, not preserved in order snapshots (Program 7; designs require the field) |
| Order history | PARTIAL | List page only; detail/timeline route absent (Program 9) |
| Reorder/buy-again | MISSING -> APPROVED LAUNCH | Absent everywhere; D7 approves simple flow (Program 11) |
| Amendments | SPECIFIED (P08R) | Additive amendment machine specified; execution unbuilt; instant deadline fail-closed pending approved policy |
| Promotions beyond trial | SPECIFIED | Schema + trial grant implemented; merchandise/delivery benefit application unbuilt |
| Membership eligibility gate | IMPLEMENTED | Enforced at checkout |
| Pause/resume/cancel membership | PARTIAL | Versioned lifecycle persistence exists; customer-facing RPC surface incomplete |
| Free-trial lifecycle | IMPLEMENTED | Promotion-consumed one-calendar-month trial |
| Renewal/dunning/mandate/grace | MISSING -> APPROVED | D2/D3 approve full policy; automation blocked on scheduler (Program 2) and provider capability (Program 4); seams from Plans 05/06 exist |
| Refunds | IMPLEMENTED (core) | Provider-confirmed non-synthetic refunds; cancellation-triggered path specified; automatic refund-vs-retry choice still a blocked decision |
| Credits | DEFERRED | Phase 1.5 |
| Order-issue intake | MISSING -> APPROVED LAUNCH | D8 (Program 10) |
| Transactional notifications | MISSING -> APPROVED LAUNCH | Only fail-closed auth-email port exists; D5 (Program 6) |
| Support/contact flow | PARTIAL | IA-level mention only; minimal help/contact surface joins launch polish |
| Privacy/DSR/closure | MISSING -> APPROVED LAUNCH | D9 baseline (Program 12); legal specifics gated |
| Tax/invoicing | GATED (D11) | `taxMinor` seam exists; BIR-compliant invoice additive persistence approved (Program 13); production behavior legally gated |
| Admin operations | PARTIAL (P08R) | Domain routes + scoped commands done; read models/screens/Playwright remain |
| Rider operations | PARTIAL (P08R) | Jobs routes exist; screens/proof/offline remain |
| Observability/audit | PARTIAL | Structured logs/correlation IDs/audit writes exist; `domain_event` writer and scheduler owner absent (Program 2) |

## Approved Rulings Register

D1 Two first-class modes; stale Scheduled-only design language reconciled; dedicated Instant
design program before implementation; per-market/zone operational flagging allowed; never fake
cycles. D2 Full renewal/dunning policy (authorization-before-trial, first charge at
`trialEndsAt`, `PAST_DUE` with 7-calendar-day grace preserving eligibility, provider-native
retries preferred else ~+1/+3/+6 application retries subject to provider capability, verified
recovery to `ACTIVE`, grace expiry to `EXPIRED`, cancel-during-grace to terminal `CANCELED`,
calendar-month anchors preserved across clamps). D3 Trial abuse: one-per-customer plus
authorization-identity reuse prevention where provider supports; no SMS gate; residual abuse
accepted. D4 Cloudflare Cron Triggers own time-driven execution; job-registry boundary; no
domain state in triggers. D5 Minimal launch email notification set (order confirmed; payment
action required/failed; Scheduled cutoff reminder; out for delivery; delivered; failed
delivery; renewal payment failed/action required; trial ending/first renewal upcoming);
notifications are delivery side effects only. D6 R2 canonical product media at launch; primary
image required; no asset-management subsystem; no arbitrary external URLs as canonical source.
D7 Simple reorder at launch using current identity/price/availability/serviceability with skip
reporting; no recurring baskets. D8 Customer order-issue intake at launch with typed issue
categories; separate from refund authorization; admin queue integration. D9 Launch privacy
baseline: DSR/closure intake, status/auditability, closure-vs-deletion distinction, retention
hooks; Philippine legal specifics gated on authoritative confirmation; financial/order/audit
records survive closure. D10 Reviews/ratings and customer-initiated post-commitment window
reschedule EXCLUDED from MVP; favorites Phase 1.5; prior exclusions retained. D11
Tax/invoicing readiness is a launch gate using BIR-compliant invoice terminology; additive
persistence for invoice identifiers/issuance timestamps/seller snapshots/electronic references
approved; no speculative tax logic; validate against accountant/BIR before go-live.

## Gap Classification Summary

- P0 (integrity/business-model): renewal/dunning subsystem; scheduled-jobs owner; production
  payment-provider readiness (PH methods + recurring capability).
- Launch: notifications (minimal set), delivery instructions completion, R2 product media,
  order-issue intake, order detail/tracking, reorder, privacy baseline, help/contact surface,
  tax-persistence seam, Instant-mode design/spec track.
- Phase 1.5: richer notification channels/preferences, favorites, stronger media workflows,
  fuller refunds/credits self-service.
- Excluded: reviews/ratings; customer window reschedule; plus previously accepted exclusions.

## Disposition

Approved work decomposition lives in
`docs/superpowers/plans/2026-08-26/PRODUCT_FEATURE_PROGRAMS.md`; execution progress is tracked
in `docs/superpowers/plans/2026-08-26/PROGRESS_LEDGER.md`. This audit supersedes no canonical
document; where rulings changed scope or architecture, `MVP_SCOPE.md` and `ARCHITECTURE.md`
were amended in the same reconciliation change, and the marketplace design documents were
corrected to restore Instant as a first-class mode pending its dedicated design specification.
