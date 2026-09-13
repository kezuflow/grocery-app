# Hybrid SPA execution evidence

Plan: [HYBRID_SPA_IMPLEMENTATION_PLAN.md](HYBRID_SPA_IMPLEMENTATION_PLAN.md).
Execution is tracked in the [active checkpoint](../operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).

## Implementation

HSPA-0 through HSPA-5 implement category pointer handling, persistent storefront layout,
request-safe query ownership, URL-driven catalog JSON navigation, shared accepted cart state,
targeted account/checkout invalidation, scoped Admin Products caching and responsive image delivery.
vinext and the private Web-to-Core Service Binding remain in place. Core owns authorization and
business commands. No database migration or provider transaction belongs to this change.

Session replacement clears private caches and reloads the document to replace private server props.
Ordinary catalog/history navigation uses the persistent shell. Scoped Admin records, selections and
portaled dialogs are hidden immediately on scope mismatch; unresolved image/price commands retain
their recovery identity until settled or the original scope is restored.

## Verification scope

The initial checkout was main at c9775b1b. Pre-existing location/map/schedule/time-input changes
were excluded. Concurrent owner tasks committed staging provider configuration at a63b5b9c and
quotation reuse at b76165ae and checkout fee display at adca01ad; these were preserved and are not Hybrid SPA changes.

The isolated intended-change aggregate on the c9775b1b Core baseline passed `pnpm check`, including
137 Web files / 557 tests, 205 Core files / 1,665 tests, package tests and both Worker builds.
Final integrated Web checks passed 137 files / 560 tests, typecheck and build, including the committed adca01ad picker interface.
All 17 selected browser tests passed across corrected reruns: five hybrid navigation tests, ten
Admin catalog journeys and two desktop/mobile lost-response checkout release tests. Stale test
selectors were updated to actual controls and persisted media/price results; the disposable checkout
fixture now explicitly supplies all-week operating hours. Core business policy was unchanged.
Both `wrangler types ... --check` commands, `vinext check` (16 supported, zero issues), and
`node scripts/verify-worker-readiness.mjs` passed. The root aggregate has an unrelated harness
failure: its staging binding expectation still requires disabled delivery after a63b5b9c enabled it.

HSPA-6 local verification is complete; staging deployment and public after measurements remain pending.

## Measurement method

`apps/web/scripts/measure-hybrid-spa.mjs` records five valid samples per profile using isolated
headless Chrome 152 on the same Windows host. Desktop is 1440×900, DPR 1, unthrottled. Mobile is
390×844, DPR 1, CPU 4× slowdown, 150 ms network latency, 1.6 Mbps download and 750 Kbps upload.
Each cold sample starts with a fresh context and disabled browser HTTP cache. The existing
first-visit location-prompt dismiss preference permits keyboard navigation. CDN cache temperature
is uncontrolled. Medians and nearest-rank p75 are lab statistics; interaction timings are not INP.

The public baseline uses Web 402f12e4-ffef-4813-854c-c5f0157548bb (fc763e7b) and Core
730f486c-8188-4e20-bb3e-01183d99020a. One uncached keyboard attempt did not navigate and is excluded
from timing summaries, but remains a baseline functional failure. Earlier exploratory runs with
different harness behavior are not combined with the final public comparison.

The owner selected localhost for authenticated measurements. Those use isolated test auth, Core/D1,
and the same test data for old/new Web, without real providers. The final ready-state comparison pins Core to c9775b1b and waits for network idle on both builds,
then starts timing after focus setup. Earlier immediate-post-load runs included hydration/focus work;
one pinned run measured catalog 310 -> 900 ms and remains an interaction-readiness concern.
Other exploratory runs with concurrently changing Core are excluded from the final pair.

| Authenticated localhost scenario | Before median / p75 | After median / p75 | Result |
| --- | --- | --- | --- |
| Catalog, ready-state input to useful content | 162 / 162 ms | 150 / 155 ms | 7.4% median improvement; 30% target unmet |
| Admin product preview | 96 / 117 ms | 168 / 175 ms | 72 ms median regression |

Every measured local transition preserved the document. Five samples per scenario are lab evidence,
not a statistical attribution of small server/runtime differences. The slower Admin result remains
an acceptance gap; there is no production rollout.

## Remaining acceptance

Final staged image transformation, runtime health, matched public timings and frozen-Core
authenticated localhost results are pending. Existing commerce/provider activation gaps remain
independent of HSPA. No production rollout or real provider transaction is authorized here.
