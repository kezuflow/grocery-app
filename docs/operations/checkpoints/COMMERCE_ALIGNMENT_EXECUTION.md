# Commerce alignment — active checkpoint

## Rules and code audit remediation — CA-7.RULES-AUDIT-1 (2026-10-04)

Request: fix the owner-supplied `FreshMarkets_Rules_and_Code_Audit-1.md` findings F01–F13. Active plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**, affected Phase 6 delivery and Phase 5 Scheduled operations. Implementation sequence: payment recovery, truthful cycle notice, operational examples, current criteria, historical context, distinct acceptance evidence.

Acceptance: trusted Scheduled cutoff survives fresh payment, incomplete-checkout projection, Orders validation/storage and resumed QR view; Core current eligibility is checked before normal QR creation/renewal; an issued unexpired QR survives recovery; existing capture/freeze/refund safeguards pass. Notices use Core's option and cutoff without an unconfirmed next-week promise. F03–F13 current guidance is internally coherent, retained compatibility/evidence is explicit, and older records remain accessible. Required local tests, aggregate and relevant browser checks execute before commit/push. Provider acceptance is separate.

Started on clean `main` at `c835d988c07bf8df384220f056330c09a9bde42c`, the audit's revision; no tracked/untracked partial work. Caller path: Orders -> Web incomplete-checkout endpoint -> Core read -> saved payment action -> checkout QR page -> PayMongo SDK. Core's payment-status read now supplies current generation eligibility. No deployment, real payment/refund/courier transaction, outbound message, secret/configuration change or destructive remote operation is authorized by this request. Protected discussion, damaged historical implementation-status bytes and existing retained data are preserved. No agents delegated or personal settings changed.

Current progress: source/guidance remediation implemented and verified locally. Core focused payment tests **46/46 across 4 files**; fulfillment/delivery **102/102 across 5 files**; Web focused **40/40 across 3 files**. The first Web run exposed two fixed-copy assertions, replaced by actual custom-cutoff/available-week assertions. New Scheduled entry rejection initially exposed older fixture helpers starting retired picking; they now seed already-started retained preparation while keeping cancellation, goods conservation, race and provider assertions. D1 revision triggers contribute to fixture update metadata; the helper validates positive updates rather than assuming exactly one total change. Final affected suites pass. Initial Markdown scan could not decode the known damaged historical file and then missed URL decoding; corrected read-only scan finds **0 broken non-archive relative targets**. Previous checkpoint content is fully preserved (newline-normalized equality). The final aggregate includes the latest fixture and passes workspace types.

Managed browser acceptance passed **7/7** with `E2E_START_STACK=1`, `E2E_AUTHENTICATED=1`, `E2E_STATE_NAME=e2e-rules-audit-20261004`. Command: `pnpm --filter @freshmarkets/web exec playwright test tests/scheduled-payment-resume.spec.ts tests/storefront-payment-return.spec.ts`. Desktop and mobile viewport tests covered saved cutoff, early closure, issued QR preservation/expiry and zero new provider requests; the payment-return scenario passed. The state directory did not exist before setup and is disposable for this task. The managed stack stopped; port 3100 has no listener. These are executed Web/Core/local-D1 checks with test integrations and intercepted PayMongo HTTP, not actual provider acceptance. No Core suites overlapped this stack. `pnpm --filter @freshmarkets/web check:vinext` passed: 16 supported, 0 partial, 0 issues.

The first `pnpm check` failed on one stale Web test requiring the Maps runbook to deny service-area polygons. The assertion now requires the approved Global-area gate, separate location pins and all server APIs while retaining security checks; its focused suite passed 3/3. The final `pnpm check` passed (exit 0): Core **1,772/1,772 across 218 files**, Web **737/737 across 168 files**, shared-package **27/27 across 16 files**, harness **38/38**, formatting/conventions, migrations/integrity, architecture/security, lint, workspace types and all workspace builds. Core/mobile-api builds were Wrangler dry-runs; that initial implementation request did not deploy. Vinext emitted plugin-timing/route-classification notices and generated Wrangler configuration warnings, without failure. F08's SDK-action duration was subsequently resolved by the owner release follow-up below; the 60-minute constant remains unchanged.

Audit disposition at finding level:

| Finding | Remediation / remaining decision |
| --- | --- |
| F01 | Core cutoff projection and current generation decision, Orders recovery, issued-QR preservation and browser guards implemented and tested. |
| F02 | Notices render the actual selected cycle cutoff and available-week guidance. |
| F03 | Current Scheduled packing/purchase guidance reconciled; new legacy picking entry rejected, retained started work and successful receipt replay tested. |
| F04 | Instant automatic first booking and staff/manual mode documented distinctly. |
| F05–F07 | Maps Global area/API restrictions and environment-specific courier setup examples corrected; no operational configuration applied. |
| F08 | Four clocks and late-refund behavior reconciled; the 2026-10-04 owner release follow-up retains the 60-minute SDK action separately from settlement and confirmation. |
| F09–F12 | QR-only new checkout, fixed parcel envelope, retired additions, approved feature/retention exceptions reconciled. |
| F13 | Active checkpoint shortened; original checkpoint and completed dispatch-plan bytes preserved in explicitly historical files; misleading current-looking references corrected. |

Initial implementation count: **12/13 findings addressed**; F08's SDK-duration decision remained open until the owner release follow-up below. This does not complete overall Phase 7 provider/journey acceptance.

Implementation and local acceptance for `CA-7.RULES-AUDIT-1` were committed/pushed in `73012f44`. The owner release follow-up below resolves F08 and authorizes deployment; overall commerce Phase 7 remains open.

## Owner release follow-up — CA-7.RULES-AUDIT-1.RELEASE (2026-10-04)

Request: after the payment-timing recommendation, the owner instructed **Commit push and deploy**. Retain the existing 60-minute SDK action, 30-minute maximum issued QR and existing editable one-hour default cutoff-to-procurement gap (30 minutes QR plus approximately 30 minutes delayed-confirmation buffer). PRODUCT records the decision; no application constant or retained cycle date needs changing. **13/13 audit findings now addressed at source/guidance level**, distinct from actual-provider acceptance.

Started on clean `main` at `73012f44078f91fa0e71031db89805e548dc0fd8`, equal to `origin/main`. Active plan remains `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, **Phase 7 — Complete journeys and activation evidence**. Acceptance: commit/push the timing record, build the production Web artifact, verify Core/Web production targets and binding freshness, deploy the paired tested source, then confirm production health/readiness, 100% versions and read-only browser views. No provider transaction, outbound test message, credential rotation or retained-data mutation is included.

Production preflight: authenticated account has one available account; latest deployments were selected by creation time (Wrangler lists oldest first). Current Core `d9f36097-6bc5-4373-9d2e-6aec62b8e2e4`, Web `15e71f51-91c0-430f-aef8-fcabfc0ae36c`, both 100%, match the recorded baseline. `wrangler d1 migrations list freshmarkets-core-production --config wrangler.jsonc --env production --remote` reports no migrations to apply. Both `wrangler types ... --check` commands and `node scripts/verify-worker-readiness.mjs` pass. Existing application acceptance above applies to unchanged source `73012f44`; this follow-up changes documentation only.

Production packaging/pre-release acceptance passed: `CLOUDFLARE_ENV=production pnpm --filter @freshmarkets/web build`; generated `apps/web/dist/server/wrangler.json` is flattened to production, with the `freshmarkets.ph` Custom Domain and production Core `CoreEntrypoint` binding. `pnpm --filter @freshmarkets/core exec wrangler deploy --config wrangler.jsonc --env production --dry-run` and `pnpm --filter @freshmarkets/web exec wrangler deploy --config dist/server/wrangler.json --dry-run --strict` passed. Current remote plain-text variables match production source, required secret names exist without reading values, and resource bindings match the intended production resources. `pnpm naming:check`, `pnpm terminology:check` and `git diff --check` passed for the documentation follow-up.

Pre-release Core `/health`, Core `/ready` and Web `/api/core-health` pass HTTP 200, production environment, structured JSON, valid UUID request-reference echo and runtime/database/PayMongo adapter readiness. The initial use of the local smoke helper failed its request-reference equality: it generates a non-UUID identifier, which the current production boundary correctly replaces. Read-only Node fetch assertions were rerun with `crypto.randomUUID()` and all three passed; no application check was weakened or application code changed.

Timing/release scope committed and pushed as `62b047da`. Production Core deployed successfully as `282c5a08-3bd6-44ca-b04c-3da67ae13b86`; its post-deploy `/ready` passed before Web deployment. Production Web deployed successfully as `4058d9d7-bdab-43bb-8aa5-082261e9ded1` using the reviewed generated artifact. Both strict deploy commands exited 0. Fresh `wrangler deployments list --json` responses, sorted by `created_on`, confirm those versions at **100% traffic**. Post-release Core `/health` and `/ready`, Web `/api/core-health` and public home all pass HTTP 200; JSON probes confirm production environment, matching UUID request references and ready runtime/database/PayMongo adapter. The read-only smoke assertions are retained locally as `.wrangler/rules-audit-production-smoke.mjs`.

Fresh in-app browser verification passed: Storefront rendered category rails and actual catalog; authenticated Orders showed its filter controls and empty All view; Needs payment finished loading with **No checkouts need payment**. The temporary verification tab was closed. This is read-only deployed rendering/read acceptance; there was no real QR creation/payment/refund/courier transaction, and no missing test Order was recreated. Local synthetic recovery acceptance remains the seven executed tests above.

Executed release commands (from repository root; `CLOUDFLARE_ENV=production` was set in PowerShell for Web build):

```text
pnpm --filter @freshmarkets/core exec wrangler deploy --config wrangler.jsonc --env production --strict --message "Production release 62b047da: rules audit and Scheduled payment recovery"
pnpm --filter @freshmarkets/web exec wrangler deploy --config dist/server/wrangler.json --strict --message "Production release 62b047da: rules audit and Scheduled payment recovery"
pnpm --filter @freshmarkets/core exec wrangler deployments list --config wrangler.jsonc --env production --json
pnpm --filter @freshmarkets/web exec wrangler deployments list --config wrangler.jsonc --env production --json
node .wrangler/rules-audit-production-smoke.mjs
```

`CA-7.RULES-AUDIT-1` source/guidance remediation and `CA-7.RULES-AUDIT-1.RELEASE` deployment/readiness acceptance are complete: **13/13 findings addressed**, **2/2 production Workers released**, distinct from full Phase 7 acceptance. Next action: perform owner-authorized actual Scheduled QR/payment/refund and courier journeys against an owner-controlled Order to close the existing provider acceptance gaps.

### Executed verification commands

All checks apply to the intended working-tree source based on `c835d988`; application/test edits were finalized before the final aggregate run. Subsequent edits reconcile documentation and this receipt only.

```text
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/list-customer-incomplete-checkouts.integration.test.ts src/orders/application/get-checkout-payment-completion.integration.test.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts src/scheduling/jobs/scheduled-late-capture-refunds.integration.test.ts
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/complete-scheduled-week.integration.test.ts src/fulfillment/application/cycle-goods.integration.test.ts src/procurement/application/scheduled-counted-receipts.integration.test.ts src/orders/application/cancel-order.integration.test.ts src/admin/application/delivery-provider-operations.integration.test.ts
pnpm --filter @freshmarkets/web exec vitest run test/app/checkout/checkout-client.test.tsx test/app/orders/page.test.tsx test/components/payments/paymongo-payment.test.tsx
pnpm --filter @freshmarkets/web exec vitest run lib/core-client/security-boundary.test.ts
pnpm typecheck
pnpm --filter @freshmarkets/web check:vinext
pnpm check
git diff --check
```

The focused commands passed 46, 102, 40 and 3 tests respectively. The successful final aggregate output is retained locally in `.wrangler/rules-audit-check-final.log`. After the last guidance edits, `pnpm terminology:check`, the read-only Markdown scan and `git diff --check` passed. Browser command/environment and outcome are recorded above. Read-only inline Python compared each archived original to `git show HEAD:<original-path>` after newline normalization and checked active Markdown relative file targets (fenced examples, archives/history, anchors and remote URLs excluded); both preserved originals match and there are zero broken targets. No claims about remote URLs/anchors, deployed restrictions or real providers follow from those checks.

## Current deployed baseline and open acceptance

Production release revision is now `62b047da` (application remediation source `73012f44`; the later commit records timing/release scope only). Core version `282c5a08-3bd6-44ca-b04c-3da67ae13b86`; Web version `4058d9d7-bdab-43bb-8aa5-082261e9ded1`; verified at 100% traffic, production migration 0110 remains current with no pending migration, health/readiness and read-only browser views passed. Previous production application `aa76ca37` and release evidence `c835d988` remain in history. Scheduled courier admission and payment-recovery fixes are released; no actual post-fix booking/payment/refund is accepted. Mandatory Admin reason-field simplification remains a separate unimplemented request.

Earlier Phase 7 actual payment/refund/courier and complete-journey acceptance remains open. Mobile source has local checks but no native-device/provider/production acceptance. The owner-controlled deleted test Order cannot supply booking evidence. Counts and exact prior commands are preserved in the linked history; this shorter checkpoint does not close earlier gaps.

## Evidence history

- [Latest releases, previous requests, slice receipts and open-obligation mapping through 2026-10-04](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20261004.md) — preserves the previous active checkpoint verbatim below a historical-status header.
- [Earlier commerce execution history](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md).
- [Continuation authority and environment boundaries](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md).

Do not restart completed work from history. Read only evidence needed for the current request.
