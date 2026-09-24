# SAUI execution checkpoint

## Current state

- **Task:** SAUI — Shopify-style Freshmarkets admin.
- **Plan:** `docs/design/SHOPIFY_ADMIN_IMPLEMENTATION_PLAN.md`.
- **Reference ledger:** `docs/design/SHOPIFY_ADMIN_REFERENCES.md`.
- **Owner decision:** Approved the Shopify-inspired admin direction in this conversation; implementation uses existing routes and preserves scope/business behavior.
- **Execution status:** IN PROGRESS, SAUI-02 — Shared shell, navigation, scope, and notifications. SAUI-00/01 and SAUI-02.1 are accepted. Existing visual snapshots encode the old shell and remain failing until the redesigned page families are inspected and baselines are intentionally updated.
- **Observed execution branch/HEAD:** `main` synchronized with `origin/main` at `765f06de`; the verified SAUI-02.4 foundation is committed and pushed. A small follow-up diff adds the generic Admin command scope lock and URL cursor reset.
- **Working tree:** The owner's ZIP `docs/freshmarkets-shopify-admin-plan.zip` is untracked and preserved, excluded from staging. Intended follow-up edits are `use-admin-command`, Admin context/provider test, and this checkpoint. No commerce-alignment source or checkpoint was edited.
- **Runtime:** Node `v24.15.0`, pnpm `11.0.9`, repository hooks `.githooks`; disposable `apps/core/.wrangler/e2e-shopify-admin` state is locally provisioned. Actual lead model/effort is controlled by the active Codex session and not changed here. The authorized `gpt-5.6-sol` Medium read-only reference agent completed; the `gpt-5.6-sol` High independent reviewer hit a service usage limit before returning findings. Lead reviewed the diff directly; one writer remains the lead.
- **Active slice:** SAUI-02.4 — scope transition safety across dirty/pending forms and scope-keyed reads.
- **Next action:** Inventory remaining scope-sensitive editors and add dirty/locked registrations and stale-read protection where a scope switch can leave old or unsaved data visible; then run focused browser checks for the remaining gate.

## Macro-phase ledger

| ID | Phase | Status | Accepted slices | Evidence / blocker |
|---|---|---|---|---|
| SAUI-00 | Baseline, scope freeze and acceptance inventory | ACCEPTED | 4/4 | 55 pages, 8 redirects, 118 API routes/Core calls; six current screenshots; snapshot mismatch recorded |
| SAUI-01 | References and design-guide reconciliation | ACCEPTED | 4/4 | Reference ledger, visual specification, interaction matrix and guide reconciliation reviewed by lead; independent reviewer unavailable (usage limit) |
| SAUI-02 | Shared shell, navigation, scope, notifications | IN PROGRESS | 3/4 | Core-ordered Shopify groups and pinned Settings; stable scope width; local build, 18 focused browser cases and visual captures passed; transition safety pending |
| SAUI-03 | Shared components and Orders pilot | TODO | 0/4 | — |
| SAUI-04 | Products, categories, catalog reference | TODO | 0/4 | — |
| SAUI-05 | Customers and customer administration | TODO | 0/3 | — |
| SAUI-06 | Discounts and Content | TODO | 0/4 | — |
| SAUI-07 | Fulfillment and Problems | TODO | 0/4 | — |
| SAUI-08 | Delivery weeks, receiving, inventory, transfers | TODO | 0/4 | — |
| SAUI-09 | Delivery, booking, manual assignment | TODO | 0/4 | — |
| SAUI-10 | Finance, Analytics, Home | TODO | 0/4 | — |
| SAUI-11 | Settings, locations, Scheduled cycles | TODO | 0/4 | — |
| SAUI-12 | Full regression, cleanup, handoff | TODO | 0/4 | — |

**Accepted:** 2/13 phases; 11/51 initially planned slices. Update counts if a slice is explicitly subdivided, without concealing omitted acceptance criteria.

## Active slice packet

```text
ID / exact phase title: SAUI-02.4 / Shared shell, navigation, scope, and notifications
Goal / acceptance criteria: Dirty-form confirmation and pending/unknown-command locks; scope-keyed data with old-response rejection; compatible query/selection reset and honest invalid-destination state.
Dependency evidence: SAUI-02.1–02.3 accepted; real Core navigation integration 16/16, Web grouping 16/16, contracts 2/2, local shell/navigation/notification browser 18/18, Global/Central Cebu/mobile sidebar captures inspected.
Owner / actual model / effort: current lead session; one writer. Independent High reviewer unavailable due service usage limit; lead reviews each diff.
Writer lock / allowed files: lead owns Core navigation metadata, shared contract, Web navigation and shell, tests, task checkpoint.
Stable base HEAD or frozen diff: 765f06de; foundation committed and pushed, remaining SAUI-02.4 coverage open.
Reference IDs / relevant guide sections: M01–M11; PRODUCT scope/role rules; DESIGN Admin visual foundation and navigation; ENGINEERING contract/verification/Git.
Commands / environment: local disposable `e2e-shopify-admin` Wrangler Web/Core on port 3100; no provider/production operation.
Implemented versus verified versus accepted: 02.4 transition guard, global pending/unknown command lock, Product and location-form integration, scope-keyed operational activity, Product selection/cursor reset and invalid-scope create state implemented, reviewed, committed and pushed. Follow-up adds the missing generic `useAdminCommand` lock and clears URL cursors before the scope state changes. Focused unit/browser checks and aggregate `pnpm check` passed for the foundation; follow-up focused 7/7 and Web typecheck passed. Remaining scope-sensitive editors need coverage before 02.4 acceptance. Visual snapshot comparisons against the old shell remain failing by design.
Next action: inventory remaining scope-sensitive editors and register dirty/locked state where applicable.
```

## Baseline and route/action coverage

Source route/action inventory is in [SHOPIFY_ADMIN_ROUTE_BASELINE.md](SHOPIFY_ADMIN_ROUTE_BASELINE.md): 55 Admin pages, including 8 compatibility redirects, and 118 Admin API route files with exported methods and Core client calls. It records root navigation capability/scope families, query/deep-link states and risk owners. Core's navigation is the authority; a presentation group must not suppress Receiving when Procurement or Products is unavailable. This matrix freezes route presence for SAUI; it does not certify every runtime action.

## Verification evidence

SAUI-00 used a disposable local D1 state. The managed Playwright command first timed out at 180 seconds while provisioning migrations. Manual continuation of the same local state completed all migrations, after which the same built Web/Core stack served on port 3100. `admin-visual-regression.spec.ts` then executed all three viewport cases but failed at the first Overview screenshot: baseline images had already drifted before SAUI UI edits (desktop 4% pixel difference; mobile 5% and 18px height difference). The actual images were saved in `evidence/saui-00/`. A temporary browser capture spec passed 1/1 against that local stack for selected Central Cebu, catalog read-only and catalog-denied states; its spec file was removed after capture. This is baseline visual/authorization presentation evidence, not provider or production acceptance.

| Slice | Revision or working-tree scope | Exact command / browser journey | Result | Evidence path | Limits |
|---|---|---|---|---|---|
| SAUI-00.1/00.2 | `ecf36369` source + task docs | `node --version`; `pnpm --version`; PowerShell route/Core-call inventory | Node 24.15.0, pnpm 11.0.9; 55 pages/8 redirects/118 API routes mapped | `SHOPIFY_ADMIN_ROUTE_BASELINE.md` | Source discovery, no runtime capability proof |
| SAUI-00/01 docs | working tree at `ecf36369` | `pnpm naming:check`; `pnpm harness:test`; `git diff --check` | Passed; harness 37/37 | command output in execution session | Initial `git diff --check` did not include untracked files; staged diff check still due |
| SAUI-00.3 first attempt | `ecf36369` build + disposable `e2e-shopify-admin` | `E2E_START_STACK=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web exec playwright test admin-visual-regression.spec.ts --workers=1 --retries=0` | Failed: webServer setup timed out at 180 seconds during local D1 migrations | local command output | No browser assertions reached |
| SAUI-00.3 continuation | same local state/build | `node apps/web/node_modules/wrangler-e2e/bin/wrangler.js d1 migrations apply DB --config apps/core/wrangler.e2e.jsonc --local --persist-to apps/core/.wrangler/e2e-shopify-admin` then local two-config Wrangler dev | Migrations passed; local Web/Core ready on port 3100 | local command output | Local disposable DB only |
| SAUI-00.3 | `ecf36369` app + current test fixtures | `APP_BASE_URL=http://localhost:3100 E2E_AUTHENTICATED=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web exec playwright test admin-visual-regression.spec.ts --workers=1 --retries=0` | Executed 3/3 viewports; 0/3 stale image comparisons passed at Overview | `evidence/saui-00/overview-{desktop,tablet,mobile}.png` | Synthetic mocked reads; baseline image mismatch pre-dates SAUI UI edits |
| SAUI-00.3 | same local stack and disposable fixtures | temporary scoped baseline capture Playwright spec, `--workers=1 --retries=0` | 1/1 passed; Central Cebu selector, catalog reader, catalog denied | `evidence/saui-00/{central-cebu,catalog-reader,catalog-denied}.png` | Temporary spec removed; no full provider flow |
| SAUI-01.4 | working tree at `ecf36369` | lead diff review of DESIGN, prompt and plan against PRODUCT Product preview and route baseline | Reconciled Locations/Service Areas under Settings, Delivery weeks under Orders, independent Receiving capability, and Product preview inline controls | `docs/design/DESIGN.md` | Independent read-only reviewer failed before returning findings due service usage limit; lead review accepted for continuation |
| SAUI-02.1 | working tree at `ecf36369` | `pnpm --filter @freshmarkets/web typecheck`; `pnpm exec oxlint apps/web/components/admin/admin-shell.tsx`; `pnpm --filter @freshmarkets/web build` | All passed | local command output | Build verifies compilation, not browser behavior |
| SAUI-02.1 | same local build + disposable local D1 | `APP_BASE_URL=http://localhost:3100 E2E_AUTHENTICATED=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web exec playwright test admin-foundation.spec.ts admin-navigation-discovery.spec.ts --workers=1 --retries=0` | 8/8 passed; desktop expanded/persistence, mobile keyboard/focus, capability/scope leaves, payments redirect, auth and token isolation | local Playwright output | Local synthetic accounts and mock providers |
| SAUI-02.1 | same local build + disposable local D1 | `APP_BASE_URL=http://localhost:3100 E2E_AUTHENTICATED=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web exec playwright test admin-visual-regression.spec.ts --workers=1 --retries=0` | 3/3 viewport runs failed against old shell snapshots at Overview (15% desktop, 16% tablet, 13% mobile pixel changes); actual output visually inspected | `evidence/saui-02/overview-{desktop,tablet,mobile}.png` | Snapshot failures expected from approved redesign; full archetype suite remains due after page families |
| SAUI-02.2/02.3 | `f016015c` + uncommitted nav/header diff | `pnpm --filter @freshmarkets/contracts test -- admin-foundation.test.ts`; `pnpm --filter @freshmarkets/core test -- admin-context.integration.test.ts`; `pnpm --filter @freshmarkets/web test -- admin-navigation.test.ts` | 2/2, 16/16, 16/16 passed respectively; initial failures from changed section expectations were repaired | local test output | Local Worker integration, no provider transaction |
| SAUI-02.2/02.3 | same working tree | `pnpm format:check`; Web/Core typecheck; `pnpm --filter @freshmarkets/web build` | Passed; no page/API route added | local command output | Compilation alone does not prove interaction |
| SAUI-02.2/02.3 | rebuilt local Web/Core + disposable D1 | `APP_BASE_URL=http://localhost:3100 E2E_AUTHENTICATED=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web exec playwright test admin-foundation.spec.ts admin-navigation-discovery.spec.ts admin-readiness.spec.ts notifications.spec.ts --workers=1 --retries=0` | 18/18 passed after fixing a test locator that selected the header brand instead of the sidebar Home link; stable bell position measured on Global→Central Cebu | local Playwright output | Synthetic users, mock providers |
| SAUI-02.2 | same local stack | temporary read-only navigation capture Playwright spec; desktop Global/Central Cebu and mobile Central Cebu | 1/1 passed; all three sidebar/sheet images inspected; temporary spec removed | `evidence/saui-02/navigation-{global-desktop,cebu-desktop,cebu-mobile}.png` | UI capture, not authorization proof by itself |
| SAUI-02.4 | `fae0d343` + uncommitted transition diff | Web typecheck; `pnpm --filter @freshmarkets/web test -- admin-context-provider.test.tsx admin-command-state.test.ts admin-operational-refresh-provider.test.tsx location-fulfillment-workspace.test.tsx` | Passed; focused provider/command/old-location tests | local test output | UI transition mechanism, not all later family editors |
| SAUI-02.4 | rebuilt Web/Core + disposable local D1 | `APP_BASE_URL=http://localhost:3100 E2E_AUTHENTICATED=1 E2E_STATE_NAME=e2e-shopify-admin pnpm --filter @freshmarkets/web exec playwright test admin-scope-transition.spec.ts --workers=1 --retries=0` | 2/2 passed: cancel/accept dirty draft, invalid location create state, clean return, selection/cursor reset with filter preserved | local Playwright output | Local synthetic users, mock providers |
| SAUI-02.4 | same local stack | `product-command-recovery.spec.ts` separately at 1440px and 390px with no retries | 1/1 each passed: uncertain edit blocked scope switch, same-key recovery retained; initial run 0/2 timed out at stale `Save product` test locator before scope assertion, fixed to current `Save changes` and 120s operation timeout | local Playwright output | Local mock provider and disposable catalog writes only |
| SAUI-02.4 | `fae0d343` + uncommitted transition diff | `pnpm check` (third run after formatting and a stale accessibility assertion were repaired) | Passed: harness 37, shared/config/validation/contracts tests 2/2/4/69, Web 159 files/668 tests, Core 210 files/1,721 tests, Web build; format/naming/terminology/architecture/lint/typecheck gates passed | `%TEMP%/saui-pnpm-check.log` | Earlier runs failed only formatting and the old 64px rail assertion; repaired. Browser coverage is the focused local evidence above, not production/provider acceptance |
| SAUI-02.4 follow-up | `765f06de` + uncommitted generic-lock/cursor diff | `pnpm --filter @freshmarkets/web test -- admin-context-provider.test.tsx admin-command-state.test.ts admin-controls-pagination.test.tsx`; `pnpm --filter @freshmarkets/web typecheck` | 3 files/7 tests and typecheck passed. First focused test attempt failed a test-only selector, repaired; first format check identified the new test, repaired. | local command output | No fresh browser run yet; earlier Product browser tests do not cover generic-command recovery |

Separate mocked/component, local Worker/D1, local browser, actual sandbox provider and production evidence. Do not overwrite a failed result with “passed” without retaining the failure and repair record.

## Decisions and preserved constraints

- Shopify screenshot is the visual baseline; Freshmarkets business rules remain authoritative.
- Product list selection retains the authoritative scoped preview and approved inline Global/category/location-price controls from PRODUCT; full routes handle substantial edits. The plan/prompt were reconciled with those rules before execution.
- No new/renamed/deleted page/API routes or redirect destinations.
- Global and authorized locations remain beside notifications; internal Market is not reintroduced into ordinary navigation.
- Core-authorized children must remain reachable after regrouping.
- Current calendar-led Scheduled cycles and URL-owned location editing are preserved.
- Existing mode-specific booking/action availability remains authoritative.
- POS/Messaging are disabled future entries; no fake functionality or metrics.
- Existing commerce-alignment checkpoint and unfinished work are not overwritten.
- Storefront remains outside redesign scope.
- No production/shared-staging/provider side effects or deployment are authorized by this package.

## Blockers / deferred decisions

No external-access blocker. The shared-chat download control failed, but the owner supplied the ZIP locally. The first managed browser setup timed out during migrations; manual migration and stack startup recovered actual local browser coverage. The inherited visual snapshot comparisons were stale before SAUI UI edits and now diverge further under the approved shell; update them only after redesigned page families are inspected. The `gpt-5.6-sol` High independent review attempt failed at a service usage limit; the lead completed a diff review and recorded that assurance limit. No acceptance gate is being marked passed by failed snapshot comparisons.

## Latest handoff

Active SAUI-02.4 on `main` at `765f06de`, pushed to `origin/main`, with uncommitted generic-command lock/cursor follow-up and preserved owner ZIP. The disposable local Web/Core stack was stopped after focused browser checks. Aggregate `pnpm check` passed on the committed foundation, including 668 Web and 1,721 Core tests and a Web build; follow-up focused 7/7 and Web typecheck passed. Next: review/commit/push this follow-up, then inventory remaining scope-sensitive editors and add guards/old-response rejection where needed.

## History

- 2026-09-24: Seeded execution checkpoint as part of the planning deliverable. No implementation or application acceptance claimed.
- 2026-09-24: Owner invoked the SAUI implementation. Inspected `main`/HEAD/status, moved the supplied plan and kickoff to their intended paths, extracted ZIP reference/seed files, preserved ZIP untracked, reconciled Product preview requirements, recorded source route baseline, and completed read-only Mobbin reference audit. No application edits, tests or deployment yet.
- 2026-09-24: SAUI-00 accepted with source route/action inventory and six inspected local screenshots. Browser visual snapshots drifted before redesign; 3/3 existing comparisons failed after a recovered local D1 setup, while the scoped capture passed 1/1. SAUI-01 visual and interaction contract entered DESIGN; independent review remains open. No application code or provider/production state changed.
- 2026-09-24: SAUI-01 guide conflicts reconciled and lead-reviewed. Independent High reviewer failed due service usage limit; lead accepted the guide contract with that assurance limit. SAUI-02.1 shell geometry, neutral Admin tokens, header scope placement and focused browser tests implemented. Web typecheck/lint/build passed; 8/8 focused browser checks passed; three current visual images inspected and saved while old snapshots failed as expected. No business/API route/provider change.
- 2026-09-24: Committed and pushed verified baseline/shell as `f016015c` on `main`. SAUI-02.2 Core-ordered Shopify sections, Settings pinning and noninteractive future labels implemented without new routes. SAUI-02.3 fixed selector width and preserved bell behavior. Contracts/Core/Web focused tests and 18 local browser checks passed; three current navigation images inspected. SAUI-02.4 is the next active safety slice.
- 2026-09-24: Committed and pushed SAUI-02.2/02.3 as `fae0d343`. SAUI-02.4 added a central dirty/pending transition guard and global command lock, Product/location guard registrations, stale activity protection, Product cursor/selection reset, and honest invalid-scope creation state. Unit and local browser checks passed; aggregate gate remains. Subsequent page-family slices must connect their editor dirtiness to the shared guard before acceptance.
