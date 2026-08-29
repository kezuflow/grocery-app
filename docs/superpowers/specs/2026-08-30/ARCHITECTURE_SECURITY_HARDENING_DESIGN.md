# Architecture and Security Hardening Design

**Program:** Full Codebase Remediation — Program 3  
**Priority:** Maintainability and launch hardening  
**Scope:** Core RPC composition, contracts, dependency enforcement, Web request boundaries, headers, request correlation, observability, and dependency hygiene

## Objective

Reduce change collisions and make architectural/security rules executable while preserving one Core Worker, one Web Worker, Service Bindings, and the existing bounded contexts.

## Coordination prerequisite

This program starts only after the active Admin Dashboard and Maps work has landed. The remediation worktree is rebased or its commits are replayed onto the new `main` before editing shared entrypoint, contract-barrel, Web shell, or checkout files. Integration resolves behavior deliberately; no in-flight admin/maps code is overwritten.

## 1. Core RPC composition

`CoreEntrypoint` remains the single named WorkerEntrypoint exposed through the Service Binding. Its implementation is divided into bounded-context transport adapters:

```text
apps/core/src/entrypoint/
  auth-rpc.ts
  catalog-rpc.ts
  customer-rpc.ts
  membership-rpc.ts
  checkout-rpc.ts
  payments-rpc.ts
  orders-rpc.ts
  operations-rpc.ts
  admin-rpc.ts
  scheduling-rpc.ts
  validation-errors.ts
```

Each adapter:

- validates its purpose-built request schema;
- resolves session/customer/staff context through shared application context ports;
- performs capability/scope checks at the boundary;
- supplies typed dependencies and time;
- calls one application command/query; and
- returns a purpose-built DTO.

Adapters contain no SQL or domain transition logic. `apps/core/src/index.ts` constructs the context/dependencies, forwards public methods to adapters, implements `fetch`/`scheduled`, and exports the WorkerEntrypoint. No microservice, new Worker, Durable Object, Queue, KV namespace, or public business HTTP API is introduced.

## 2. Contract decomposition and conformance

The shared contract package will remove production type definitions from its legacy barrel. Bounded-context files are authoritative; `index.ts` becomes exports plus only intentionally temporary compatibility aliases.

Core receives a compile-time conformance test against `CoreServiceBinding`. Web keeps one isolated cast for Cloudflare's opaque generated Service Binding type only if current Wrangler cannot emit named RPC methods. The cast is documented and paired with a contract test that instantiates/inspects the actual Core entrypoint surface.

Target services may no longer advertise unimplemented methods. A method moves into the target interface and `CoreServiceBinding` in the same change that implements and tests it. Compatibility types are removed once repository search proves no caller remains.

## 3. Executable dependency boundaries

A repository script parses TypeScript imports and fails when it finds:

- Web importing Core source, D1/Drizzle infrastructure, or domain implementation modules;
- contracts importing Worker, D1, Drizzle, schema, or app implementation types;
- domain modules importing application, repository, transport, or provider-adapter modules;
- application modules importing Web or transport entrypoints;
- non-Payments contexts importing provider identifiers or provider adapter types except through approved Payments ports;
- entrypoint adapters executing SQL; or
- raw database rows exported through shared contracts.

The script uses repository-owned rules and Node's parser or TypeScript compiler API already present in the toolchain; it does not add a heavyweight architecture framework unless the simple implementation cannot reliably parse current imports. Existing content scans are retained for vocabulary constraints but no longer serve as the primary layer-direction proof.

## 4. Bounded request-body handling

Web and Core will share small body-reading helpers appropriate to each deployment:

```ts
readBoundedText(request, { maxBytes, contentTypes }): Promise<Result<string>>
readBoundedJson(request, schema, { maxBytes }): Promise<Result<T>>
```

The helper:

- rejects a declared `Content-Length` over the route limit before reading;
- reads the stream incrementally and aborts when the byte limit is exceeded;
- validates allowed content type;
- distinguishes malformed body (`400`), unsupported media (`415`), and oversized body (`413`); and
- never logs body contents.

Route-specific limits are constants owned by the route family. Auth proxy and payment webhooks receive conservative limits sufficient for supported providers. Ordinary Web JSON command routes migrate from unbounded `request.json()` to the helper. Webhook signature verification continues to receive exact raw bytes/text after bounded reading.

Auth response serialization remains bounded by the expected Better Auth response limit. If Cloudflare RPC/fetch support allows preserving all cookie and redirect semantics through a Service Binding fetch handler, the implementation may stream the auth response; otherwise the bounded DTO transport remains.

## 5. Web security-header baseline

The global Web header policy will include:

- `default-src 'self'`;
- an implementation-compatible nonce/hash-based `script-src` without `unsafe-eval` in production;
- a narrowly scoped style policy required by the current CSS stack;
- `object-src 'none'`;
- `base-uri 'self'`;
- `frame-ancestors 'none'`;
- `form-action 'self'` plus explicitly approved OAuth/payment origins when required;
- existing Mapbox image/connect/worker sources supplied by the Maps program;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `X-Content-Type-Options: nosniff`;
- a least-privilege `Permissions-Policy`; and
- HSTS in deployed HTTPS environments, preferably at Cloudflare edge configuration when deployment policy owns it.

Development allowances are explicit and do not leak into production. Tests inspect representative HTML and API responses for headers and ensure OAuth/payment redirect flows remain functional.

## 6. Request correlation and structured observability

Every Web route computes one request ID, passes exactly that ID to Core, returns it in the response header, and includes it in safe structured errors. Invalid inbound IDs are replaced with a generated UUID. Core preserves the ID across command, provider adapter, reconciliation, scheduled job, and audit/domain-event logs.

Observability configuration is environment-specific:

- development/test prioritize local diagnostics;
- preview/staging retain enough logs/traces for acceptance;
- production sampling is configured explicitly and may retain 100% of financial error/outcome events through application logging without globally sampling every successful request.

No log contains cookies, authorization values, action tokens/URLs, webhook bodies, provider payloads, password/reset/verification links, or precise address snapshots.

## 7. Security and operational controls

Repository/deployment documentation will define edge controls for public auth, password reset, address search, checkout payment initiation, and provider webhook endpoints. Rate limiting and WAF policy remain Cloudflare deployment concerns rather than new business state in KV/D1. Application idempotency and signature verification still protect correctness when edge controls are bypassed or retried.

Health and readiness separate concerns:

- liveness proves the Worker can respond;
- readiness performs bounded checks of required configuration/bindings without exposing secrets;
- provider readiness reports configured adapter/capabilities, not merely an environment string; and
- deployment acceptance verifies Web-to-Core Service Binding, D1, R2/media, email, auth cookies, OAuth callback/origin behavior, and cron registration.

## 8. Dependency and generated-type hygiene

- Resolve the vulnerable transitive esbuild path through an upstream upgrade or compatible override and retain the audit command in verification.
- Update Wrangler/Cloudflare types together after their release notes and compatibility behavior are verified.
- Regenerate Worker configuration types from Wrangler; do not hand-edit generated declarations.
- Keep compatibility dates current through a deliberate tested update, not an automated blind bump.
- Lint warnings in production code are fixed or explicitly justified; the desired completion state is zero errors and zero actionable warnings.

## Verification and acceptance

- `apps/core/src/index.ts` is a small composition/transport surface; context-specific validation/authorization lives in named adapters.
- Static dependency checks fail on seeded forbidden imports and pass the repository.
- Contract conformance covers every exposed RPC method.
- Oversized/malformed/media-type request tests cover auth, payment webhooks, and representative JSON routes.
- CSP/security-header tests and browser auth/redirect acceptance pass.
- Request-ID tests prove one generated ID reaches Core and returns to the browser.
- Security audit reports no known moderate-or-higher production dependency finding, or an owner-approved documented exception with compensating controls.
- Core/Web builds, vinext compatibility, typecheck, lint, complete tests, and relevant Playwright suites pass.
