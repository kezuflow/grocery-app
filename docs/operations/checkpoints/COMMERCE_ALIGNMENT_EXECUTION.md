# Commerce alignment execution

Status: in progress, 2026-09-07. Active plan: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, all remaining phases authorized in dependency order.

Workspace: main at observed baseline `619df3c`, following `6daaf3d`. Initial working tree was clean. Existing local/shared databases remain preserved; no migration/reset/deployment performed.

Established: canonical documents already incorporate the agreed target, with explicit historical sections. The Phase 0 design record defines profile fields, closure intake, capabilities and retained-baseline upgrades. Irreversible anonymization and official accounting require factual owner policy; independent implementation can continue. Schema and staff checkpoints are historical evidence, not phase acceptance.

Current slice: Phase 1 Scheduled pay-as-you-go correctness. Removed membership checks from quote creation, pre-payment revalidation, compatibility eligibility and paid commitment. Existing promotion limits, atomic commitment/holds, delivery recovery and staff onboarding are retained. The current Web checkout has no separate membership gate.

Validation: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/checkout/application/instant-quote.integration.test.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts` passed 30 tests. After strengthening payment reachability, the commitment file passed all 16 tests; it reaches real payment initiation/replay and test-provider reconciliation before commitment, with zero physical stock and no subscription. Core typecheck and repository lint passed. `pnpm --filter @freshmarkets/web exec vitest run test/app/checkout/checkout-client.test.tsx test/app/api/checkout/quote/route.test.ts test/app/api/checkout/payment/route.test.ts` passed 15 tests. New test fixture field-path mistakes were corrected without weakening assertions. Aggregate `pnpm check` is still running; the first attempt stopped on formatting, which was corrected.

Acceptance remains open for all phases. Subsequent work: complete Phase 1 evidence/recovery, setup/access, catalog/media/pricing, warehouse, Scheduled allocations, delivery/manual fallback and full retirement/journeys. No browser or provider acceptance has been executed in this task.

Aggregate result: `pnpm check` passed on this application slice: 857 Core tests, 360 Web tests, 68 contract tests, shared/harness suites, conventions, migrations, architecture/readiness, lint/types and both builds. Log: `C:/Users/reggi/.codex/visualizations/2026/09/07/01a07c32-22c4-78a3-b481-1267eb6aca38/commerce-check.log`. Existing Wrangler environment-selection and Web chunk-size notices remain. No browser/provider acceptance or retained-environment upgrade was run.

Next: commit the verified slice on main, then continue setup/access. The current local price command still accepts `catalog.manage` with operational scope; its UI offers the same permission. Dedicated Global price authority remains an identified Phase 2/3 dependency. Keep all remaining authorized phases in scope.
