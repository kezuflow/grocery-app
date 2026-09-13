# Hybrid SPA route and measurement inventory

Execution plan: `HYBRID_SPA_IMPLEMENTATION_PLAN.md`, HSPA-0.
Source baseline: `c9775b1bfca0a549bf9f2a939a5b96bdda494182` (main).
Staging baseline application: `fc763e7bd654a19a155edf26a9de367f1497b000`;
Web `402f12e4-ffef-4813-854c-c5f0157548bb`, Core `b21e15d5-c3a9-464a-a3c1-b34dfe31c599`.
The table inventories the preimplementation paths. Implemented ownership is recorded in
[ARCHITECTURE](ARCHITECTURE.md); final measured revisions and results are recorded in
[HYBRID_SPA_RESULTS](HYBRID_SPA_RESULTS.md), including the concurrent staging Core change.

| Route family | Entry/read owner | Shell and navigation |
| --- | --- | --- |
| `/`, query/category URLs | Server marketplace composite; `/api/catalog` -> Core catalog search for cursor reads | Storefront; category framework links, original header GET search forms |
| `/products/[slug]` | Server Core product query and metadata | Storefront; framework links |
| `/cart` | Cart client -> Web cart handler -> Core; guest transfer retains existing command rules | Storefront; drawer and badge share accepted cart events before migration |
| `/checkout`, `/checkout/payment` | Cart, checkout bootstrap, fulfillment, quote/payment handlers -> Core | Storefront; payment provider redirects deliberately retain document navigation |
| `/account`, `/account/profile`, `/account/addresses`, membership payment | Authorized server queries and profile/address command handlers | Storefront; profile local accepted DTO and auth refresh, address list reload |
| `/orders`, detail, transaction summary | Authorized Core order reads; command components | Storefront; cancellation originally reloads document, payment amendment redirects remain protocol boundaries |
| `/pantry`, `/alcohol`, `/meat-seafood`, `/retail`, `/health`, `/serviceability` | Existing server content or Core-backed serviceability interaction | Storefront |
| `/admin/**` | Core bootstrap/current scope; named same-origin Admin queries/commands | Existing Admin layout/context/overview/theme; preserve unfinished location files |
| `/auth/**`, invitations, `/setup` | Existing authentication handlers and server redirects | Deliberate standalone family; OAuth callbacks and session-clearing redirects may reload |
| `/api/**`, `/media/**`, unknown paths | Route handlers and existing not-found behavior | No static SPA fallback |

All storefront families above move beneath `app/(storefront)/layout.tsx` without URL changes.
The root retains maps runtime configuration and owns one mounted browser query provider.
Core continues to own current identity, scope and every business decision/write.

Broad refresh inventory: storefront read-error retry, delivery-location change, Admin category save.
Full document inventory: auth redirect completion, storefront/Admin sign-out, checkout sign-in
continuation, payment handoffs, order amendment payment, cancellation reload. Protocol/session
boundaries remain explicit; ordinary reads and accepted edits migrate to targeted refreshes.

## Matched lab procedure

Run `apps/web/scripts/measure-hybrid-spa.mjs` with `HSPA_OUTPUT` set to an absolute JSON path.
`HSPA_ORIGIN` defaults to the authorized staging origin `https://freshmarkets.ph`.
Use the same script before and after deployment, on this Windows host and Chrome version.
Five fresh isolated contexts per profile; cache disabled; 1440x900 desktop with no throttle,
390x844 mobile viewport with 4x CPU, 1.6 Mbps download, 750 Kbps upload and 150 ms latency.
The anonymous location prompt is dismissed through its existing session preference before loading.
This does not select a location or authenticate a user. No business/provider writes are issued.

Collect entry TTFB/FCP/LCP/CLS, transfer sizes and long tasks, then keyboard category activation
to useful heading, document identity, shell identity and RSC/catalog request counts. Report median
and nearest-rank observed p75 from five valid samples. Request counts include framework prefetch
and must be distinguished from the requested read in targeted browser checks. Native-history
behavior is checked against vinext beta.8's installed navigation shim and executed browser behavior.
Lab timing is not field INP or field CWV. Authenticated and resolved-location profiles require
separate evidence; anonymous samples cannot establish their acceptance.

Discarded probes: the first used the `all` category rather than a category result; the next attempted
keyboard navigation while the first-visit location dialog held focus. Neither is a timing sample.
