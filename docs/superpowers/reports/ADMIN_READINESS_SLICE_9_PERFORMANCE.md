# Admin and Platform Readiness Slice 9 Performance Evidence

Recorded 2026-08-29. This report intentionally separates build/renderability evidence from browser
performance measurements.

## Measurement status

| Route / surface                         |         LCP |         INP |         CLS | Status  |
| --------------------------------------- | ----------: | ----------: | ----------: | ------- |
| Admin list (`/admin/customers`)         | unavailable | unavailable | unavailable | BLOCKED |
| Admin detail (`/admin/staff/:staff-id`) | unavailable | unavailable | unavailable | BLOCKED |
| Procurement (`/admin/procurement`)      | unavailable | unavailable | unavailable | BLOCKED |
| Receiving (`/admin/receiving`)          | unavailable | unavailable | unavailable | BLOCKED |
| Fulfillment (`/admin/fulfillment`)      | unavailable | unavailable | unavailable | BLOCKED |
| Delivery (`/admin/delivery`)            | unavailable | unavailable | unavailable | BLOCKED |
| Analytics (`/admin/analytics`)          | unavailable | unavailable | unavailable | BLOCKED |

Chrome DevTools MCP tracing is not configured in the current Codex session. Under the Web
Performance skill, missing trace tooling is a hard measurement blocker. A successful Vinext build,
route discovery, or Playwright functional run is not substituted for LCP, INP, CLS, request-chain,
or accessibility-trace evidence.

## Available evidence

- The deterministic Playwright stack builds Web, migrates local D1, and runs Web plus Core through
  the production Service Binding topology on port 3100.
- Authenticated functional tests exercise real list and operational routes with an application-owned
  Staff identity; mocked tests remain only for controlled rendering/pagination edge cases.
- `verify-worker-readiness.mjs --probe-local` can validate structured health/BFF envelopes when a
  stack is running, but it is not a performance measurement.

## Unblock procedure

Configure a local `chrome-devtools` MCP server using `npx -y chrome-devtools-mcp@latest`. Then
capture cold-load traces, interaction traces, network requests, and accessibility snapshots for
every route above. Record browser/build versions and measured values here before changing this gate
from BLOCKED.
