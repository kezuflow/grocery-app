# Verification skill self-test

The generated skill completed its own launch, read-only doctor, one mapped user feature, evidence capture, and cleanup on 2026-10-12. The final run completed at 20:08 Asia/Manila. This is local Web/Core browser evidence.

## Tested scope

The final run used branch `codex/mobile-pr-plan-verification` with HEAD `64bf34b7410fc7678563df67c8e20f2b05f5af09` and the current uncommitted helper files. `run.json` records the actual changed and untracked path list, including unrelated files that the task preserved. Git HEAD alone does not identify the uncommitted content. No application source was edited for this skill.

## Executed checks

- `node .agents/skills/verify-freshmarkets/scripts/run.mjs` exited zero. Playwright executed one catalog-search test against the built Web application and local auxiliary Core Worker with migrated disposable D1.
- The live doctor verified that the Windows listener descended from the run owner and that `/api/core-health` returned Core status `ok`, environment `development`, configured D1 binding, and contract version `2026-08-30.cart-reliability`.
- The browser opened `/`, dismissed the welcome announcement, submitted `strawberry` through the visible Search groceries form, and observed Baguio Strawberries without Native Garlic. It then submitted `zzznothing`, observed No groceries found, and verified Browse all groceries.
- `node --test .agents/skills/verify-freshmarkets/scripts/doctor.test.mjs` passed both tests. They use actual disposable Windows listeners to check ownership, a closed port, and an unrelated manifest owner.
- `python C:/Users/reggi/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/verify-freshmarkets` passed.
- `pnpm exec oxfmt --check .agents/skills/verify-freshmarkets/scripts` passed for all five scripts.
- After teardown, `node .agents/skills/verify-freshmarkets/scripts/doctor.mjs .wrangler/verify-freshmarkets/c24686bc-a953-4673-a5d3-ec68e92b038d/run.json` rejected the stopped instance with exit 1 and `Listener is not owned by this verification run`.

## Evidence and cleanup

Final local evidence lives in `.wrangler/verify-freshmarkets/c24686bc-a953-4673-a5d3-ec68e92b038d`. This ignored directory is local proof, not a committed artifact or a transferable provider receipt.

The directory retains `run.json`, `doctor.json`, `results.json`, `stdout.log`, `stderr.log`, `cleanup.json`, and `stopped-doctor.log`. Its `browser/proof-catalog-search-through-the-customer-search-field` directory retains `actions.json`, `trace.zip`, and before-search, matching-results, and empty-results screenshots and ARIA snapshots. The matching and empty-state screenshots were visually inspected.

All 14 required run and browser proof artifacts were checked after cleanup. The success receipt reports `listenerStopped=true`, `disposableStateRemoved=true`, `evidencePreserved=true`, and `exitCode=0`. Port 3187 has no retained listener. The owned directory `apps/core/.wrangler/e2e-verify-c24686bc-a953-4673-a5d3-ec68e92b038d` is absent.

An earlier browser run passed but its no-listener PowerShell check returned exit 1 before cleanup completed. The helper was corrected to report a free port without throwing. That exact disposable state was removed after the port was verified free, and its evidence was retained. The regression tests and final complete rerun cover the correction. Independent review also required waiting for child `close` and completed log writes before recording preserved evidence.

## Remaining acceptance

The welcome gallery, first-visit cart carryover, and customer account recipes were inspected but not executed in this task. Search's direct query URL and phone header entry points remain unexecuted. This self-test does not accept every mapped feature.

Native Expo launch, device interaction, native authentication, push, QR handling, real Maps, delivered email, payment-provider acceptance, deployment, and private distribution remain unavailable or unexecuted. The mobile foundation PR must extend and prove the native gate against actual source and installed builds. The search proof made no commerce writes or real provider transactions.
