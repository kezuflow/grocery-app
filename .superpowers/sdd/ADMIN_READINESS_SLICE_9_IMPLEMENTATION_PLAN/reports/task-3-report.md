# Task 3 report — Security and Web/Core boundary assurance

## Status

Complete. Added deterministic Web/Core boundary regression tests and a tracked-source security verifier. Hardened Web request forwarding to an explicit approved allowlist, while Core continues returning the existing fail-closed envelopes.

## Commit

`test(readiness): verify Web Core security boundaries`

Scoped review follow-up: excluded the verifier itself from tracked source
matching so its detector regex cannot report itself as a CORS finding. The
exception is exact and leaves all other production source/configuration files
scanned.

Final review follow-up: `requestHeaders` now forwards an explicit allowlist
(`cookie`, origin/referer, user-agent, accept/content-type, and request/correlation IDs). Authorization, forwarding, and unknown browser headers are covered as stripped by regression tests. The auth proxy remains on its separate faithful header path.

## Files

- `apps/web/lib/core-client/security-boundary.test.ts`
- `apps/web/lib/core-client/request.ts`
- `apps/web/app/api/admin/readiness-security.test.ts`
- `apps/core/src/readiness/security-boundary.integration.test.ts`
- `scripts/verify-readiness-security.mjs`

## Verification

- Web focused Vitest: 2 files, 8 tests passed.
- Core focused Worker integration test: 1 file, 3 tests passed.
- `node scripts/verify-readiness-security.mjs`: passed.
- Web typecheck: passed.
- Core typecheck: passed.
- Touched-file `oxfmt --check`: passed.
- `git diff --check`: passed.

The boundary tests cover cookie/request metadata forwarding, stable Web error envelopes for unauthenticated, missing-capability, out-of-scope, and malformed cases, Core unauthenticated/malformed denial, and DTO health non-disclosure. Existing Core authorization integration tests remain the source of capability and location-scope coverage.

## Static verifier policy

The verifier scans tracked source/configuration for high-confidence credential patterns, direct Web D1/schema imports, general CORS headers, and production Wrangler configurations using mock providers or loopback origins. Narrow documented exceptions are generated Web worker types and test fixtures; the verifier reports these exclusions every successful run. It does not suppress production source findings.

## Concerns

- The existing auth-email transport limitation remains unchanged and continues to gate authenticated browser journeys.
- The previously identified Slice 7 non-atomic operations/audit transaction concern remains parked with its owning operational command refactor.
- The repository’s unrelated `docs/superpowers/plans/DOORDASH_REFERENCE_FRONTEND_PLAN.md` edit was preserved.
