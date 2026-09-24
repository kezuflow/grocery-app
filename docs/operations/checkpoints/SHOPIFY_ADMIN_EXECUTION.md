# SAUI execution checkpoint

## Current state

- **Task:** SAUI — Shopify-style Freshmarkets admin.
- **Plan:** `docs/design/SHOPIFY_ADMIN_IMPLEMENTATION_PLAN.md`.
- **Reference ledger:** `docs/design/SHOPIFY_ADMIN_REFERENCES.md`.
- **Owner decision:** Approved the Shopify-inspired admin direction in this conversation; implementation uses existing routes and preserves scope/business behavior.
- **Execution status:** IN PROGRESS, SAUI-02 — Shared shell, navigation, scope, and notifications. SAUI-00/01 and SAUI-02.1 are accepted. Existing visual snapshots encode the old shell and remain failing until the redesigned page families are inspected and baselines are intentionally updated.
- **Observed execution branch/HEAD:** clean tracked `main` synchronized with `origin/main` at `ecf36369266e2bb217c3502e983d6d7acd564e70` before SAUI task files were added.
- **Working tree:** The owner's ZIP `docs/freshmarkets-shopify-admin-plan.zip` is untracked and preserved, excluded from staging. SAUI task documents, DESIGN reconciliation, Admin shell/CSS, and focused browser tests are intended work. No commerce-alignment source or checkpoint was edited.
- **Runtime:** Node `v24.15.0`, pnpm `11.0.9`, repository hooks `.githooks`; disposable `apps/core/.wrangler/e2e-shopify-admin` state is locally provisioned. Actual lead model/effort is controlled by the active Codex session and not changed here. The authorized `gpt-5.6-sol` Medium read-only reference agent completed; the `gpt-5.6-sol` High independent reviewer hit a service usage limit before returning findings. Lead reviewed the diff directly; one writer remains the lead.
- **Active slice:** SAUI-02.2 — regroup Core-authorized navigation with one ordering owner and no lost permitted leaves.
- **Next action:** Reconcile navigation section metadata and Core ordering, update focused tests, then inspect desktop/mobile navigation and scope-specific leaves in the local browser.

## Macro-phase ledger

| ID | Phase | Status | Accepted slices | Evidence / blocker |
|---|---|---|---|---|
| SAUI-00 | Baseline, scope freeze and acceptance inventory | ACCEPTED | 4/4 | 55 pages, 8 redirects, 118 API routes/Core calls; six current screenshots; snapshot mismatch recorded |
| SAUI-01 | References and design-guide reconciliation | ACCEPTED | 4/4 | Reference ledger, visual specification, interaction matrix and guide reconciliation reviewed by lead; independent reviewer unavailable (usage limit) |
| SAUI-02 | Shared shell, navigation, scope, notifications | IN PROGRESS | 1/4 | Full-width dark header, 232px expanded sidebar and scope beside bell; build and 8 focused browser cases passed |
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

**Accepted:** 2/13 phases; 9/51 initially planned slices. Update counts if a slice is explicitly subdivided, without concealing omitted acceptance criteria.

## Active slice packet

```text
ID / exact phase title: SAUI-02.2 / Shared shell, navigation, scope, and notifications
Goal / acceptance criteria: Core-authorized destinations grouped in the approved hierarchy, all permitted leaves reachable in Global and Central Cebu, correct active states, keyboard and mobile behavior, pinned Settings, disabled future entries without navigation.
Dependency evidence: SAUI-00/01 accepted; SAUI-02.1 built, visually inspected in three viewports, 8 focused browser cases passed.
Owner / actual model / effort: current lead session; one writer. Independent High reviewer unavailable due service usage limit; lead reviews each diff.
Writer lock / allowed files: lead owns Core navigation metadata, shared contract, Web navigation and shell, tests, task checkpoint.
Stable base HEAD or frozen diff: ecf36369266e2bb217c3502e983d6d7acd564e70 plus uncommitted SAUI docs and shell slice.
Reference IDs / relevant guide sections: M01–M11; PRODUCT scope/role rules; DESIGN Admin visual foundation and navigation; ENGINEERING contract/verification/Git.
Commands / environment: local disposable `e2e-shopify-admin` Wrangler Web/Core on port 3100; no provider/production operation.
Implemented versus verified versus accepted: 02.2 not begun. 02.1 accepted with typecheck, lint, build, 8/8 focused browser and inspected desktop/mobile images; visual snapshot comparisons failed because old baseline is intentionally stale.
Next action: implement Core-owned navigation grouping and verify permitted leaves in Global/location scopes.
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

Active SAUI-02.2 on `main` at `ecf36369` with uncommitted task documentation, shell/test slice, and preserved owner ZIP. Local disposable Web/Core stack runs on port 3100. Next: implement Core-owned navigation grouping, test all authorized leaves in Global and Central Cebu, then stage only intended SAUI files, commit/push.

## History

- 2026-09-24: Seeded execution checkpoint as part of the planning deliverable. No implementation or application acceptance claimed.
- 2026-09-24: Owner invoked the SAUI implementation. Inspected `main`/HEAD/status, moved the supplied plan and kickoff to their intended paths, extracted ZIP reference/seed files, preserved ZIP untracked, reconciled Product preview requirements, recorded source route baseline, and completed read-only Mobbin reference audit. No application edits, tests or deployment yet.
- 2026-09-24: SAUI-00 accepted with source route/action inventory and six inspected local screenshots. Browser visual snapshots drifted before redesign; 3/3 existing comparisons failed after a recovered local D1 setup, while the scoped capture passed 1/1. SAUI-01 visual and interaction contract entered DESIGN; independent review remains open. No application code or provider/production state changed.
- 2026-09-24: SAUI-01 guide conflicts reconciled and lead-reviewed. Independent High reviewer failed due service usage limit; lead accepted the guide contract with that assurance limit. SAUI-02.1 shell geometry, neutral Admin tokens, header scope placement and focused browser tests implemented. Web typecheck/lint/build passed; 8/8 focused browser checks passed; three current visual images inspected and saved while old snapshots failed as expected. No business/API route/provider change.
