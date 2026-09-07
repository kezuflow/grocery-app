# Commerce and External Delivery Realignment Verification

**Date:** 2026-09-07

**Scope:** Phases 1–12 of `docs/superpowers/plans/2026-09-05/COMMERCE_AND_EXTERNAL_DELIVERY_REALIGNMENT.md`

**Result:** Implementation and deterministic local acceptance complete; external provider activation remains fail-closed.

## Delivered boundary

- Global selling state and global fulfillment mode are separate versioned authorities. Admin can pause selling, switch mode only while paused, inspect readiness blockers, and reopen through canonical Core commands.
- Active catalog authoring uses exact location/SKU manual retail prices. Missing exact-location price remains unavailable.
- Instant checkout uses location inventory holds and customer-selected opaque external courier options. Scheduled checkout uses cycles/windows, no inventory or capacity, and exact paid-demand aggregation.
- New customer totals exclude FreshMarkets Service Fee and provider processing cost. Historical committed fee snapshots remain readable only where present.
- PayMongo is the only active payment adapter direction; mock payment runtime and simulator surfaces are removed.
- Lalamove is the initial Scheduled quotation and external-dispatch adapter. Active internal Rider, fleet, batch, route-planning, and live-driver-map contracts and UI are removed.
- Promotions enforce the approved merchandise/delivery stacking and guarded usage limits. Notification delivery uses D1 outbox state plus Cloudflare Queue retry, recovery, attempt, and DLQ evidence.

## Phase 12 acceptance evidence

| Acceptance item                                               | Local evidence                                                                                                                                                                                              | Result                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Store/SKU price administration                                | Authenticated Product authoring browser journey creates a sell variant, confirms an exact Central Cebu price, enables selling, and exercises versioned Product/media commands                               | PASS                                               |
| Pause, switch, and reopen                                     | Authenticated Admin browser journey starts from deterministic `OPEN`/`INSTANT`, pauses, switches to `SCHEDULED`, reopens, and proves capability denial; Core integration covers blockers and stale versions | PASS                                               |
| Instant inventory and courier selection                       | Core Instant quote/options and inventory reservation integration tests plus customer fulfillment-selection browser coverage                                                                                 | PASS locally                                       |
| Scheduled no-stock/no-capacity checkout with Lalamove pricing | Scheduled commerce and reservation/demand integration tests prove no stock/capacity effects; Lalamove quotation adapter fixtures verify signed requests and typed quotations                                | PASS locally; sandbox gate pending                 |
| PayMongo payment and provider-confirmed commitment            | PayMongo adapter, runtime-configuration, webhook verification, inbox replay, payment-reaction, and exactly-once commitment tests                                                                            | PASS locally; PayMongo sandbox transaction pending |
| Exact Scheduled purchase aggregation                          | Inventory exact-demand and Procurement aggregation integration tests, including additive paid amendments and migration guards                                                                               | PASS                                               |
| External dispatch and status progression                      | Lalamove request/refresh/cancel adapter tests, delivery-operation integration tests, signed webhook progression, idempotency, and uncertain-outcome reconciliation                                          | PASS locally; sandbox gate pending                 |
| Totals without Service Fee/processing fee                     | Instant/Scheduled quote, Order, cancellation, finance, transaction-summary, and customer browser assertions                                                                                                 | PASS                                               |
| Promotions and usage limits                                   | Promotion evaluation and D1 write-boundary concurrency tests plus customer/Admin browser coverage                                                                                                           | PASS                                               |
| Notification Queue retry/recovery                             | Outbox and Queue integration tests cover stable identities, duplicate consumption, leases, transient/permanent failures, retry exhaustion, quarantine, recovery, and DLQ visibility                         | PASS                                               |

## Final repository gate

`pnpm check` passed on the current Phase 12 tree:

- formatting, naming, terminology, migration/upgrade, commit-message, architecture, readiness/security, and lint checks;
- all workspace typechecks;
- contracts: 19 files / 68 tests;
- Web: 87 files / 355 tests;
- Core: 155 files / 804 tests;
- shared config/domain/validation: 3 files / 6 tests; and
- Core Wrangler dry-run build and Web vinext production build.

The managed local Web/Core/D1 Playwright suite provisions real Better Auth Staff identities and uses the Service Binding boundary. The final snapshot-update-disabled run passed 86/86 tests in one run. Visual regression covers eight Admin archetypes at desktop, tablet, and 390px mobile widths; mobile cases assert that the document itself does not horizontally overflow.

Build advisories are non-blocking: Wrangler reports that no named environment was selected for the intentional top-level dry run, vinext reports large client chunks, and the generated Web Wrangler file contains an existing unsupported `connect` advisory in the pinned local E2E controller.

## Data, contracts, and interfaces

- Forward-only migrations in earlier realignment phases preserve historical committed commerce while adding global commerce authority, exact Scheduled demand, external-provider evidence, promotion guards, and notification Queue evidence. Phase 12 adds no schema migration.
- Active typed contracts expose global commerce configuration, opaque delivery options, provider-neutral quotation/dispatch state, exact financial components, and purpose-built Admin read models/commands.
- Phase 12 removes the remaining deprecated fulfillment-mode compatibility RPC and BFF route. The Admin settings surface now calls only `getGlobalCommerceConfiguration`, `pauseGlobalSelling`, `switchGlobalFulfillmentMode`, and `openGlobalSelling` through one thin same-origin route.
- Product detail/edit reads always carry an explicit `GLOBAL` or exact `LOCATION` scope to the Core boundary.

## Activation gates and risks

Local development remains intentionally fail-closed with `PAYMENT_PROVIDER=disabled` and delivery providers disabled. No real provider transaction was represented as test evidence.

Before production activation, the owner must complete:

1. PayMongo sandbox credentials/account capability, a real successful and failed payment, signed webhook receipt, provider-confirmed Order commitment, reconciliation, refund, and recurring-membership acceptance.
2. Lalamove Cebu service/account/wallet approval, every store pickup profile, sandbox quotation/create/refresh/cancel payload evidence, webhook registration/signature acceptance, and reconciliation runbook rehearsal.
3. Production secrets/bindings, transactional sender onboarding, Mapbox secret/polygon acceptance, and environment-specific smoke tests.
4. Explicit production deployment approval. Grab remains disabled until its independent capability and Cebu acceptance gates pass.

These are external activation actions, not reasons to weaken runtime validation or enable a mock fallback. Push, deployment, credential installation, and provider enablement were not performed.
