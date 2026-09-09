# Guidance Rebuild Audit — GD-1

Status: guidance reconciliation and preservation verified for the GD-1 commit. Based on `0245ce0` plus the preserved uncommitted CA-4.2 implementation. The owner approved all nine follow-up choices and resumed after the model handoff. This document is provenance, not another source of product policy or a second next-action ledger. Current work remains in [COMMERCE_ALIGNMENT_EXECUTION.md](checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).

The owner authorized rebuilding guidance on 2026-09-09, preserving the discussion/current implementation/unfinished acceptance and resuming the original commerce work automatically. No application change, provider acceptance or deployment is established by GD-1.

## Active ownership

Five guides: [AGENTS](../../AGENTS.md), [Product](../product/PRODUCT.md), [Architecture](../architecture/ARCHITECTURE.md), [Engineering](../architecture/ENGINEERING.md), and [Design](../design/DESIGN.md). The API, state and storage specifications remain focused technical references. The commerce source plan and one checkpoint own sequencing/acceptance and progress respectively. Runbooks remain purpose-specific operational references. DOMAIN_MODEL, PRODUCT_SCOPE, IMPLEMENTATION_PLAN and TRUNK at their old paths are compatibility pointers only, including for links in the immutable discussion.

The [source archive](../archive/guidance-20260909/INDEX.md) preserves original bytes and SHA-256 hashes. Source-relative links inside archived originals keep their historical context. Old plans/reviews outside this archive remain historical evidence and are not routed active guidance; independent work was not silently canceled. The encoding-damaged IMPLEMENTATION_STATUS stays at its original path and bytes, outside this change. No Markdown source was discarded to perform this consolidation.

## Technical requirement extraction

| Source | Active destination and disposition |
| --- | --- |
| AGENTS: architecture, identity, business invariants, design, schema and workflow | Subject routing/execution in AGENTS; technical ownership in Architecture/Engineering/API/State/Data; business in Product. Superseded minimum/courier/stack/count rules are explicitly mapped to GD-D decisions. No safeguards removed with repeated router prose. |
| AGENT_WORKFLOW | Start/resume, exact slice identity, preservation, continuous execution, checkpoint evidence and completion in AGENTS. Mandatory model/host verification and model benchmarking prose retired; current session choices and no unauthorized settings/delegation retained. |
| CODING_STANDARDS | All implementation sections from Readability through Dependencies extracted to Engineering. Scope/working-method duplicates consolidated into AGENTS/Engineering. Complete write-set guards, current IAM, distinct effect identities, idempotent replay, external unknown outcomes, redaction and pre-launch/retained schema rules preserved. |
| TESTING | Complete risk matrix, commands/limits, failure/concurrency scenarios, fixtures, process/DB boundary and reporting extracted to Engineering. No aggregate, Worker/D1, browser or actual provider gate removed. |
| NAMING_CONVENTIONS and TRUNK | Naming/package/migration/commit conventions and direct-main/local-hook policy in Engineering; source-discovery/check limitations preserved. No verifier or hook weakened. |
| ARCHITECTURE | Runtime, context table, transport/auth, layering, resources, vinext and security/observability retained. Hypothetical directory tree replaced by actual placement rule. Arbitrary pinned-workstream procedure removed; thin adapters and one ownership boundary remain. Provider technical facts extracted from Provider Decisions. |
| DOMAIN_MODEL | Business intent consolidated in Product; technical requirements retained in owning Architecture/Engineering/API/State/Data sections. The final section review maps every nonempty source section to its destination and supersession. Cart creation concurrency and metric-version/dimension safeguards are explicit in API/Data. The owner replaces Customer-creation counts with first-purchase new-customer reporting. Additional historical metric formulas remain archived, not active feature requirements. |
| STATE_MACHINES | State vocabulary, transitions, payment/refund/cancellation effects, cycle/fulfillment/notification/transfer safeguards retained. Courier/mode-switch/admin handling corrections explicit. Historical fleet summary remains retirement guidance only. |
| DATA_MODEL | Persisted facts, immutable evidence, supported migrations, concurrency, transfer/cycle goods and recovery structure retained. Explicit historical fleet-map section archived; current external-delivery and retained-data safeguards preserved. |
| API_CONTRACTS | Current auth/setup/customer/financial/catalog/promotion/stock/operations/external delivery/analytics semantics retained. Obsolete internal fleet signatures moved to archive. Stale two-benefit/ceil/trial instructions and false invitation deferral corrected. Product changes name their implementation gaps; no replacement schema/RPC invented. |
| COMMERCE_ALIGNMENT_DECISIONS | Capability/scope, invocation ownership, transfer/cycle goods, attempt exclusivity, media formats/5 MiB/signature/publication, policy/storage distinction, retained-environment boundaries retained in Product/API/Data/Architecture/Engineering/continuation. Dated inspection is archived evidence, not current status. |
| PROVIDER_DECISIONS | Worker HMAC/signature/secret/money/request mapping, credential modes, tokenized cards, verified event retention, unknown-outcome recovery, actual activation prerequisites and email binding extracted into Architecture plus focused runbooks. Recurring subscriptions/plans/dunning and no-courier-choice instructions retired. No provider behavior freshly accepted. |
| REMEDIATION_DECISIONS | Valid customer/principal chain, session-derived authority and disabled-principal checks in Architecture/Product/API. Old capacity/fallback pricing/trial/mock-provider/additive-deprecation mandates superseded by current product and pre-launch policy. Retained identity/data remain protected. |
| Admin DESIGN and COMPONENTS | Current IA, scope/nav, shell geometry/appearance isolation, list/detail/forms/exception states, component vocabulary, pagination/freshness, accessible charts, responsive behavior and testing in Design. CA-4.2 detail/report specification preserved as unverified implementation scope. |
| Old ADMIN_DESIGN proposal | Valid table/form/status/scope/accessibility requirements already in current Design; old subscription/fleet/capacity navigation, stale tokens/personas and phase approval sequence archived. Command palette remains deferred; no speculative component mandate adopted. |
| Marketplace DESIGN/REFERENCES/STOREFRONT_DESIGN | Current customer surfaces, cart/auth/address/checkout/recovery/accessibility/performance/reference boundary in Design. Unique storefront shell, Helvena typography/token/spacing/icon/44px mobile requirements extracted. Old membership/capacity/minimum/navigation/approval sequence archived or superseded. Original Mobbin research preserved, not rerun. |
| PRODUCT_SCOPE | Domain inclusions map to Product/Architecture/Design/API; exclusions and scope governance extracted. All 40 old acceptance criteria accounted below. Old later-phase candidate list archived without treating recurring/fleet/capacity work as authorized. |
| IMPLEMENTATION_PLAN | Old sequencing/history archived; current path is a pointer to the original commerce plan. All historical acceptance families accounted below; no stale completed phase is restarted. |
| Continuation plan, README and CLAUDE | One execution owner (AGENTS), one boundary record (continuation), one current ledger. Repeated prompts/procedures, optional deleted review-tool pointers and stale Phase 0 status removed from active reading paths. |

The [changed-block review](../archive/guidance-20260909/REQUIREMENT_REVIEW.json) records source paragraph hashes and dispositions for 84 changed/consolidated technical blocks in eight core engineering/specification sources. The [final section review](../archive/guidance-20260909/FINAL_SECTION_REVIEW.json) additionally accounts for all 113 nonempty sections in the former Domain Model and five current design sources after Product/Design consolidation. Each entry names the source section, normalized content hash, active destinations and retained or superseded requirements. Its source hashes and destination anchors were checked. Archived source bytes establish preservation, not implementation correctness.

## Approved decision preservation

Product maps every one of the 21 `Agreed:` sections in [SIMPLIFICATION_DISCUSSION.md](../product/SIMPLIFICATION_DISCUSSION.md), with stable GD-D01–21 IDs, source links, approved intent and implementation/open-input boundaries. The entire discussion remains unchanged and outside commits. The owner's nine explicit follow-up approvals settle the named proposals; other historical proposals are not promoted to mandates.

Material supersessions: available-courier choice, no general checkout minimum, product-sale/full-price-code stacking, one first-order audience choice, actual sorted counts distinct from approximate weights, ordinary image editing/gallery with five-image maximum, expanded profile/contact intent, optional item links for administrator-handled problems, first-visit location selection, automatic Instant booking at final packing, one-site Scheduled launch and disabled payment presentation. Follow-up approvals add the Problems list, weekly view, receiving form, no overlapping product sales, fixed discount per selling unit, ordinary-stock depletion and eligible-cancellation restoration, normal changeover sequence and purchase-based customer reports. The 20,000 g calculation uses quantity times recorded grams per selling option; separate packaging/fit/variation inputs are explicitly superseded. These choices still require implementation and acceptance. Operational/account values remain factual inputs. Existing exact-unit transfer acceptance remains required, including the separately approved damage/missing and Global loss/inspected-return controls.

### Approved changes still requiring acceptance

These are additional acceptance obligations against the changed product target, not reasons to restart previously completed slices. Inspect current code, preserve previous evidence and implement only the actual gap in each owning phase.

| Decision IDs | Owning phase and observable acceptance |
| --- | --- |
| GD-D01, GD-D21 | Phase 7: anonymous cart survives sign-in; approved customer/contact/address operations and first-visit location flow work without a default fabricated location. |
| GD-D03, GD-D10 | Phases 6–7: available verified courier selection, automatic Instant booking at readiness, complete-order grams limit including additions, and honest disabled payment choices; actual provider activation remains separate. |
| GD-D05 | CA-3.3 locally verified: Add/Edit Product supports up to five images, replacement, and detail/quick-view galleries; cleanup stays internal. Aggregate, Worker/D1 and two-width browser evidence is in the active checkpoint/history; release acceptance remains separate. |
| GD-D06–07 | CA-3.4 locally verified: selected-item percentage/fixed-unit sales, full-price grocery-code stacking, separate delivery benefit, overlap rejection, complete-line sale allowance and atomic depletion/cancellation restoration. Aggregate, Worker/D1 and desktop/mobile paid-sale/cancellation evidence is in the active checkpoint/history; actual provider and release acceptance remain separate. |
| GD-D08 | Commerce-correctness follow-up / Phase 7: a small eligible nonempty cart is not blocked by a general minimum; promotion conditions remain separate. |
| GD-D11, GD-D13 | Phase 7: order-level report, scoped administrator Problems handling, separate refund approval and approved purchase/financial/product/promotion/delivery reports reconcile with owning records. |
| GD-D14 | Phase 5: weekly view shows dates, offerings, paid Orders, exact purchasing and receiving/preparation progress with manual supplier contact. |
| GD-D15 | Phase 7: initial single-site Scheduled flow and normal paused changeover to counted Instant stock preserve outstanding paid goods and history. |
| GD-D17–18 | Phase 4 follow-up / Phase 5: linked sent/received evidence and actual local size counts account for the same goods once; no guessed weight-to-piece conversion or second ordinary stock credit. |

All other GD-D rows retain their owning commerce acceptance through the source-plan and former-scope mappings below. Documentation approval does not close any row's application gap.

## Former Product Scope acceptance criteria

Every numbered criterion is preserved in the archived Product Scope. This table assigns its still-valid obligation; historical test evidence remains in the execution checkpoint. A mapping is not a new completion claim.

| Original criterion | Owning commerce acceptance / supersession |
| --- | --- |
| 1 | CA-7 public browse/authenticated purchase; GD-D01 guest cart. |
| 2 | CA-0–2 / CA-7 real auth, cookies, OAuth and session acceptance. |
| 3 | CA-6 / CA-7 no membership in either mode. |
| 4 | CA-1 / CA-7 eligibility; below-minimum rejection superseded by GD-D08. |
| 5 | CA-1 / CA-7 signed canonical payment and exactly-once commitment. |
| 6 | CA-3 / CA-7 immutable paid history. |
| 7 | CA-1 / CA-4 / CA-5 separate Instant stock and Scheduled demand; GD-D17 sorted-count design gap. |
| 8 | CA-5 exact paid purchasing, no netting/capacity. |
| 9 | CA-4.2 / CA-5 exception safety; GD-D09 no extra normal shortage workspace. |
| 10 | CA-5 / CA-6 lifecycle and scope. |
| 11 | CA-6 / CA-7 provider observations/recovery, no fleet. |
| 12 | CA-5–7 purpose-built scoped operational reads. |
| 13 | CA-0–2 / CA-7 selling/mode/snapshots; GD-D15 no all-history completion prerequisite. |
| 14 | CA-3 / CA-4 exact units retained; GD-D17 local counted packs require coherent new design. |
| 15 | CA-3 / CA-7 exact prices/components and no new fees. |
| 16 | CA-3 / CA-7 promotion integrity retained; blanket one-merchandise rule superseded GD-D06–07. |
| 17 | CA-0–2 / CA-7 IAM/metrics ownership and definitions. |
| 18 | CA-7 immutable delivery instructions. |
| 19 | CA-6 no active membership UI/Core/jobs. |
| 20 | CA-7 notification independence. |
| 21 | CA-3 R2 publication; CA-3.3 closes local GD-D05 five-image CRUD/gallery acceptance. |
| 22 | CA-7 current-state reorder. |
| 23 | CA-7 issue intake without refund authority; GD-D11 order-level/admin handling. |
| 24 | CA-0–2 / CA-7 closure with retained history; irreversible erasure policy open. |
| 25 | CA-7 invoice-readiness immutable seam; official issuance externally gated. |
| 26 | CA-1 / CA-7 current quote/payment revalidation and explicit acceptance. |
| 27 | CA-6 / CA-7 immutable charge and actual cost; no-courier rule superseded GD-D03. |
| 28 | CA-1 / CA-7 mode cancellation/whole paid set/canonical refunds. |
| 29 | General minimum superseded GD-D08; payment readiness and original continuation replay remain CA-1 / CA-7. |
| 30 | CA-1 / CA-7 guarded commitment and refund budget. |
| 31 | CA-7 address/cart/opaque option; no-courier portion superseded GD-D03. |
| 32 | CA-7 customer-safe immutable detail/timeline/actions. |
| 33 | CA-1 / CA-7 coordinated additions and administrator exception refunds. |
| 34 | CA-7 durable outbox/Queue/send/retry/DLQ/provider email acceptance. |
| 35 | CA-7 provisional BIR disclaimer and explicit accounting/retention blocker. |
| 36 | CA-0–2 / CA-7 complete Global scope and unavailable/denied read states; GD-D12–13 audience. |
| 37 | CA-3 Global price/catalog and Core media authority. |
| 38 | CA-0–2 / CA-7 geofence/Haversine/whole-order assignment. |
| 39 | CA-0–2 / CA-6 exact pickup/destination contact and coordinates. |
| 40 | CA-6 / CA-7 Scheduled-only manual, readiness/handover/one attempt; GD-D10 automatic Instant booking. |

## Historical implementation-plan acceptance families

The archived implementation plan is the original 0–14 numbering, distinct from commerce Phases 0–7. Its still-valid checks are assigned here, without reviving retired requirements.

| Historical family | Retained acceptance owner / retired portion |
| --- | --- |
| 0 platform/tooling | Engineering aggregate, contract builds, Core invocation and correlation; CA-7 runtime. |
| 1 auth/RBAC | CA-0–2 / CA-7 OAuth/email/reset/session/logout/origin/capability/scope. |
| 2 geography | CA-0–2 / CA-7 polygon edges/invalid coordinates/stale versions/snapshots/capabilities. |
| 3 catalog/units/prices | CA-3 plus GD-D17: exact conversions, shared identity, versions, availability/history. |
| 4 customer/address/trials | Customer/address/session/grant/replay retained CA-0–2/3/7. Trial/enrollment/entitlement/billing assertions retired; no new subscription authority. |
| 5 cycles/fees/capacity | CA-5 cutoff exact instant, timezone, cancellation/alternatives and no duplicate effects; capacity allocation retired, no-capacity assertion retained. |
| 6 cart/eligibility | CA-1/7 eligibility, total reacceptance, unavailable SKU/expiry/stale cart/cutoff/provider failures and exact money; membership/route-price/active-fee rules retired, minimum superseded GD-D08. |
| 7 financial commitment | CA-1/7 signatures/events/CAS/replay/lost response/commit recovery/escalation/snapshots/additions/refund budgets. Membership/capacity/minimum portions superseded; retained financial history still tested. |
| 8 stock/demand | CA-1/4/5 consumption/concurrency/releases/ledger/audit. Hybrid shortfall retired; Scheduled demand remains exact. |
| 9 procurement/receiving | CA-5 demand/partial fill/rejection/discrepancy/duplicate receipt/approved financial resolution; no added problem workspace. |
| 10 fulfillment | CA-5/6 legal transitions/scope/packed quantity/shortage/reservation or cycle consumption/duplicate action. |
| 11 delivery | CA-6/7 exact provider payload/money/signatures/replay/unknown quarantine/redaction/projections/failure reasons. Internal Rider/batch execution retired; proof beyond provider delivery event remains deferred. |
| 12 Admin | CA-0–7 applicable UI/scope/keyboard/states/privacy, catalog/nav/list-detail/freshness; visual baselines at 1440x1200, 1024x1366, 390x844 retained for release Admin archetypes. Retired membership/fleet views excluded. |
| 13 marketplace | CA-7 browse-to-delivery/mobile/auth/races/recovery; capacity-race requirement becomes no-capacity/stock concurrency as applicable. |
| 14 promotions/analytics/later | CA-3/7 promotion/metric reconciliation and scope; CA-4 ledger; Engineering schema preservation. Later candidates are not automatically authorized. |
| Cross-phase definition of done | Engineering/Architecture: closed fail-closed environment configuration, both-app contracts, current command guards and provider-event identity, clean/retained migrations, UI states, logs and owning-spec updates. |

All current commerce plan sections A-I, its audit-defect rows, eight phase-table rows and five final journeys remain present. Current task IDs CA-0-2, CA-3.1, CA-3.2/a-d, CA-4.1, CA-4.2, CA-4, CA-5, CA-6 and CA-7 retain their evidence/status in the checkpoint. At the major-phase counting level, four commerce blocks (4–7) remain, plus earlier CA-0–2 acceptance and the explicitly mapped product-change follow-ups above. GD-1 does not reduce those application obligations.

## Verification and preserved unfinished work

Working-tree verification passed using `verify-guidance.py` in the checkpoint's preservation-artifact directory: 27 archived originals match their SHA-256 values; all 16 unfinished application files match; the protected discussion and encoding-damaged status match their saved bytes; config remains locally deleted. Active Markdown links/anchors, the 113 section-review hashes/destinations, all 21 decision rows, eight phase rows, five journeys and pre-existing CA IDs passed. Documented root/workspace command names were checked against manifests. The first command scan mistook prose about pnpm versions/monorepo for commands; the checker was corrected to inspect command syntax and workspace scripts without changing valid documentation.

Final `verify-guidance.py --staged` passed: all 27 staged archive originals retain their source bytes, 16 application files and protected records match, 33 active documents have 148 valid local links/anchors, and section/decision/task/phase/journey/command checks pass. `pnpm naming:check`, `pnpm harness:test` (26/26), `git diff --check` and `git diff --cached --check` passed. The staged diff contains intended guidance/archive files only. Archive-local `.gitattributes` disables text normalization so captured CRLF bytes remain identical in Git; it changes no application settings. The current CA-4.2 migration/contracts/Core/Web/tests remain uncommitted and outside the GD-1 documentation commit. Its 38 focused Core tests and static/migration checks are inherited evidence; browser startup failed before execution and aggregate acceptance remains open. No application suite was run solely to validate guidance.
