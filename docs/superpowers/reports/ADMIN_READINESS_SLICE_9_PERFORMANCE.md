# Admin and Platform Readiness Slice 9 Performance Evidence

Recorded 2026-08-30. Browser performance was explicitly removed from the API/business-logic release
gate. This report preserves the optional future UI optimization scope without implying a blocker.

## Measurement status

No LCP, INP, CLS, or network-trace thresholds are required for the approved Admin API and business
logic readiness decision. Functional browser, accessibility-state, service-binding, authorization,
command, and persistence checks remain mandatory and pass in the final readiness report.

Chrome DevTools tracing is not configured in the current Codex session. It is not needed for this
release decision because no browser performance claim is being made.

## Available evidence

- The deterministic Playwright stack builds Web, migrates local D1, and runs Web plus Core through
  the production Service Binding topology on port 3100.
- Authenticated functional tests exercise real list and operational routes with an application-owned
  Staff identity; mocked tests remain only for controlled rendering/pagination edge cases.
- `verify-worker-readiness.mjs --probe-local` can validate structured health/BFF envelopes when a
  stack is running, but it is not a performance measurement.

## Optional future measurement

Configure a local `chrome-devtools` MCP server using `npx -y chrome-devtools-mcp@latest`. Then
capture cold-load traces, interaction traces, network requests, and accessibility snapshots for
representative Admin routes when UI optimization work is authorized. Record browser/build versions
and measured values here; the results are diagnostic rather than a prerequisite for API correctness.
