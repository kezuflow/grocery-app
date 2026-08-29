# Admin and Platform Readiness Slice 9 Performance Evidence

Recorded 2026-08-29 from the Slice 9 working tree. These are repository-native
measurements only; they are not production latency claims.

## Measurement method

| Route / surface | Environment | Sample size | LCP | INP | CLS | Evidence |
|---|---|---:|---|---|---|---|
| Marketplace home (`/`) | local build command | 1 build | unavailable | unavailable | unavailable | `pnpm --filter @freshmarkets/web build` completed; no browser trace was available |
| Admin context (`/admin`) | local build command | 1 build | unavailable | unavailable | unavailable | Vinext compatibility/build completed; authenticated render requires local auth email |
| Admin Analytics (`/admin/analytics`) | local build command | 1 build | unavailable | unavailable | unavailable | Route included in the Web build; authenticated data path requires local auth email |
| Operational queue (`/admin/operations`) | local build command | 1 build | unavailable | unavailable | unavailable | Route included in the Web build; authenticated data path requires local auth email |

Chrome DevTools MCP is unavailable in this session, so LCP, INP, and CLS were
not measured. A local Worker probe is available through
`node scripts/verify-worker-readiness.mjs --probe-local` when the Web/Core
stack is running. It verifies structured JSON and request-reference headers;
it does not claim a latency percentile or production performance.

## Repository-native observations

- Vinext check completed with the current route surface and no compatibility
  issue in the baseline.
- Production Web/Core builds use the existing dry-run/build scripts and are the
  reproducible artifact-size/renderability gate for this slice.
- Core health is a small structured response and does not read business data.
- No cache, queue, projection, new binding, or client-side business work was
  added for readiness. No demonstrated low-risk performance fix was warranted
  by the available measurements.

## Follow-up measurement

When a local stack and browser tooling are available, capture at least three
cold and three warm navigations for each surface, record the browser/build
version, and attach route-level Core timings from structured logs. Keep
production measurements separate from this local evidence.
