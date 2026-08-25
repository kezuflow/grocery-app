# Authentication Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove attacker-controlled auth origins and bearer-URL logging, prove Web/Core cookie and OAuth proxy behavior, and make Better Auth versus application IAM schema ownership explicit without changing database tables.

**Architecture:** Better Auth remains in Core and receives a static environment-derived trusted-origin allowlist. Auth email delivery uses an injected port that never logs bearer URLs; Web proxies auth responses through a tested response-preserving helper. Better Auth schema definitions and application IAM schema definitions become separate modules while retaining the same D1 tables.

**Tech Stack:** Better Auth 1.7.1, Cloudflare Workers Service Bindings, D1, Drizzle ORM, TypeScript, Vitest.

**Spec:** `AGENTS.md`; `docs/architecture/ARCHITECTURE.md` Authentication Architecture and Bounded Context Ownership; `docs/architecture/API_CONTRACTS.md` Authentication Boundary; `docs/product/IMPLEMENTATION_PLAN.md` Phase 1.

## Global Constraints

- Priority: P0 for origin and secret-log defects; P1 for schema ownership separation and complete integration evidence.
- Execute in an isolated clean worktree; do not modify or import the dirty Phase 4C changes.
- Do not change migrations. Existing Better Auth and IAM table names remain intact.
- Never trust request `Origin`, `Host`, `x-forwarded-origin`, or `x-forwarded-host` merely because the browser supplied it.
- Never write verification/reset URLs, tokens, OAuth credentials, session tokens, or raw cookies to logs.
- Production email-provider selection is not an unresolved decision listed by the product, but provider implementation is outside this slice. Production must fail closed when delivery is requested without an injected sender.
- Preserve repeated `Set-Cookie`, redirects, callback parameters, response status, and body across Web/Core.

---

## Dependencies and Decision Blockers

- Depends only on the approved canonical docs/plans being committed.
- May run independently of Plans 02 and 03.
- None of the five unresolved product decisions blocks this plan.
- A production transactional email vendor is a launch configuration task, not a blocker to the security port, redaction, or fail-closed behavior.

## Migration and Compatibility Impact

- Migration impact: none.
- Database compatibility: all existing Better Auth and application IAM tables/columns remain unchanged.
- Runtime compatibility: environments must set `PUBLIC_APP_ORIGIN` on Web and `TRUSTED_ORIGINS` plus `BETTER_AUTH_URL` on Core. Local defaults may include only explicit loopback origins.
- Auth HTTP compatibility: request/response shapes remain compatible; untrusted origins change from accepted to rejected.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Trusted origins | None | None | Dynamic request-derived origins become rejected; configured local origins remain supported | None |
| 2. Email delivery | Task 1 configuration conventions | None | Development uses a redacted sink; production fails closed without a delivery adapter | None |
| 3. Auth/IAM split | None | None; table definitions move between schema modules without changing D1 | Better Auth adapter sees only auth-owned tables; application IAM repositories retain existing IDs | None |
| 4. Auth proxy evidence | Tasks 1–3 | None | Existing route is replaced in place while cookies, callbacks, redirects, and errors remain contract-compatible | None |

## Task Acceptance Matrix

| Task | Acceptance criteria |
|---|---|
| 1. Trusted origins | Production accepts only normalized configured origins and rejects attacker-controlled forwarded/request origins before auth handling |
| 2. Email delivery | No raw verification/reset URL or token reaches production logs; missing production delivery fails closed and development output is redacted |
| 3. Auth/IAM split | Better Auth adapter receives only identity/session/account/verification tables; IAM roles, permissions, staff, and scopes remain application-owned with stable IDs |
| 4. Auth proxy evidence | Cookies, `Set-Cookie`, OAuth redirects/callbacks, CSRF/origin checks, and errors survive Web-to-Core proxying under production-like integration tests |

## Task 1: Static trusted-origin policy

**Files:**
- Create: `apps/core/src/auth/origins.ts`
- Test: `apps/core/src/auth/origins.test.ts`
- Modify: `apps/core/src/auth/service.ts`
- Modify: `apps/core/wrangler.jsonc`
- Modify: `apps/core/src/worker-configuration.d.ts` through `pnpm --filter @freshmarkets/core types`

**Interfaces:**
- Consumes: `AuthEnvironment.BETTER_AUTH_URL`, `AuthEnvironment.TRUSTED_ORIGINS`, `AuthEnvironment.ENVIRONMENT`
- Produces: `parseTrustedOrigins(value: string | undefined): readonly string[]`
- Produces: `trustedOriginsForEnvironment(env: AuthOriginEnvironment): readonly string[]`
- Produces: Better Auth `trustedOrigins` configured from the returned static list

- [ ] **Step 1: Write failing origin-policy tests**

Create tests that assert:

```ts
expect(parseTrustedOrigins("https://freshmarkets.ph, https://admin.freshmarkets.ph")).toEqual([
  "https://freshmarkets.ph",
  "https://admin.freshmarkets.ph",
]);
expect(() => parseTrustedOrigins("javascript:alert(1)")).toThrow("INVALID_TRUSTED_ORIGIN");
expect(
  trustedOriginsForEnvironment({
    ENVIRONMENT: "production",
    BETTER_AUTH_URL: "https://freshmarkets.ph",
    TRUSTED_ORIGINS: "https://freshmarkets.ph",
  }),
).toEqual(["https://freshmarkets.ph"]);
expect(() =>
  trustedOriginsForEnvironment({ ENVIRONMENT: "production", BETTER_AUTH_URL: undefined }),
).toThrow("BETTER_AUTH_URL_REQUIRED");
```

Also assert that a request origin such as `https://attacker.example` cannot be added by any exported function.

- [ ] **Step 2: Run the focused test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/auth/origins.test.ts`

Expected: FAIL because `origins.ts` and its exports do not exist.

- [ ] **Step 3: Implement strict origin parsing**

Implement `AuthOriginEnvironment` and the two exported functions. Accept only `http:` for explicit loopback development origins and `https:` elsewhere; normalize with `new URL(value).origin`; remove duplicates; reject credentials, paths other than `/`, query strings, and fragments. Production returns no implicit origin.

Configure Better Auth as:

```ts
trustedOrigins: [...trustedOriginsForEnvironment(env)],
```

Delete the request-derived `trustedOrigins` callback. Add a development-only `TRUSTED_ORIGINS` value to Core Wrangler configuration and document production as environment configuration, not source default.

- [ ] **Step 4: Regenerate Core binding types and run tests**

Run: `pnpm --filter @freshmarkets/core types && pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/auth/origins.test.ts`

Expected: type generation exits 0 and all origin tests pass.

- [ ] **Step 5: Commit the origin policy**

Run: `git add apps/core/src/auth/origins.ts apps/core/src/auth/origins.test.ts apps/core/src/auth/service.ts apps/core/wrangler.jsonc apps/core/src/worker-configuration.d.ts && git commit -m "fix(auth): enforce trusted origin allowlist"`

## Task 2: Secret-safe authentication email port

**Files:**
- Create: `apps/core/src/auth/email-delivery.ts`
- Test: `apps/core/src/auth/email-delivery.test.ts`
- Modify: `apps/core/src/auth/service.ts`
- Modify: `apps/core/src/observability.ts` only if its metadata typing prevents explicit redaction

**Interfaces:**
- Consumes: `AuthEmailMessage { kind: "verification" | "reset"; recipient: string; url: string }`
- Produces: `AuthEmailDelivery { send(message: AuthEmailMessage): Promise<void> }`
- Produces: `createAuth(env: AuthEnvironment, dependencies?: { authEmailDelivery?: AuthEmailDelivery }): Auth`
- Produces: `UnavailableAuthEmailDelivery` that logs only `{ kind, configured: false }` and throws `AUTH_EMAIL_DELIVERY_UNCONFIGURED`

- [ ] **Step 1: Write failing redaction and fail-closed tests**

Use an injected spy delivery and log spy to assert:

```ts
await delivery.send({
  kind: "reset",
  recipient: "customer@example.com",
  url: "https://freshmarkets.ph/reset?token=secret-token",
});
expect(sender).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining("secret-token") }));
expect(JSON.stringify(logCalls)).not.toContain("secret-token");
expect(JSON.stringify(logCalls)).not.toContain("customer@example.com");
```

Also assert that production without an injected sender rejects with `AUTH_EMAIL_DELIVERY_UNCONFIGURED` and logs neither recipient nor URL.

- [ ] **Step 2: Run the focused test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/auth/email-delivery.test.ts`

Expected: FAIL because the current service logs `data.url` and no delivery port exists.

- [ ] **Step 3: Implement the delivery port**

Move all email delivery behavior from `service.ts` to `email-delivery.ts`. Pass the full bearer URL only to `AuthEmailDelivery.send`; never pass it to `log`. Default nonproduction behavior logs a redacted `auth.email.<kind>.unavailable` event and throws so a missing sender is visible. Tests inject a capture sender directly; production wiring remains fail-closed until a provider adapter is selected.

- [ ] **Step 4: Run focused tests and a secret scan**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/auth/email-delivery.test.ts && rg -n "url:\s*data\.url|token=|auth_email.*url" apps/core/src/auth apps/core/src/observability.ts`

Expected: tests pass; ripgrep returns no production logging match.

- [ ] **Step 5: Commit the email boundary**

Run: `git add apps/core/src/auth/email-delivery.ts apps/core/src/auth/email-delivery.test.ts apps/core/src/auth/service.ts apps/core/src/observability.ts && git commit -m "fix(auth): keep bearer urls out of logs"`

## Task 3: Separate Better Auth schema from application IAM schema

**Files:**
- Create: `apps/core/src/iam/schema.ts`
- Create: `apps/core/src/iam/schema.test.ts`
- Modify: `apps/core/src/auth/schema.ts`
- Modify: `apps/core/src/auth/service.ts`
- Modify: `apps/core/src/auth/authorization.ts`
- Modify: `apps/core/src/index.ts` only for schema imports/database construction

**Interfaces:**
- Produces: `betterAuthSchema = { user, session, account, verification }`
- Produces: `iamSchema = { staffIdentity, customerPrincipal, role, permission, rolePermission, staffRole, staffScope }`
- Better Auth Drizzle adapter consumes only `betterAuthSchema`
- Application authorization and provisioning consume only `iamSchema`

- [ ] **Step 1: Write failing ownership tests**

Assert exact schema keys:

```ts
expect(Object.keys(betterAuthSchema).sort()).toEqual(["account", "session", "user", "verification"]);
expect(Object.keys(iamSchema).sort()).toEqual([
  "customerPrincipal",
  "permission",
  "role",
  "rolePermission",
  "staffIdentity",
  "staffRole",
  "staffScope",
]);
```

The test must also prove no IAM table appears in the object passed to `drizzleAdapter` by exporting a pure `createBetterAuthDatabase(env)` helper or equivalent inspectable composition function.

- [ ] **Step 2: Run the focused test and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/iam/schema.test.ts`

Expected: FAIL because `iam/schema.ts` and `betterAuthSchema` do not exist.

- [ ] **Step 3: Move definitions without changing table names**

Keep `user`, `session`, `account`, and `verification` definitions in `auth/schema.ts`. Move only application-owned table definitions to `iam/schema.ts`. In `service.ts`, construct one Drizzle instance with `betterAuthSchema` for Better Auth and one with `iamSchema` for the idempotent customer-principal provisioning hook. Update authorization and Core imports accordingly.

- [ ] **Step 4: Run ownership and authorization tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/iam/schema.test.ts src/auth/authorization.test.ts src/customer-boundary.integration.test.ts`

Expected: all tests pass with no migration or table-name change.

- [ ] **Step 5: Commit the schema ownership split**

Run: `git add apps/core/src/auth/schema.ts apps/core/src/iam/schema.ts apps/core/src/iam/schema.test.ts apps/core/src/auth/service.ts apps/core/src/auth/authorization.ts apps/core/src/index.ts && git commit -m "refactor(auth): separate application iam schema"`

## Task 4: Response-preserving Web auth proxy and integration evidence

**Files:**
- Create: `apps/web/lib/auth/proxy.ts`
- Test: `apps/web/lib/auth/proxy.test.ts`
- Create: `apps/core/src/auth/auth-flow.integration.test.ts`
- Modify: `apps/web/app/api/auth/[...path]/route.ts`
- Modify: `apps/web/wrangler.jsonc`
- Modify: `apps/web/worker-configuration.d.ts` through `pnpm --filter @freshmarkets/web types`

**Interfaces:**
- Consumes: `proxyAuthRequest(request: Request, core: Pick<CoreServiceBinding, "auth">, publicAppOrigin: string): Promise<Response>`
- Produces: an `AuthRequest` whose forwarded origin is the configured `publicAppOrigin`, never the incoming header
- Preserves: status, body, `Location`, and every repeated `Set-Cookie` header from `AuthResponse`

- [ ] **Step 1: Write failing proxy tests**

Test all of the following:

```ts
expect(forwarded.headers["x-forwarded-origin"]).toBe("https://freshmarkets.ph");
expect(forwarded.headers["x-forwarded-origin"]).not.toBe("https://attacker.example");
expect(response.headers.getSetCookie()).toEqual([
  "session=a; Path=/; HttpOnly; Secure; SameSite=Lax",
  "csrf=b; Path=/; HttpOnly; Secure; SameSite=Lax",
]);
expect(response.status).toBe(302);
expect(response.headers.get("location")).toBe("https://accounts.google.com/oauth/start");
```

- [ ] **Step 2: Run the Web focused test and prove failure**

Run: `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/auth/proxy.test.ts`

Expected: FAIL because the helper does not exist and the route forwards the incoming origin.

- [ ] **Step 3: Implement the proxy helper**

Read `PUBLIC_APP_ORIGIN` from Web environment configuration, validate it as an HTTPS origin outside local development, and pass it to the helper. Copy request headers but overwrite forwarded host/proto/origin from the configured public origin. Reconstruct response headers by appending each tuple so repeated cookies survive.

- [ ] **Step 4: Add Core auth-flow integration cases**

Cover registration/session creation, rejected untrusted origin, logout/session invalidation, reset/verification sender invocation, and Google-provider availability only when both credentials exist. Use the injected email sender; assert no logs contain the captured URL.

- [ ] **Step 5: Run focused and boundary verification**

Run: `pnpm --filter @freshmarkets/web types && pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts lib/auth/proxy.test.ts && pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/auth/auth-flow.integration.test.ts && pnpm --filter @freshmarkets/web check:vinext`

Expected: all commands exit 0.

- [ ] **Step 6: Commit proxy and integration evidence**

Run: `git add apps/web/lib/auth/proxy.ts apps/web/lib/auth/proxy.test.ts apps/web/app/api/auth/[...path]/route.ts apps/web/wrangler.jsonc apps/web/worker-configuration.d.ts apps/core/src/auth/auth-flow.integration.test.ts && git commit -m "test(auth): verify web core auth boundary"`

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/core test && pnpm --filter @freshmarkets/web test`
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`
- [ ] Run: `rg -n "trustedOrigins:\s*async|x-forwarded-origin.*origin|url:\s*data\.url|secret-token" apps/core/src apps/web`
- [ ] Confirm the final ripgrep has no production match and `git status --short` lists only files declared above.

**Acceptance criteria:** untrusted origins are rejected; trusted origins are static/configured; authentication bearer URLs never reach logs; production email delivery fails closed without an adapter; repeated cookies and redirects survive the proxy; Better Auth adapter receives only Better Auth schema; all focused/full gates pass.
