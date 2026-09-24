# Freshmarkets Shopify-style admin — long-running implementation plan

**Task ID:** SAUI
**Status:** Owner-approved design direction; implementation in progress under SAUI checkpoint.
**Prepared:** 24 September 2026
**Repository:** `kezuflow/grocery-app`
**Recommended lead:** GPT-5.6 Sol / High
**Execution:** One active implementation slice; checkpointed, resumable, with optional explicitly authorized subagents.
**Scope:** Admin presentation and interaction redesign using existing destinations, contracts, capabilities, and business operations.

## 1. Read this before implementation

The owner approved a Shopify-style admin, not a modest reskin of the current admin. Follow the supplied Shopify Spring ’26 screenshot and the selected Mobbin references for the shell, navigation, density, index pages, record layouts, editors, and dialogs. Preserve Freshmarkets identity and business semantics.

The approved direction is:

- Full-width near-black header; pale expanded desktop sidebar; light-gray workspace; white restrained cards; compact controls and tables; charcoal primary actions.
- Keep the existing Global / authorized fulfillment-location selector in the header, immediately before notifications. Central Cebu is a selectable location, not a second simultaneously active scope. Preserve any other authorized location choices. Do not reintroduce an internal Market selector into ordinary operator UI.
- Use Shopify-like navigation grouping: Home, Orders, Products, Customers, Discounts, Content, Finance, Analytics; Sales channels and Apps; Settings pinned below.
- Prefer existing full record/edit routes for substantial Orders and Customers work. Product list selection still exposes the authoritative scoped Product preview and its approved inline Global/category/location-price controls; a full route handles longer edits. Where a separate editor route does not exist, use an editor state inside the existing workspace. The design does not require new paths.
- Use shared resource-picker, focused-edit, confirmation, dispatch, and notification patterns. Do not put every task in a drawer.
- POS and Messaging are visible, explicitly disabled future entries, with no navigation or fake implementation.
- Preserve the existing calendar-led Scheduled cycles workflow and existing operational workflows, restyling them to fit the new admin.

### Evidence and revision boundary

The earlier UI review inspected revision `06abefde2cf77402d63dd54778a443ed9b1f0c94`. Before preparing this execution plan, the default-branch reference was checked again and returned `ecf36369266e2bb217c3502e983d6d7acd564e70`. At that revision, the agent rules, design/engineering guides, root/Web manifests, Playwright configuration, optional UI orchestration prompt, and navigation definitions were re-read. This is not a claim that the whole deployed admin was browser-tested or that HEAD will remain unchanged. See the source register in `SHOPIFY_ADMIN_REFERENCES.md`.

At execution, inspect actual HEAD and the working tree again. Do not revert newer work to the planning revision. No application tests, code changes, commits, pushes, deployments, or provider operations were performed by this planning deliverable.

### Authority and reconciliation

Read `AGENTS.md`, the active SAUI checkpoint, and only the relevant sections of the current owning guides. In particular:

- `docs/product/PRODUCT.md` owns business meaning.
- `docs/architecture/ARCHITECTURE.md` and `ENGINEERING.md` own boundaries, implementation, verification, and Git rules.
- `docs/design/DESIGN.md` owns design requirements.
- Read relevant `API_CONTRACTS.md`, `STATE_MACHINES.md`, and `DATA_MODEL.md` sections when touching a boundary; this project does not authorize redesigning those boundaries.

The newly approved Shopify direction supersedes the old **admin visual** instructions that require the existing rail, orange-accent visual treatment, or universal master-detail panels. Update the affected current design-guide sections explicitly in Phase 1. Do not overwrite the guide wholesale: preserve notification behavior, exact-location semantics, scheduling rules, payment restrictions, accessibility, and other business requirements. Leave the storefront design unchanged.

The old `.codex/prompts/ui-orchestrate.md` describes Astra Medium → Luna Max and adaptation to the existing design system. It is optional and is not the governing runbook for SAUI. Use the task-specific kickoff instead; do not globally replace the old workflow or modify personal model settings.

The current commerce-alignment task has a separate checkpoint and a no-subagent instruction. Do not resume it, overwrite its checkpoint, or grant delegation for it. SAUI delegation is permitted only when the owner explicitly activates the subagent option for this separate redesign. Never run competing writers from these tasks against the same checkout.

## 2. Non-negotiable boundaries

### Preserve routes and integrations

Freeze a route manifest at Phase 0. No new, renamed, or deleted application page routes, API routes, route aliases, or redirect destinations. Existing routes may render redesigned components. New non-route components, scoped styles, tests, and task documentation are allowed.

Existing query-state/deep-link behavior remains compatible. Pure presentation state may live in component state or compatible URL query state, but it must not pretend a new query field is supported by the server. No new endpoints for global search, filters, saved views, bulk actions, drafts, POS, or messaging.

Core remains the authority for authentication, authorization, scope, legal actions, financial facts, stock, scheduling, and provider operations. Do not change database schemas, migrations, financial calculations, stock conversions, cancellation policy, booking timing, or provider adapters as an incidental UI improvement. Discoveries requiring those changes go into a separately bounded blocker/decision entry.

### Do not manufacture functionality

An existing route does not prove that a proposed action exists. Every actionable control must map to an existing authorized command/read, supported state, and verified caller path. Remove or defer unsupported affordances rather than making an attractive but misleading interface.

Specifically exclude unimplemented draft orders, Create order, Mark as paid, Send invoice, shipping-label purchasing, gift cards, loyalty/membership revival, customer segmentation, store credit, persistent saved views, and invented financial accounts. Reference layouts are not feature authorization.

Never fabricate dashboard totals, payout balances, historical trends, conversion percentages, comparison periods, or success states. Do not derive full-scope totals from one cursor page. Do not add per-row detail fetches to populate a dense table.

### Preserve operational truth

Payment, preparation, fulfillment, dispatch, delivery, refund, and issue states remain distinct. An accepted request, unknown outcome, rider assignment, handover, and completed delivery are not interchangeable.

Preserve expected versions, stable command identities, retry/recovery behavior, dirty forms, and pending-command locks. Reuse the existing command owners; do not create a parallel implementation behind the redesigned buttons.

The current design guide describes different Instant and Scheduled booking timing. Therefore, the dispatch chooser is shown only when existing Core action availability permits a choice. This plan does **not** authorize making every order wait for a manual/Lalamove selection or disabling an existing automatic booking. If product intent and the live implementation disagree, record the exact conflict, preserve the current authorized behavior, and isolate the decision instead of silently rewriting it.

### No real external effects during design verification

Use identified disposable local test state and existing test adapters. Do not book real riders, charge/refund real money, send outbound customer messages, alter shared staging data, reset a remote database, expose credentials, or deploy. A separate explicit authorization is needed for those actions. Record simulated, local Worker/D1, browser, actual sandbox-provider, and production evidence separately.

## 3. Model and subagent policy

The following is an engineering allocation for this task, not a measured claim that one model/effort setting is optimal for this repository.

| Role | Model / reasoning | Scope and authority |
|---|---|---|
| Lead / integrator | **GPT-5.6 Sol / High** | Owns task state, sequence, shared components, navigation integration, scope safety, and final acceptance. Implements foundations directly. |
| Reference researcher | **GPT-5.6 Sol / Medium** | Read-only code/Mobbin inspection and a compact evidence report. No application edits. Spawn for a specific missing reference, not permanently. |
| Bounded UI implementer | **GPT-5.6 Sol / Medium** | One defined page family or component slice using the frozen design contract. Cannot redesign contracts or shared foundations independently. |
| Stateful UI implementer | **GPT-5.6 Sol / High** | Used instead of Medium for scope/dirty-state interactions, URL-state compatibility, payments, dispatch, or difficult editor integration. |
| Independent reviewer | **GPT-5.6 Sol / High** | Fresh-context read-only diff, browser, authorization/navigation, and regression review. Returns defects and evidence; does not edit the same files. |
| Optional mechanical helper | **GPT-5.6 Luna / Medium** | Only a fully specified low-risk task: applying established component variants, small repetitive markup changes, or test-fixture maintenance. Not the default owner of page flows. |
| Escalation | **GPT-5.6 Sol / Extra High (`xhigh`)** | One bounded, reproducible unresolved defect or architectural interaction after focused High attempts fail. Return to High after the investigation. |

**Default operational choice:** Sol High lead, at most one writing implementer, and read-only research/review as needed. A single Sol High agent executing the same phases is the supported fallback and simpler setup.

Do not run the entire redesign on Extra High merely because it has many phases. Do not default to Luna Max or an always-on multi-model committee. Model work is allocated by ambiguity and risk, not by how many hours the project might take. Evaluate accepted-slice quality, rework, tokens/credits, and elapsed time; no promised savings percentage.

Model and reasoning selection must actually be supported/configured by the harness. Naming a role “Sol Medium” in a prompt does not prove that the spawned process uses that configuration. Inspect available models and delegation controls, use the installed provider's valid identifiers, and record actual settings when exposed. Do not invent unavailable agent tools, silently substitute a model, or edit user-wide configuration. Without configurable subagents, use the currently selected Sol High session serially and report the fallback.

### Concurrency and ownership

Use one active implementation slice, one writer, and at most three child agents concurrently. Three is a task budget, not a claim about the client's system limit. During shared-shell work, the lead is the only writer. If a writing subagent is active, the lead and reviewer do not modify its files. Read-only work can proceed on independent, stable evidence.

Shared hot files have a single owner: the lead. Examples include `admin-shell.tsx`, `admin-navigation.ts`, Core's `get-admin-context.ts`, the admin layout/context/refresh providers, shared admin compositions, admin token scopes, and any navigation-only shared schema. A worker requesting one of these changes submits a specific request; it does not work around the boundary by duplicating the component.

No nested agent spawning. Do not send every agent the full chat, full repo, complete logs, or every Mobbin image. Give an exact task packet. Reviews must identify the tested revision or freeze the relevant working-tree diff. Do not review or run competing mutating test harnesses against an unstable shared checkout.

## 4. Durable execution state

Use these paths; adapt only if the repository already has a current equivalent for this exact task:

- `docs/design/SHOPIFY_ADMIN_IMPLEMENTATION_PLAN.md` — this execution plan.
- `docs/design/SHOPIFY_ADMIN_REFERENCES.md` — reference evidence, queries, and design deviations; not a second business-policy guide.
- `docs/operations/checkpoints/SHOPIFY_ADMIN_EXECUTION.md` — the one active SAUI checkpoint.
- `.codex/prompts/shopify-admin-redesign.md` — optional task-specific invocation, not an always-on `AGENTS.md` replacement.

Keep the visual contract in the owning sections of `docs/design/DESIGN.md` once Phase 1 reconciles them. Do not create competing DESIGN/PLAN/STATUS files for every page. Screenshot and trace paths belong in the reference/checkpoint evidence; avoid committing bulky traces or any customer data.

### Slice lifecycle

`TODO → IN_PROGRESS → IMPLEMENTED → VERIFIED → ACCEPTED`

`BLOCKED` is an explicit alternative with a named reason. “Implemented” means code exists, not that it works. “Verified” lists actual checks; “Accepted” requires the phase criteria and independent review when delegation is active. A mocked browser run does not become actual provider acceptance.

Use IDs `SAUI-00` through `SAUI-12`, with small slices such as `SAUI-04.1`. Finish the current cohesive slice before starting another. The macro-phase is not one giant task ticket.

### The execution loop

1. Read the checkpoint, current phase, relevant guide sections, and latest working-tree diff.
2. Confirm scope, prerequisites, allowed files, commands, and observable acceptance.
3. Implement the smallest coherent slice. Keep normal browsing usable during transitions.
4. Run focused tests and inspect the browser where relevant; compare against selected reference images.
5. Repair regressions before expanding scope. Two unsuccessful attempts at the same reproducible problem trigger a bounded diagnosis, not a third speculative rewrite.
6. Review the diff and record exact results, tested revision, screenshot/trace paths, and limitations.
7. Integrate verified intended work according to the current repository Git rules; update checkpoint state.
8. Continue to the next dependency-ready slice without routine approval questions. Stop only for a material policy decision, a required unavailable capability, risky external action, unresolved safety defect, or owner request.

For this repository, current `AGENTS.md` specifies direct verified commits/pushes to `main`, not an automatic feature-branch/PR workflow. Follow the execution-time rules, never reset unrelated work, and serialize all integration. Local worktrees only protect state; they do not authorize a different branch policy. Commit/push does not authorize deployment. This document itself does not execute any Git operation.

## 5. Mandatory Mobbin protocol

Read `SHOPIFY_ADMIN_REFERENCES.md` before browsing. The supplied screenshot is the approved appearance baseline; the ledger includes prior inspected Shopify references. Reuse adequate evidence instead of searching the same pattern repeatedly.

At execution, discover the actually exposed Mobbin tools. The current connector provides `search_screens` and `search_flows`; the tool namespace may be prefixed differently in Codex. Do not assume an unexposed `get_flow`, DOM inspector, or screenshot-fetch tool exists.

Use `search_screens` for one screen or dialog; `search_flows` for a transition such as create → choose → configure → save. Set `platform="web"`; include “Shopify” in the query. Start with 1–3 screens or one flow. Use `mode="standard"` for straightforward screen discovery, and `mode="deep"` for a precise unanswered screen question or irrelevant first results. `search_flows` does not currently accept the screen-search `mode` field.

Use this same task intent across calls:

> Plan and implement a Shopify-inspired grocery admin redesign while preserving existing routes and fulfillment-location scope.

**Confusion rule:** when unsure about a reference's hierarchy, layout, modal contents, or interaction sequence, stop that visual decision, consult the saved reference, and make a focused Mobbin query if it is insufficient. Inspect returned images rather than merely trusting search titles. If the flow previews skip the important intermediate state, search for that state specifically or retrieve its provided high-resolution image through an available image-reading capability.

Record the canonical `mobbin_url`, relevant screen/flow ID, observed pattern, Freshmarkets adaptation, excluded capabilities, and unresolved behavior. Cite mentioned screens using their actual Mobbin links. When caching/exporting a reference, download its high-resolution `image_url`; those URLs expire, so do not use them as permanent documentation links. Never ship reference screenshots/watermarks as application UI assets.

Screenshots cannot verify keyboard handling, focus restoration, async behavior, or responsive breakpoints. Implement and test those in Freshmarkets; do not invent claims about Shopify's unobserved behavior.

If Mobbin is unavailable, record the attempted call and limitation. Continue work already grounded in saved references. Mark any genuinely reference-blocked decision explicitly rather than inventing an unrelated design or claiming fresh research. A worker can request a specific research answer from the lead instead of repeating broad searches.

## 6. Navigation contract

Maximum approved grouping; actual entries remain capability- and scope-specific:

```text
Home
Orders
  Delivery weeks
  Fulfillment
  Delivery
  Problems
Products
  Catalog overview (existing global controlled-unit reference)
  Categories
  Inventory
  Receiving
  Warehouse transfers
Customers
  Membership history (existing legacy access only)
Discounts
  Promotion codes
  Promotional sales
Content
  Banners
Finance
Analytics
Sales channels
  Online Store (existing storefront link)
  Point of Sale — Coming soon; disabled
Apps
  Messaging — Coming soon; disabled
Settings (pinned; authorized administrative destinations only)
```

Keep operational exceptions and all other currently authorized destinations reachable through their verified existing routes, even when not listed above. Phase 0 inventories the exact current destination instead of inventing a new one. Settings organizes existing Locations, Service Areas, Staff, Roles, Audit, fulfillment configuration, and Scheduled cycles. Do not hide a staff/locations-only user's access behind a Settings permission that they do not hold.

### Existing route families to verify and retain

| Presentation | Existing destination/family |
|---|---|
| Home | `/admin` |
| Orders / detail | `/admin/orders`, `/admin/orders/[order-id]` |
| Delivery weeks | `/admin/procurement` |
| Fulfillment / Delivery / Problems | `/admin/fulfillment`, `/admin/delivery`, `/admin/issues` |
| Products / detail / create / edit | `/admin/catalog/products` and its existing descendants |
| Catalog overview / Categories | `/admin/catalog`, `/admin/catalog/categories` and existing descendants |
| Inventory / Receiving / Transfers | `/admin/inventory`, `/admin/receiving`, `/admin/transfers` and existing descendants |
| Customers / legacy history | `/admin/customers` and existing descendants, `/admin/memberships` |
| Discounts | `/admin/promotions`, `/admin/sales` and any verified existing descendants |
| Content | `/admin/banners` |
| Finance | `/admin/payments` and existing compatibility/deep-link behavior |
| Analytics | `/admin/analytics` |
| Settings / configuration | `/admin/settings`, `/admin/settings/fulfillment-mode`, `/admin/settings/scheduled-cycles` and existing descendants |
| Administrative records | `/admin/locations`, `/admin/locations/service-areas`, `/admin/staff`, `/admin/staff/roles`, `/admin/audit` and existing descendants |
| Online Store | Existing storefront `/` link; no new admin channel route |
| POS / Messaging | No destination; no `href="#"`, click navigation, or fake endpoint |

This is a planning map, not the complete executable manifest. Phase 0 must enumerate every actual route, compatibility redirect, and deep-link contract.

### Authorization-safe regrouping

Core's authorized leaf destinations are the input. Prefer updating the current Core-owned navigation metadata and using one display order, not introducing a Web allowlist that silently drops newly permitted destinations. New presentation group metadata may be introduced only if needed; it must not add a route, change a business DTO, or widen access.

Reparenting must not make an independently authorized child disappear because the operator lacks its parent destination's permission. For example, a receiving-only operator must still find Receiving without being granted catalog access. A non-navigating presentation group can hold authorized children; the parent opens a page only when that destination is itself authorized. Apply the same rule to Orders children, Discounts, and pinned Settings.

Remove duplicate “Order list” / “Product list” entries only when their parent provides the exact same authorized destination. Move Add product/Add category to existing page actions and preserve their URLs. Categories must not be relabeled Collections, procurement must not pretend to be a supplier purchase-order system, and `/admin/sales` means promotional sales rather than revenue reporting.

## 7. Phase plan and dependency gates

Dependencies:

`00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12`

After Phase 3, read-only research/review for a later family can run ahead. Writing stays serial by default. This order intentionally stabilizes shared UI before migrating operational and financial screens. A lead may advance an independent slice around a documented blocker, but must not declare the blocked phase complete or leave dependent work using an unsettled foundation.

### SAUI-00 — Baseline, scope freeze, and acceptance inventory

**Owner:** Sol High. Optional read-only researcher: Sol Medium. **Code edits:** none, except task documentation/verification inventory.

**Slices**

- **00.1 Repository/environment:** inspect HEAD/status and current work, read the guides, identify ongoing commerce changes, confirm Node/pnpm from the manifests, and record safe test environment. Preserve untracked files and partial work.
- **00.2 Route/action matrix:** enumerate all admin page/API routes, redirects, query/deep links, capabilities, scope visibility, read/write commands, and list/detail/create/edit states. Mark unsupported requested controls.
- **00.3 Baseline evidence:** identify existing unit/Core/browser tests and capture representative current admin screenshots at desktop, tablet, and narrow-mobile sizes using synthetic data. Include Global, Central Cebu, a restricted operator, and an authenticated user without the relevant capability.
- **00.4 Risk/acceptance inventory:** record baseline failures, existing supported filters and aggregates, destructive command boundaries, module owners, and every destination that must be reachable after regrouping.

**Exit gate:** no ambiguity about the working tree or current route set; permissions/scope matrix exists; initial commands and results are recorded; missing browser/tool credentials are honestly marked; no baseline failure is disguised as success. Do not freeze newer business behavior to an old screenshot.

### SAUI-01 — Reference contract and design-guide reconciliation

**Owner:** Sol High; Sol Medium can gather bounded Mobbin evidence.

**Slices**

- **01.1 Reference selection:** use the supplied image plus Orders, product editor, customer detail, discount chooser/editor, Finance, Analytics, and relevant notification/settings references. Inspect intermediate modal states where necessary.
- **01.2 Visual specification:** record target header/sidebar dimensions, density, typography, spacing, card/control radii, semantic badge variants, focus appearance, table treatment, menu/dialog anatomy, and responsive behavior. Use explicit token values, not “make it clean.”
- **01.3 Interaction matrix:** map each existing page family to index, record, editor, or operational composition; define route versus local editor state, back behavior, dirty guards, and permitted primary actions.
- **01.4 Reconcile current guides:** update only the superseded admin-presentation rules in `DESIGN.md`; preserve current product/operational supplements. Record intentional deviations from Shopify.

**Proposed calibration targets:** 56px header, about 232px sidebar, neutral 13–14px body and about 20px titles, 32–36px desktop controls, about 44px table rows, 10–12px card radii. These are Freshmarkets targets, not asserted Shopify source tokens. Touch hit areas remain generous. Validate with the original screenshot at a comparable viewport instead of copying its scaled-down text size.

**Exit gate:** one explicit design contract, a reference for each pilot pattern, clear exceptions, and no old/new instruction conflict. No package upgrade or framework migration.

### SAUI-02 — Shared shell, navigation, scope, and notifications

**Owner/writer:** Sol High lead only. **Primary starting points:** current admin layout/providers, `admin-shell.tsx`, `admin-navigation.ts`, Core `get-admin-context.ts`, admin theme/tokens, command palette, and notifications.

**Slices**

- **02.1 Shell geometry:** full-width dark header with Freshmarkets identity; sidebar underneath; stable workspace; expanded desktop default; mobile navigation sheet. Preserve explicit user appearance choices unless a newly approved rule requires otherwise. Neutralize admin accents without touching storefront tokens.
- **02.2 Navigation:** implement the approved groups from authorized destinations, single ordering owner, correct active descendant states, keyboard interaction, independent sidebar scrolling, and pinned Settings. Keep restricted children reachable. Add only non-interactive POS/Messaging placeholders.
- **02.3 Header scope:** move the existing selector beside the bell, preserve Global and authorized fulfillment locations, use stable width/truncation, retain label accessibility and current scope authority. Preserve the existing admin notification panel behavior; do not add decorative notification animation.
- **02.4 Scope transition safety:** handle dirty-form confirmation, pending/unknown-command locks, query/selection reset, scope-keyed data, and old-response rejection. Never render location A's data beneath a newly selected location B label. On a destination that is invalid in the new scope, navigate only to an authorized existing destination with clear feedback or keep the verified denied/selection state.

**Exit gate:** navigation matches the new hierarchy without capability changes; hidden/disabled states are distinguishable; every authorized leaf remains reachable; shell does not remount on ordinary route transitions; Global/Central Cebu labels do not shift adjacent controls; original mobile/focus/sign-out behavior remains verified.

### SAUI-03 — Shared components and the Orders pilot

**Owner:** Sol High. Medium may implement a bounded table or dialog after its contract is fixed.

**Slices**

- **03.1 Shared compositions:** build/refactor the actual repeated page heading, index toolbar, tabs/views, table, cursor pagination, semantic status badges, two-column record layout, editor save region, resource picker, focused edit dialog, and confirmation dialog. Extract from real consumers; do not create an abstract admin framework or a new public component-demo route.
- **03.2 Orders index:** adopt the compact list; order number opens the existing full-detail route; secondary preview is optional. Preserve currently supported filtering and pagination. Do not invent saved-view persistence, search support, summary aggregates, additional row data, or bulk commands. Unsupported cosmetic controls are omitted.
- **03.3 Order record:** items/fulfillment/payment/activity in the main column, customer/address/location/delivery context beside it. Keep state dimensions separate and existing commands recoverable. List Back restores filters, page and position within the same scope; deep links remain functional.
- **03.4 Pilot validation:** capture and inspect Orders index, full record, an actual confirmation dialog, header scope switch, and narrow layout. Compare density and hierarchy with the approved references. Review permission-denied and empty/error/loading states as well as populated screens.

**Exit gate:** working list → record → permitted action → updated record → preserved list journey; valid server confirmation rather than optimistic commercial success; no new routes; keyboard/focus behavior works. Save pilot screenshots and an internal design decision. The existing owner approval permits continuation after this gate passes; do not pause every phase asking for the same design approval.

### SAUI-04 — Products, categories, and catalog reference

**Owner:** Sol Medium for presentation; Sol High for scope/editor state and review.

**Slices**

- **04.1 Products index:** shared index layout, existing filters, truthful stock/availability/pricing fields, existing bulk actions only, and selected-row authoritative scoped preview. Keep the approved inline Global name/status/category commands and location price edit in that preview; preserve its pending/unknown command lock. Full-detail navigation remains available. Do not fetch full details for every row.
- **04.2 Create/edit:** existing routes render grouped product/media/selling-option cards with contextual Save/Discard. Keep supported media limits, ordering, alt text, validation, progress, and recovery. The full create route may become the primary Add product entry point while the embedded creator remains compatible; neither route moves location price authority out of the scoped Product preview.
- **04.3 Global versus location:** separate global product identity from exact-location prices and inventory. Clearly explain ownership, render view-only versus editable controls from existing capability/read models, and reset selection correctly on scope changes.
- **04.4 Categories/catalog overview:** apply the same patterns without converting categories into collections or removing the existing controlled-unit catalog overview. Preserve shared-weight stock versus counted-size inventory distinctions; shipping/approximate grams are not exact stock conversions.

**Exit gate:** Global creation/editing and location-specific authorized edits work through existing commands; unsupported fields are absent; failed/unknown saves retain intent; media actions and back navigation pass; storefront remains visually and behaviorally unchanged.

### SAUI-05 — Customers and customer administration

**Owner:** Sol Medium; High review of privacy/access actions.

**Slices**

- **05.1 Customer list/detail:** shared index and existing record route; use readable identity, order count, joined/last-order facts that are actually provided, and a restrained supporting contact column.
- **05.2 Existing support/privacy/access:** preserve current action permissions, dialogs, audit context, and reason requirements. Put technical evidence in secondary disclosures only when still useful.
- **05.3 Compatibility:** retain existing customer query/deep-link behavior and authorized legacy membership history. Do not revive membership selling, introduce messaging, or fabricate lifetime spend/order lists not supplied by existing reads.

**Exit gate:** list → profile → supported action → confirmed result works; read-only users cannot mutate; no customer data is leaked in screenshots/logs; absence, permission denial, and load failure remain different states.

### SAUI-06 — Discounts and Content

**Owner:** Sol Medium; High for state/financial-adjacent review.

**Slices**

- **06.1 Discounts navigation/index:** group existing promotion codes and promotional sales under Discounts, maintaining both current destinations and supported filters/actions.
- **06.2 Chooser/editor:** use Shopify's compact type chooser followed by grouped form cards and a live plain-language summary. Choose only existing manageable types. A full-width editor inside the existing route is valid where a separate editor route does not exist; do not add one.
- **06.3 Safeguards:** preserve exact amount/unit parsing, dates/timezones, targets, limits, activation/deactivation, overlap prevention, and existing sale/code eligibility. Display unsupported choices as absent, not simulated.
- **06.4 Content/banners:** restyle existing banner list/media/editor with the same layout, picker and save patterns. Content is a grouping over existing functionality, not a new CMS or theme editor.

**Exit gate:** create/edit/save/cancel and relevant lifecycle actions work; summary matches command payload semantics; current supported behavior does not get narrowed to Shopify's model; no false “all results” when filtering one page locally; no accidental storefront CSS change.

### SAUI-07 — Fulfillment and Problems

**Owner:** Sol High; bounded purely presentational components may go to Medium.

**Slices**

- **07.1 Fulfillment queue:** Shopify-style compact views/table and a focused work area with order/customer identity and readable quantities. Preserve existing queue filters and exact operational location requirements.
- **07.2 Preparation actions:** promote the current next legal action, ordered-item checklist, problem/shortage handling, packing readiness and existing status feedback. Keep transitions from Core; do not simplify away receipt or packing prerequisites.
- **07.3 Problems:** make the existing order-linked Problems list and handling screen consistent with Orders; preserve issue states, notes, optional affected-item selection, and the separation between support handling and refund approval.
- **07.4 Operational exceptions/notifications:** retain the existing exception destination and safe links. Use the established refresh owner and scope-bound reads; do not create a second polling loop per card.

**Exit gate:** representative paid-order preparation passes in the local stack; blocked/shortage/receipt-dependent cases remain accurately blocked; stale versions do not submit a guessed replacement; notifications and queue update without resetting unrelated work. Actual provider effects remain outside this gate.

### SAUI-08 — Delivery weeks, receiving, inventory, and transfers

**Owner:** Sol High for work-area/action integration; Medium for read-only table/layout slices.

**Slices**

- **08.1 Delivery weeks:** retain the existing procurement destination. Present cycle dates, customer arrival promise, and supported sections clearly; keep Order summary as its initial section where currently required. Do not replace this with an invented supplier PO system.
- **08.2 Demand/inventory:** shared tables and responsive records; exact paid/sold quantities, units, destinations, and physical/reserved/available distinctions. Preserve real full-scope aggregate sources and cursor pagination.
- **08.3 Receiving:** one understandable sent/received and actual-size-count form with existing allowed actions. Preserve rejected/missing/replacement cases and allocated Scheduled stock; do not add an extra “Add stock” step.
- **08.4 Transfers:** existing routes, entities, draft/dispatch/receipt/disposition actions only. Keep sent, accepted, outstanding, loss/return evidence distinct. A resolved transfer is not automatically “received.”

**Exit gate:** receiving-only permissions still expose Receiving; quantities and stock ownership match existing contracts; each allowed action executes once with correct identity/recovery; blocked/rejected results leave no false completed UI; mobile records do not require an unusable wide table.

### SAUI-09 — Delivery, booking, and manual assignment

**Owner:** Sol High; High independent review.

**Slices**

- **09.1 Queue/status:** consistent delivery list, visible order identity, fulfillment mode, current delivery progress, and permitted next action. Preserve the shared operational refresh mechanism.
- **09.2 Dispatch interaction:** a focused chooser/form only where the existing action model allows it. Preserve mode-specific booking timing, quote expiry, request/confirmation stages, manual-rider requirements, and handover/result/cost evidence.
- **09.3 Consequential dialogs:** replace browser-native confirmations on affected paths with the shared accessible confirmation dialog. Keep underlying operation names, reasons, versions and idempotency semantics unchanged.
- **09.4 Failure/recovery:** explicitly test pending, allocation, assigned, in delivery, completed, definite failure, canceled, unknown result, and reconciliation-required cases as supplied by current contracts. Unknown outcomes never offer an unsafe replacement booking.

**Exit gate:** existing permitted manual/Lalamove paths operate in the approved local/provider-test environment; a timeout does not produce a “Booked” toast; pending/unknown intent survives relevant UI transitions; duplicate clicks and stale responses do not create new operations. No live rider is booked by visual tests.

### SAUI-10 — Finance, Analytics, and Home

**Owner:** Sol High for Finance integration and report correctness; Medium for established visual compositions.

**Slices**

- **10.1 Finance:** restyle the existing Payments workspace under the Finance label. Preserve paid payments/refunds and Needs attention, existing URL-owned selection/filter state, issue grouping, actual refund confirmation/recovery, and existing unpaid read-only deep links. Do not restore an ordinary unpaid/expired attempts collection or redundant reconciliation navigation.
- **10.2 Analytics:** compact report toolbar, supported metric cards and truthful breakdowns/charts. Retain scope, currency, timezones, date semantics, unavailable values, and metric definitions. Render a time series only when the existing data contains one.
- **10.3 Home:** operations-first summary and actionable links based on existing overview aggregates and permissions. Global and local presentations emphasize their appropriate data. Use no first-page pseudo-totals or unsupported KPI cards.
- **10.4 Consistency:** ordinary detail actions, skeletons, empty/denied/error/unavailable states, and supporting disclosures use the same vocabulary as Orders and delivery.

**Exit gate:** no payment/refund semantic regression; no invented balances/trends; report date/currency/scope changes invalidate correctly; attention cases disappear only after actual verified resolution; Home links use existing authorized destinations.

### SAUI-11 — Settings, locations, and Scheduled cycles

**Owner:** Sol Medium for composition; High for scope, existing multi-step forms and calendar behavior.

**Slices**

- **11.1 Settings navigation:** organize authorized Locations, Service Areas, Staff, Roles, Audit, fulfillment configuration, and Scheduled cycles. Retain existing root Settings redirect and existing detail/step routes. A user with only one child capability can still reach that child.
- **11.2 Locations/Service Areas:** keep the existing address/pin, pickup-contact, Instant-hours and review/enable stages. URL-owned target location must remain separate from header browsing scope. Service Areas remains Global configuration; do not introduce per-location polygon assignment.
- **11.3 Calendar:** retain the current Month/Week/Agenda model, connected cycle selection, delivery-first editing, date/timezone rules, keyboard/mobile creation, range/scroll preservation, and narrow-screen panels. Apply Shopify card/control chrome; do not replace the calendar with a generic list or reinterpret timestamps as durations.
- **11.4 Staff/roles/audit:** coherent table/record/forms with existing capabilities, dangerous-action confirmation and audit context; no privilege widening or new administration flows.

**Exit gate:** existing configuration journeys and calendar interactions pass; a scope switch cannot retarget an in-progress URL-owned location edit; draft save and activation remain separate; existing chronology/cutoff and blocked-action reasons survive.

### SAUI-12 — Full regression, fidelity audit, cleanup, and handoff

**Owner:** Sol High lead plus a fresh-context Sol High reviewer when delegation is active.

**Slices**

- **12.1 Coverage audit:** every Phase-0 route/action row is assigned implemented, preserved-compatible, intentionally disabled, or blocked. No authorized destination disappears. Route/API manifests and redirect targets match baseline, apart from explicitly recorded pre-existing concurrent changes.
- **12.2 Visual/accessibility:** inspect real screenshots of every page family and key dialogs at agreed desktop/tablet/mobile sizes; test keyboard, focus restoration, long labels, loading/empty/error/denied/stale/unknown states, reduced motion, and the preserved supported themes. Do not treat a large pile of uninspected screenshots as acceptance.
- **12.3 Integration/performance:** run aggregate and relevant Worker/D1/browser tests on the integrated revision; compare representative navigation/request behavior with baseline. Check no extra per-row reads, duplicate polling owners, whole-shell loading replacements, unbounded lists, cross-scope stale data, or unexpected storefront changes.
- **12.4 Cleanup:** remove only now-unused presentation components after caller verification; do not remove retained routes, recovery machinery, public contracts, or diagnostics required for real issues. Update the owning design guide and final checkpoint, then follow verified commit/push rules. Leave deployment separate.

**Exit gate:** no unresolved introduced security/financial/operational regression; complete route/action coverage; inspected visual evidence; named baseline failures and environment limitations; explicit counts of accepted/blocked phases and slices; truthful final report. Do not declare “complete” while a required browser or behavior gate is blocked.

## 8. Verification runbook

### Verified current commands

The following script names were read from the current manifests. Revalidate after a HEAD change; do not invent package scripts.

```text
pnpm format:check
pnpm naming:check
pnpm terminology:check
pnpm harness:test
pnpm architecture:check
pnpm readiness:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @freshmarkets/web check:vinext
pnpm --filter @freshmarkets/web build
pnpm --filter @freshmarkets/web test:e2e
pnpm check
git diff --check
```

The root aggregate `pnpm check` includes formatting, naming, terminology, harness tests, migration/commit/architecture/readiness checks, lint, typechecking, workspace tests, and builds. It does **not** establish Playwright/browser acceptance or actual provider acceptance. The Web package exposes separate `test:e2e` and `check:vinext` scripts. See sources S2–S5 in the reference ledger.

Run focused checks during a slice, the repository aggregate at implementation-phase completion as required by `ENGINEERING.md`, and relevant acceptance checks not included in the aggregate. Do not repeatedly rerun an unchanged full suite; a new edit or risk invalidates the relevant prior evidence. Do not weaken tests, change guards to permit invented functionality, or bless every screenshot merely to pass.

### Safe browser setup

Inspect `apps/web/playwright.config.ts`, the relevant tests, and `apps/web/tests/prepare-admin-e2e-state.mjs` before provisioning. The current Playwright configuration supports `E2E_START_STACK=1`, a dedicated `E2E_STATE_NAME` beginning with `e2e-`, and a managed local stack on port 3100. It builds Web and applies migrations to local persisted test state. Do not use this against retained/shared data.

After confirming a disposable state name and no port collision, an example in a separate PowerShell test session is:

```powershell
$env:E2E_START_STACK = "1"
$env:E2E_STATE_NAME = "e2e-shopify-admin"
pnpm --filter @freshmarkets/web test:e2e
```

Equivalent environment assignment in a POSIX shell:

```sh
E2E_START_STACK=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web test:e2e
```

These commands are documented examples, not tests performed during planning. Inspect test selectors/spec names before a focused invocation; do not invent a Playwright project or a runnable filename. Run only one owner of the managed test environment. Provider-gateway options remain off unless separately justified by the existing safe test suite.

### Required scenario matrix

Cover representative existing capabilities and states, not only the happy path:

| Area | Required observations |
|---|---|
| Navigation | Global/local and restricted users; receiving-only/child-only access; unavailable parent destinations; direct URLs; disabled POS/Messaging |
| Scope | A→B data separation; fast switching/out-of-order reads; list selections cleared; dirty editor guard; pending/unknown command remains bound to A |
| Orders | Index/detail/back; supported filters/cursors; payment/preparation/delivery separation; cancellation/recovery where already supported |
| Products | Global versus location; media; variants and exact units; view-only users; pending/conflicting/unknown saves |
| Discounts | Supported type/value/target/date/limit; summary agrees with payload; permitted activation; no unsupported controls |
| Operations | Receipt/packing prerequisites; shortages; purchase/receiving/transfer quantities; legal actions only; correct refresh ownership |
| Delivery | Choice only when legal; manual identity; quote expiry; provider timeout; no duplicate/replacement on unknown result |
| Finance | Paid/refunded/partially refunded/attention; unpaid deep links read-only; confirmed versus pending refund; no fake balances |
| Settings/calendar | URL-owned location; pins/contact/hours; existing cycle views/editor; timezone/chronology; save versus activate |
| Shared UI | Keyboard/focus; modal dirty/pending locks; long text; empty/denied/error/unavailable; narrow screen; supported themes |
| Storefront | Representative unchanged landing, catalog/product, cart and checkout smoke checks where shared primitives could affect them |

Tests of money, lifecycle, authorization or inventory-adjacent interactions must preserve existing Core Worker/D1 acceptance. A visual snapshot alone cannot establish these facts.

### Performance evidence

Record reproducible baseline conditions and representative cold/warm navigation measurements, data volume, request counts, and viewport. At minimum verify that shell navigation remains continuous, supported list reads are bounded, shared polling is not duplicated, and no row-detail N+1 fetch pattern was introduced. Set further budgets from baseline evidence rather than promising a made-up millisecond improvement.

## 9. Task packet and reviewer contract

Use this compact template for each delegated slice:

```text
Task ID / phase:
Actual model and effort (if exposed):
Stable base HEAD or frozen diff:
Objective and observable acceptance:
Dependencies already accepted:
Allowed files:
Shared files that must not change:
Relevant guide sections and existing route/command contracts:
Mobbin reference IDs / local image paths / exact unresolved question:
Required states and permission/scope cases:
Exact checks to run and safe test environment:
Stop conditions:
Return: changed files, checks/results, screenshot paths, risks, remaining work.
Do not spawn children, change routes/capabilities/business rules, or deploy.
```

Worker reports should normally stay under about 500 words plus the precise artifact paths. The lead inspects the actual diff and evidence, not only the report. A reviewer receives the accepted specification and fresh diff, not an instruction to justify the implementer's decisions. Findings need severity, reproduction, expected/actual behavior, affected code, and suggested boundary of repair. “Looks good” without inspected evidence is insufficient.

## 10. Recovery, escalation, and completion

Before context compaction, a pause, handoff, or process failure, write:

- exact task/phase/slice and current branch/HEAD;
- files with verified and unverified work, including any unsaved or uncertain command concerns in the test environment;
- last commands and results with their tested revision;
- accepted reference/design decisions and the rationale for any exception;
- dependencies/blockers, deferred work, and one concrete next action;
- actual agent settings and closed/open writer ownership.

Resume by reading this plan's boundaries, the checkpoint, the active phase, and the current diff. Reconcile revision drift; do not restart completed phases or repopulate an obsolete plan. Re-run acceptance affected by later shared-component edits even when the original phase was previously accepted.

After two unsuccessful focused attempts on the same reproducible defect, stop speculative edits. Capture the smallest reproduction, the failing check, expected versus actual output, relevant diff, and uncertainty. Escalate one investigation to High/Extra High as appropriate. If the result requires a new route, command, capability, business-policy change, or unavailable external access, record it as a separate decision rather than expanding SAUI automatically.

### Final completion report

Report accepted macro-phases out of 13 and accepted slices out of the actual initialized slice count; list blockers separately. Include current integrated revision, changed page families, retained routes and disabled future entries, current design-guide location, test commands/results, inspected screenshots, remaining baseline failures, and deployment/provider boundaries. Do not count documentation as implementation or a build as a browser journey.

**Recommended execution setting:** Sol High throughout for a simple single-agent run; Sol High lead with bounded Sol Medium implementation and on-demand High review for the controlled-subagent run. Extra High is an escalation tool, not the default for every phase.
