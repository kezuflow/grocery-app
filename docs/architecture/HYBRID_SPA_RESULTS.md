# Hybrid SPA execution evidence

Plan: [HYBRID_SPA_IMPLEMENTATION_PLAN.md](HYBRID_SPA_IMPLEMENTATION_PLAN.md).
[Raw measurements](hybrid-spa-measurements.json) include both staged runs, the rollback, cached
revisits, and local exploratory/ready-state pairs. The [active checkpoint](../operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md)
retains execution state.

## Outcome and slice status

HSPA-0 through HSPA-5 are implemented and verified in main commits 5e237183 and 7efacb4f.
HSPA-6 verification, deployment and measurement were executed; **rollout acceptance remains open**.
Both staged builds were rolled back because the desktop LCP non-regression gate was not met.
The final active staging Web is the prior compatible baseline; the implementation remains on main.
No production deployment, schema migration or real provider transaction was performed by this task.

The implementation retains vinext and the two-Worker boundary. It provides a persistent storefront
layout, SSR catalog bootstrap, native-history JSON catalog navigation, scoped query caching,
shared accepted cart state and targeted checkout/account/Admin Products invalidation. Core continues
to authenticate, authorize and execute business operations. Session replacement clears private state
and reloads to replace private server props. Scope changes immediately hide stale records, actions
and portaled dialogs while retaining uncertain image/price command recovery identities.

Responsive WebP banners, a 4,924-byte brand asset replacing its 89,198-byte rendered source,
lazy address-editor code and hashed-asset cache rules are implemented. The second staged build
prioritized the three initially visible desktop banners after LCP diagnostics identified a delayed
second banner. Desktop/mobile visual inspection showed complete, sharp banners and stable layout.

## Verification and preservation

Work started on main at c9775b1b. Existing location/map/schedule/time-input edits were excluded.
Concurrent owner commits a63b5b9c (staging provider configuration), b76165ae (quotation reuse), and
adca01ad (checkout fee display) were preserved. The final Web build includes adca01ad's picker
interface; this task deployed no Core code or provider configuration.

- Isolated intended-change `pnpm check` passed on the c9775b1b Core baseline: 137 Web files / 557
  tests, 205 Core files / 1,665 tests, package tests, all aggregate checks and both Worker builds.
- Final integrated Web typecheck, 137 files / 560 tests and build passed after scope/recovery fixes
  and the concurrent checkout interface integration. The bounded priority correction passed all
  three banner tests and a further clean staging build.
- Both `wrangler types ... --check` commands, `vinext check` (16 supported, zero issues), and
  `node scripts/verify-worker-readiness.mjs` passed. Final root format/naming/typecheck passed.
- All 17 selected browser cases passed across corrected runs: five hybrid navigation cases, ten
  Admin catalog cases and two desktop/mobile lost-response checkout releases. They cover touch,
  keyboard/drag, Back/Forward/search/reload, shell identity, deep-entry status, scoped Admin
  create/edit/media/price/selling journeys, denial and stable release retry identity. Tests use
  disposable local Core/D1 and mock providers. Stale selectors were corrected to actual controls
  and authoritative media/price state; explicit local operating hours fixed an incomplete fixture.
- The root aggregate remains blocked by an unrelated harness expectation that staging delivery
  selectors are disabled after a63b5b9c enabled them. The isolated aggregate did not include that
  configuration or subsequent Core quotation changes. Do not call the current main aggregate green.

## Deployment and rollback

| State | Web version | Code |
| --- | --- | --- |
| Baseline and final active staging | 402f12e4-ffef-4813-854c-c5f0157548bb | fc763e7b |
| First HSPA deployment, rolled back | 83768065-b400-46ca-979a-07032400e7a1 | 5e237183 |
| Banner correction, rolled back | d9b49692-c4dd-4386-aa18-1516274fd35e | 7efacb4f |

Core stayed at 730f486c-8188-4e20-bb3e-01183d99020a. Both Web builds used a clean checkout and
`CLOUDFLARE_ENV=staging`; generated configuration targeted freshmarkets-web-staging, the private
freshmarkets-core-staging binding, Images and normal server routing with no static SPA fallback.
Core health/readiness and Web `/api/core-health` returned 200. Category deep entry returned 200,
24 server-rendered articles, a page title and `no-store, must-revalidate`. A real banner derivative
returned `image/webp`, a variant-specific ETag and 26,138 bytes. Actual public cache headers showed
14,400 seconds despite the application helper's 300-second setting; the edge cache policy requires
follow-up. Personalized HTML remained no-store. No zone cache settings were changed.

The first run's desktop LCP median was 3,148 ms against 2,528 ms baseline. Diagnostics identified
the second visible banner loading late at low priority. The correction reduced this to 2,692 ms,
but observed p75 still regressed, so staging was restored to the baseline at 100% traffic. Core and
database state were not rolled back.

## Matched public results

Five valid samples per profile, same Windows host, isolated Headless Chrome 152, DPR 1 and fresh
contexts with browser HTTP cache disabled. Desktop: 1440×900, unthrottled. Mobile: 390×844, CPU 4×,
150 ms latency, 1.6 Mbps down and 750 Kbps up. The existing anonymous location-prompt dismiss
preference permits keyboard input. CDN cache temperature and network/server variability are
uncontrolled. One baseline keyboard attempt did not navigate; it is excluded from timing summaries
but retained as a functional failure. Earlier differently instrumented probes are not combined.

Values below are **median / nearest-rank p75**, before → corrected staged build. They are lab
statistics, not field Core Web Vitals or INP. These results describe the rolled-back implementation.

| Metric | Desktop before → after | Mobile before → after |
| --- | --- | --- |
| LCP | 2,528 / 2,640 → 2,692 / 3,240 ms | 4,936 / 5,024 → 4,212 / 4,292 ms |
| FCP | 1,156 / 1,244 → 1,568 / 1,596 ms | 3,244 / 3,300 → 3,444 / 3,444 ms |
| TTFB | 803 / 825 → 985 / 989 ms | 884 / 1,137 → 1,083 / 1,105 ms |
| Transferred bytes | 9,413,685 / 9,413,735 → 1,463,016 / 1,463,088 | 8,957,745 / 8,957,764 → 1,040,588 / 1,040,832 |
| Input-to-feedback | 913 / 947 → 15 / 16 ms | 1,092 / 1,105 → 56 / 65 ms |
| Uncached useful content | 921 / 952 → 830 / 831 ms | 1,121 / 1,134 → 882 / 889 ms |
| CLS | 0.000106 / 0.000713 → 0.000713 / 0.000713 | 0.001173 / 0.001173 → 0.001173 / 0.001173 |
| Long tasks | 0 / 0 → 0 / 0 | 3 / 3 → 3 / 4 |

Transfer medians fell 84.5% desktop / 88.4% mobile. Uncached navigation improved 9.9% / 21.3%,
below the 30% target. Mobile LCP improved 14.7%; desktop median/p75 regressed 6.5% / 22.7%.
TTFB also increased, so these samples do not establish that all LCP change is caused by client code.
Both LCP medians remain above 2.5 seconds. CLS remains far below 0.1.

All valid measured transitions preserved the document and shell, with zero document requests.
After interactions issued exactly one catalog JSON request. Median total RSC requests were 5 → 5
desktop and 3 → 1 mobile; counts include independent product-link prefetch, not duplicate catalog
bootstrap. A targeted browser assertion independently verified one uncached catalog read and no
initial/deep-refresh duplicate. Cached revisit measurements on the first HSPA build were 12 / 12 ms
desktop and 46 / 47 ms mobile, with zero catalog reads and no page errors, meeting the 200/300 ms target.
The banner-only correction does not change that navigation implementation.

## Authenticated localhost results

The owner chose localhost for authenticated measurements. The final pair pins Core to c9775b1b,
uses old Web fc763e7b and HSPA Web 5e237183 against the same isolated data, waits for network idle
on both builds, then starts input timing after focus setup. Five samples per scenario; every
transition preserved the document. No real provider calls were made.

| Scenario | Before median / p75 | After median / p75 |
| --- | --- | --- |
| Catalog ready-state input to useful content | 162 / 162 ms | 150 / 155 ms |
| Admin product preview | 96 / 117 ms | 168 / 175 ms |

Catalog improved 7.4%, below 30%; Admin preview regressed by 72 ms median. Earlier immediate-post-load
pinned samples measured catalog 310 → 900 ms; that timer includes focus/hydration work and remains
an interaction-readiness concern, not a result to hide. Other exploratory runs with concurrently
changing Core are excluded from the final matched pair. Small lab samples are not a causal
attribution of server/runtime differences. Authenticated staging was not measured.

## Open acceptance obligations

Counting level: six implementation slices (HSPA-0–HSPA-5) complete; one rollout slice (HSPA-6)
executed but not accepted. Four HSPA acceptance groups remain:

1. Desktop LCP/FCP non-regression and mobile LCP ≤2.5 s; investigate media request timing and
   Web/Core TTFB with matched warm/cold edge traces before another staging rollout.
2. Uncached catalog ≥30% improvement and the authenticated Admin/immediate-readiness regressions.
   Cached navigation and feedback targets passed; required fresh Core reads remain authoritative.
3. Authenticated staging/session-replacement/provider-protocol acceptance remains unexecuted;
   localhost was the owner-selected substitute for this run. Existing commerce/provider gaps remain
   separate, and no real transaction was authorized.
4. Reconcile the pre-existing root staging-binding harness and the observed public edge cache TTL
   override; verify deployed immutable hashed-asset headers on the next accepted staging build.

Next action: profile the remaining uncached entry/read delays against the preserved baseline,
then repeat the rollout gate. Main contains the implementation; staging intentionally retains the
known-good baseline. No production promotion is implied.
