# Commerce alignment — active checkpoint

## Latest owner request — CA-7.12 product-image diagnosis (2026-09-10)

Owner asks to check the missing images on freshmarkets.ph against the local produce assets. Source: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**, deployed storefront/media acceptance. This diagnostic request takes precedence over the older next-action text below; it does not reopen or repeat the deployment reset. Acceptance: inspect live D1/R2 and public image behavior, establish exact local-to-product matches, and identify remaining work.

Observed `main` at `cb693e60`; existing deployment/config/checkpoint changes and unrelated deletions remain preserved. No application, remote database, R2 object or deployment was changed by this diagnosis.

Executed read-only evidence against the live staging resources serving freshmarkets.ph:
- `pnpm --filter @freshmarkets/core exec wrangler d1 execute freshmarkets-core-staging --env staging --remote --command "SELECT count(*) AS products FROM product; SELECT count(*) AS media FROM product_media; SELECT id,slug,name,image_metadata_json FROM product ORDER BY slug LIMIT 3;" --json`: 227 products, zero product_media records. D1 target is the current `48aaa957-2be1-4883-9998-5321a49d2825`.
- Same remote query with `SELECT id,slug,name,image_metadata_json FROM product ORDER BY slug;`, compared in PowerShell to `apps/web/public/produce`: 226 files, 226 exact and unique assetKey matches, no unused assets; only Farm eggs (`product-eggs`) has no image metadata/file. All files pass RIFF/WEBP signature and 5 MiB limit checks; visual subject accuracy was not independently reviewed.
- `pnpm --filter @freshmarkets/core exec wrangler r2 bucket info freshmarkets-product-media-staging`: zero objects, zero bytes (bucket statistics, consistent with prior reset evidence).
- Node fetch of `https://freshmarkets.ph`: HTTP 200, zero `/media/products/` URLs, 82 product-image placeholders. Fetch of `/produce/abiu.webp`: HTTP 200, image/webp, 25,708 bytes. Static files are deployed; the current Core projection reads product_media and serves versioned R2-backed URLs, so legacy image_metadata_json alone cannot publish them.

CA-7.12 diagnosis is complete. Remaining work at this request's level: one media-population operation for 226 exact matches and one missing Farm eggs asset. Concrete next action: import the 226 files through the Core-owned media upload/publication command, preserving existing media and its audit/idempotency/version safeguards, then verify every resulting public URL. Upload/publication has not been executed or claimed. Prior broader deployment/provider acceptance remains separate below.

Updated: 2026-09-10. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-7.10 — Existing Mapbox, Cloudflare email and D1 acceptance setup** is complete within its stated scope and D1 verification limits. The owner confirmed the single test email reached their inbox. Actual Mapbox API checks, email-domain provisioning/delivery and the isolated D1 upgrade rehearsal are verified; no implementation slice is active. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete journeys and activation evidence**, sections A/E/I and required phase acceptance. CA-7.9 is locally complete and pushed as `db56b5b3`; do not restart it.

Acceptance: use the existing Core Mapbox credential for bounded actual-provider geocoding checks without exposing tokens or response addresses; inspect/configure Cloudflare native email through Wrangler; choose and verify a safe D1 acceptance target while preserving existing data. Record actual account acceptance separately from local adapters and from a deployed customer journey. Owner authorizes using the existing local Mapbox configuration, Cloudflare email setup and agent selection of D1. This does not authorize unrelated payment/courier effects, customer mail, data deletion or application deployment.
Owner correction, 2026-09-10: defer the customer-facing account-closure option. Its uncommitted Core/contracts/Web draft was removed; no migration/data changes occurred. Existing staff closure and retained history remain. PRODUCT, plan section E and guidance audit preserve this deferral. Support destination supplied by owner: support@freshmarkets.ph.
All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD and origin/main `ebd248a6` before the authorized email test. CA-7.10 setup was based on `db56b5b3`; prior CA-7.9 tested base was `dad5de26` plus its committed 39-file scope. Preserve all excluded owner changes.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Existing disposable local DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. Owner now delegates D1 selection, but existing remote `freshmarkets-core-staging` is retained: no reset or deletion. Explicit UTF-8 writes; no subagents; no inferred deployment, payment/courier effects or customer messages. Bounded Mapbox reads and Cloudflare email provisioning follow the new authorization above.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

CA-7.10: actual Mapbox v6 temporary forward and permanent reverse requests using Core `.dev.vars` both returned HTTP 200 with usable address results; no token/address payload logged or persisted. Wrangler 4.127.1 enabled Email Sending for `freshmarkets.ph`; public DNS-over-HTTPS confirms bounce MX/SPF, DKIM and DMARC. Existing Core EMAIL implementation is retained; `AUTH_EMAIL_FROM=no-reply@freshmarkets.ph` was appended to the ignored local `.dev.vars` without changing credentials. Owner supplied a controlled recipient and explicitly authorized one test message. Wrangler `email sending send` completed with exit 0 and `Queued for` that redacted recipient. Exactly one message submitted; no retry. The owner then provided the received message showing it in their Inbox, confirming actual receipt from the configured FreshMarkets sender. No Worker deployed; this is provider-send acceptance, not a deployed auth/reset journey.

Chosen D1 target: isolated `freshmarkets-core-acceptance` (`29e5e67b-37f6-427b-966f-e0e3564e6567`, APAC); no Worker is bound to it. Existing staging (`989a3663-0d73-4f58-a58d-012ab02843a5`) has active writes and retained records, so it remains unchanged at 0055. Protected export/config files are under `C:/Users/reggi/.codex/private/freshmarkets-ca710`, outside Git; never print or commit their data. Original snapshot `staging-0055-20260910.sql` SHA256 `2C18F1431A4379E48430B0C58C0FDB280F0FC1917862C6400F6B37C3FD7097AD`. Initial raw import failed with missing parent table; schema-first import failed with a foreign-key constraint. Both rolled back. Parent-first import preserves every SQL statement, passes immediate foreign-key enforcement locally, and imported successfully into remote acceptance. All 40 migrations 0056–0095 applied successfully, with 95 migration records now present. Read-only remote counts still match the snapshot (9 customers/addresses, 18 order items, 13 payment intents, 3 payment refunds, 1 staff identity, 227 products); foreign-key checks and individual quick checks on all 159 tables pass. The whole-database quick check fails with Cloudflare `SQLITE_NOMEM`; do not report it as passed. This is a verified remote upgrade rehearsal, not cutover/deployed-application acceptance. No application source changed. All owned commands finished; no local Worker stack is running.

Prior completed CA-7.9 acceptance:

CA-7.9 completes current storefront/account/Admin acceptance and removes stale minimum-order copy. The lazy geocoder factory is an instance function, internal to Worker RPC; the strict contract-conformance guard remains unchanged. No schema or public contract changed. Verified scope: 13 Core/Web source/test files, 19 reviewed visual baselines, Product/API/Data/plan/guidance-audit updates and this checkpoint/history (39 files). No unfinished CA-7.9 implementation files remain after this commit; excluded owner changes above remain untouched.

Final local evidence: 60 focused Core tests/4 files for the geocoder correction; 27 storefront/account/Admin/reconciliation browser cases; two Scheduled paid-addition/changeover/fulfillment journeys; four permanent-location/carryover/customer-support cases; one connected Admin-site/customer-confirmation journey; three Admin visual cases across 1440x1200, 1024x1366 and 390x844. These total 37 browser cases. The 19 changed PNGs were inspected; the visual suite then passed without snapshot updates. Visual fixtures establish presentation, not real provider/financial success.

**Final aggregate96327 passed, exit 0**, `ca79-aggregate-final.log`, against `dad5de26` plus the complete CA-7.9 application/test scope: 1675 Core tests/199 files, 418 Web/103, 68 contracts/19, six shared-package tests and 26 harness tests; all root static/schema/type/catalog checks, both builds and vinext (15 supported/0 issues). Worker binding freshness and local readiness checks also passed. Guidance preservation verified 27 archived hashes, all 21 decision mappings, A–I/eight phases/five final journeys and 92 active local links. Exact commands, intermediate failures and fixes are recorded once in history. All owned browser stacks and verification processes are stopped; no application changes followed the final gate.

## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** still need external acceptance, alongside the earlier retained-environment/identity checks below. Local implementation is complete through CA-7.9; CA-7.10 environment setup/verification is complete with the limits above. Customer self-service closure is owner-deferred.

| ID | Current acceptance and remaining obligation |
| --- | --- |
| CA-0-2 | Local setup/scope/recovery evidence remains below. CA-7.10 rehearsed all pending migrations on an isolated remote copy of actual staging records, preserving checked counts and passing foreign-key/per-table integrity checks. Original staging remains at 0055; whole-database quick check, eventual cutover and pre-fix provider-address retention review remain open. Actual owner identity/email/OAuth acceptance remains a release input. |
| CA-7.9 | Locally complete: final aggregate, connected journeys, current visual acceptance and documentation/preservation verification passed. External acceptance remains assigned to CA-0-2/6/7 below. |
| CA-7.10 | Actual Mapbox temporary/permanent requests passed; email domain/DNS/local sender configured; isolated D1 upgrade through 0095 verified with the limits above. Cloudflare accepted the single authorized email test and the owner confirmed it reached their Inbox. CA-7.10 is complete; deployed auth/reset/OAuth and release acceptance remain under CA-7. |
| CA-6 | Local preparation/automatic booking, normalized events/recovery, immutable promises/charge, Scheduled-only manual and membership retirement covered. Actual Lalamove sandbox/account operations and provider-event acceptance remain open. |
| CA-7 | Local customer/operator/support/refund/reorder/report/notification/recovery journeys covered. Actual Mapbox permanent request acceptance is now demonstrated by CA-7.10. Actual PayMongo payment/refund, deployed auth/reset email and OAuth, retained-address review, deployment and a clean setup-to-delivery demonstration on the owner-configured target remain open. |
| Approved follow-ups | D01/D21: CA-7.2–8; D03/D10: delivery milestones and Instant/Scheduled journeys; D05: CA-3.3; D06–07/D08: CA-3.4 and small-cart checkout; D11/D13: Problems and CA-7.1; D14/D17–18: CA-4/5; D15: CA-7.9 outstanding Scheduled goods after paused Instant changeover. Their actual provider/release limits remain assigned above. |

### Plan coverage and earlier acceptance gaps

This maps every section of `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`; evidence remains local unless explicitly stated. Prior accepted revisions are retained in the completed-slice table/history, not relabeled as fresh browser runs.

| Section / phase | Concrete local evidence and limits |
| --- | --- |
| A / 0–2 setup | Location/service-area/pickup/schedule/cycle Worker suites; prior location, service-area, hours, pickup and cycle browser acceptance; CA-7.9 creates/activates a new site through Admin, configures pickup/hours/polygon/readiness and confirms the customer's exact assigned site. `customer-site-setup.integration.test.ts` additionally connects new-site cycle, confirmed address and explicit staff scope without business SQL. Synthetic operational values only. |
| B / 3 media/catalog | CA-3.1–3.3: Global catalog/category/variant CRUD, anonymous R2 publication/replacement/removal/deactivation and five-image gallery; permission/invalid-upload/metadata and object-recovery tests. Dedicated product/promotion media browser evidence remains in history. |
| C / 3 prices/promotions | CA-3.2/a–d and CA-3.4: exact-location Global price authority, local selling/read-only prices, immutable paid terms, sale/code/delivery allocation, overlap/usage/allowance/eligible-cancellation recovery; real local paid-sale browser journey. |
| D / 4 physical goods | CA-4/4.1–3: 100000 -> 60000/20000/20000 conservation, holds/reservations, concurrent transfer claims, scoped partial receipt, damage/missing/loss/inspected return and actual counts. Worker/D1 and prior transfer/count browser evidence; no new route/forecasting feature. |
| E / 2,6,7 identity/customer | Prior initial administrator, staff/customer invitation/access/closure Worker/browser acceptance; CA-7.6–8 account/profile/address/access/contact; CA-7.9 customer-support exact retry and actual membership retirement. Valid reset-token/reuse/password behavior executes in Core; browser covers request/error/logout. Deployed auth/reset email, Google OAuth and actual initial-owner setup remain external; CA-7.10 separately verifies direct-provider test inbox receipt. Customer self-service closure is deferred. |
| F / 1,7 checkout/money | Guarded commitment, full hold sets, distinct ledger identities, canonical event replay/recovery and coordinated refund suites; CA-7.2–4 cart/reorder/paid conversion; actual local Instant/Scheduled signed test-provider journeys, immutable paid Instant items, additions/cutoff, partial cancellation/refunds and provisional summary. No live payment/refund or official invoice acceptance. |
| G / 5 Scheduled | CA-5.1–9: configured week, exact original/addition paid demand, pending-payment purchase gate, consolidated destination totals, actual receiving/counts, replacement/shortage financial resolution, cycle packing and inspected surplus. CA-7.9 completes outstanding Scheduled goods while new commerce is paused in Instant. |
| H / 6 delivery | Existing Instant automatic readiness booking, Scheduled future pickup/manual fallback, packed handover, signed local courier observations, rematch/old-event/unknown/cancel recovery, revised promise and inspected-return/customer agreement; missed delivery does not automatically refund. Full-order grams and actual-versus-accepted costs tested. Test adapters are not provider acceptance. |
| I / 7 operations/release | Durable outbox/Queue/retry/DLQ Worker tests, Problems workflow, CA-7.1 reports/scopes/dates, redacted telemetry and fail-closed environment checks; CA-7.9 current Admin visual archetypes. Actual provider delivery, edge/deployment configuration and real staffed operations remain unaccepted. |

All 12 original audit findings remain accounted for: (1) multi-pool keys, (2) packing/cancellation/consumption, (4) delivered-work/retired capacity, (5) missing holds and (7) held adjustments/release ledger are covered by `instant-commitment.integration.test.ts` and associated inventory/cancellation suites. (3) courier cancellation, (10) booking prerequisites and (11) searching/webhook/refresh/inbox normalization are covered by delivery application/HTTP/operations suites and signed browser events. (6) rejected receiving, (8) reachable purchasing and (9) cycle-versus-physical goods are covered by procurement/receiving/surplus Worker suites and CA-5.9/CA-7.9 connected journeys. (12) warehouse/readiness, pickup-versus-arrival and full-order shipping constraints are covered by setup/delivery suites and both customer modes. Actual provider constraints remain in the external gate.

Final journeys 1–2 map to F/G/H, journey 3 to G/H, journey 4 to F/G/H/I, and journey 5 to the current scoped Core tests across A–I. Phase 0 guidance/schema and Phase 1 recovery are not reopened from the historical starting assessment. Clean schema/representative retained upgrades are tested locally; CA-7.10 adds the isolated actual-staging-copy remote rehearsal above. The original shared deployment remains protected and unaccepted for the new release.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs | Result / commit |
| --- | --- |
| CA-7.10 | Actual Mapbox temporary/permanent API acceptance; Cloudflare sending/DNS and owner-confirmed inbox delivery; remote retained-data copy upgraded 0055–0095 with checked counts preserved, foreign-key and 159 per-table checks passed. Whole-database quick check remains limited by provider memory. Setup evidence `ebd248a6`; receipt evidence accompanies this record. |
| CA-7.9 | Locally complete in the commit accompanying this record; aggregate 1675 Core/199, 418 Web/103, 68 contracts/19, six shared tests and 26 harness tests; 37 browser cases, static/schema/type checks, builds/vinext and preservation checks. Tested base/scope above; exact commands in history. |
| CA-7.8 | Account recovery/contact/sign-out accepted at dad5de26; auth 5/1, static/types/build, both browser widths. Customer closure deferred by owner. |
| CA-7.7 | Address create/edit safeguards locally accepted at 4ba6f214; 41 Core/26 Web/68 contracts, runtime checks/builds and both exact-retry browser widths. |
| CA-7.6 | Account name/phone/default address/removal locally accepted at 99e97b96. Schema/133 Core/25 Web/68 contracts, final 112 Core, runtime checks/builds and both browser widths; older create/edit gap assigned CA-7.7. |
| CA-7.5 | Permanent browsing confirmation locally accepted at 9decade6; Core 74/5, Web 35/4, contracts 68/19, runtime checks/builds/vinext and both browser widths. Closes local CA-7.3 retention gap; actual provider acceptance remains open. |
| CA-7.4 | Paid-Cart lifecycle locally accepted at c435d720; aggregate, 64/3 focused Core and four browser journeys passed. |
| CA-7.3 | First-visit location/guest carryover locally verified at 701b587d; aggregate and six browser journeys passed. Provider-result retention implementation corrected and locally accepted in CA-7.5; actual provider acceptance remains open. |
| CA-7.2 | Cart names/current-price Buy again locally accepted at 43f7a7e6; Core 8/2, Web typecheck and both real local browser widths passed. |
| CA-7.1 | Approved commerce reports locally accepted at e54d0cb3; aggregate plus final focused 45/4, three Admin browser tests and two real local desktop/mobile journeys. Exact evidence in history. |
| CA-3.4 | Selected-item sales/allowance/stacking locally accepted; 9dd13ed1. Aggregate 1639 Core/196, 402 Web/101, 68 contracts/19; final Core 71/4 and both desktop/mobile paid-sale cancellation journeys passed. |
| CA-3.3 | Five-image Add/Edit/replacement/gallery locally accepted; e3d4180a. Aggregate 1635 Core/196, 402 Web/101, 68 contracts/19; focused Core 31/2 and both desktop/mobile galleries passed. |
| CA-5, CA-5.9 | Section G local acceptance completed through CA-5.1–5.9; final connected customer journey and aggregate pushed as `9138860b`. Provider/delivery and newer approved product obligations remain open above. |
| GD-1 | Guidance consolidation and approved decisions; pushed `83854bd`. |
| CA-3.1, CA-3.2, CA-3.2a, CA-3.2b, CA-3.2c, CA-3.2d | Phase 3 local gate completed; final aggregate and 28-browser matrix at `0d14da0`, evidence `ab276df`. Children include `60f348d`, `092a0ad`, `0d14da0`. New owner-approved product changes above remain separate obligations. |
| CA-4, CA-4.1, CA-4.2, CA-4.3 | Stock/transfers/discrepancies/counts locally verified; CA-4.2 `406a405`, CA-4.3 `010b8af2`. |
| CA-5.1 | Delivery-week workspace and exact purchase: `e6afa560`. |
| CA-5.2 | Shortage/replacement receiving: `2f11e609`. |
| CA-5.3 | Scheduled receipt weight and actual size counts: `61d1299b`. |
| CA-5.4 | Inspected surplus: `c0e7ed7c`. |
| CA-5.5 | Late-payment purchase readiness: `bad66079`. |
| CA-5.6 | Consolidated destination purchase totals: `49d75d3a`. |
| CA-5.7 | Shortage-linked Order review/cancellation: `75e2105b`. |
| CA-5.8 | Audited supplier-exception resolution after cancellation: `19f409a1`. Aggregate **1577 Core/194 files, 403 Web/101, 68 contracts/19**, shared/harness/migrations/static checks/both builds; 2 browser journeys; vinext 15 supported/0 issues. Original browser financial state was synthetic, so it does not close CA-5.9. |

Older implementation anchors `b8e32b2`, `f7f17dc`, `d14de2c`, `762a18e`, `f6f8c88`, `e50ef9a`, `012b5db` and their evidence remain in history. Their absence from active instructions is not permission to rebuild them.

## External blockers and one next action

The owner authorized Mapbox verification, Cloudflare email setup, D1 selection and one test email; all were executed, and the owner confirmed inbox receipt. Payment/courier effects, application deployment, actual pickup/service/hour/promise/catalog/accounting values and OAuth observations remain release inputs. No current business decision blocks independent implementation. Official accounting and irreversible anonymization remain policy-dependent. Records are retained indefinitely; paid Instant items/quantities cannot change.

**One next action:** agree the bounded staging deployment and PayMongo/Lalamove sandbox operations before performing those external effects; then use the existing deployment/provider runbooks to verify the deployed auth/reset/OAuth and complete setup-to-delivery journey. The D1 copy is a rehearsal snapshot, not a current replacement for staging: coordinate retained-data migration with the authorized release. Do not resend the completed email test, restart completed slices or infer deployment/cutover authorization.
