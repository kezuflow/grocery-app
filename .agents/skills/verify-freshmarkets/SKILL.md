---
name: verify-freshmarkets
description: Verify FreshMarkets Web customer journeys against an isolated local Web/Core Worker and D1 stack with Playwright. Capture user actions, resulting state, and cleanup evidence. Use for changed browser behavior and mobile prerequisites; native Expo acceptance remains unavailable until apps/mobile exists.
---

# Verify FreshMarkets

Read [the feature index](features/README.md), then the affected recipe. Use [ENGINEERING verification requirements](../../../docs/architecture/ENGINEERING.md#choose-checks-by-risk) for the remaining checks. This skill adds browser proof; it does not replace Core integration tests or the repository aggregate.

## Launch

Run from the repository root on Windows with Node 24+, pnpm 11, installed workspace dependencies, and Playwright Chromium.

```powershell
node .agents/skills/verify-freshmarkets/scripts/run.mjs
```

The helper uses the existing managed Playwright configuration. It builds Web, applies retained migrations to a fresh `apps/core/.wrangler/e2e-verify-<run UUID>` directory, and launches Web with its auxiliary Core Worker. It refuses an occupied port 3187 or an existing state directory. It uses Core's test configuration and disables the provider gateway. Do not overlap a managed browser stack with Core suites or another Web build in this checkout.

The evidence directory prints before launch. Playwright waits for port 3187; the doctor additionally requires an owned listener and the real Web-to-Core health response. The helper then drives catalog search and tears the stack down. A successful run exits zero and prints `Cleanup complete. Evidence preserved at ...`.

## Doctor

The generated test runs this read-only check before browser actions. While the run is live, rerun it against the printed directory's `run.json`.

```powershell
node .agents/skills/verify-freshmarkets/scripts/doctor.mjs .wrangler/verify-freshmarkets/<printed-run-UUID>/run.json
```

Use the actual path printed by launch. The doctor checks that the Windows listener descends from the run's owner PID, then reads `/api/core-health`. Require `service=core`, `status=ok`, `environment=development`, a string contract version, and a configured database binding. This is liveness and instance identity, not payment readiness or authentication acceptance. It must fail after cleanup.

## Drive

The launch helper executes [catalog search](features/catalog-search.md) with a fresh unsigned browser. It uses the visible search input, presses Enter, and proves matching and empty results against the real Web/Core catalog. It does not inject catalog responses or set product state.

For another mapped feature, use the existing managed harness with a new disposable state name. Its exact spec and grep appear in each recipe. Keep port 3100 for authenticated fixtures because their managed cookie origin is fixed there. Before launch, require that port to be free. Do not enable `E2E_PROVIDER_GATEWAY` unless a separately authorized provider-event test requires it.

```powershell
$env:E2E_START_STACK = '1'
$env:E2E_STATE_NAME = 'e2e-verify-' + [guid]::NewGuid().ToString()
$env:E2E_PORT = '3100'
$env:E2E_PROVIDER_GATEWAY = '0'
pnpm --filter @freshmarkets/web exec playwright test tests/e2e/first-visit-cart.spec.ts --grep 'first visit, remembered location and guest carryover at 390px' --trace on
```

The last command is the cart recipe, not a universal test command. Existing fixtures may arrange synthetic state through local D1 and authorized Admin APIs. Record this setup separately from the user actions. Do not attribute a simulated provider response, Maps result, or email adapter to the real provider.

## Evidence

The generated search run saves evidence under ignored root `.wrangler/verify-freshmarkets/<run UUID>`. It records Git HEAD, branch, and the actual changed and untracked path list in `run.json`, process ownership and real Core health in `doctor.json`, command output in `stdout.log` and `stderr.log`, and executed results in `results.json`. The browser directory contains a Playwright trace, before-and-after screenshots, ARIA snapshots, and `actions.json` with the feature ID and entry point. `cleanup.json` records teardown and exit status.

For existing specs, artifacts go to ignored root `.wrangler/playwright-results`. Preserve them under a unique evidence directory before a later Playwright run overwrites that directory. Keep traces for action chronology. Add screenshot and ARIA evidence when the existing spec does not capture the changed state. Read committed mutation results through the public query or an explicit read-only local D1 assertion. Search is read-only and has no business write to prove.

Evidence can contain authentication or personal data in other journeys. Use only synthetic local fixtures, inspect captured content, and redact before sharing. Never copy credentials, customer details, signed attachment URLs, or raw provider payloads into committed reports.

## Cleanup

The search helper waits for Playwright's managed teardown. It stops only an owned residual listener by PID, confirms port 3187 is free, and removes its uniquely named state directory. It preserves the evidence directory. After either success or failure, inspect `cleanup.json` and confirm `run.json`, `results.json`, and browser artifacts still exist.

For manually invoked existing specs, Playwright tears down the server. Identify the selected state directory from the current run, resolve it to a direct child of `apps/core/.wrangler`, confirm the owned process is stopped, then remove only that disposable directory with PowerShell `Remove-Item -LiteralPath`. Restore or remove only environment variables set by that run. Never remove default or retained state, kill by process name, or delete proof artifacts.

If launch is interrupted or cleanup fails, inspect the recorded owner PID and Windows listener ancestry before stopping a process. Report the failed cleanup and preserve its evidence. Do not reset unrelated state to make the next run pass.

## Native gate

Foundation adds `apps/mobile` and real-driver command definitions. Its device runs remain unproved. Web at a phone viewport is browser evidence, not Expo, iOS, Android, native OAuth, QR handling, push, or device acceptance. Do not report this gate passed from unit tests or bundle exports.

Read [the actual mobile command and evidence instructions](../../../apps/mobile/README.md).
Run `pnpm --filter @freshmarkets/mobile doctor` with the explicit platform, device
and isolated origins documented there, then `verify:journey`. Android and iOS need
installed development builds. The runner retains manifests, actions and results
and fails on unavailable prerequisites. iOS performance transport remains unavailable.
These definitions require actual both-platform proof before they become proved recipes.

The mobile foundation PR must extend this skill using the actual Expo package scripts, app identifier, development-build installation, test account, and device automation available at that revision. Prove its launch, read-only doctor, one real customer journey, action/result artifacts, and owned cleanup on Android and iOS. Mark unavailable devices or signing prerequisites explicitly. Add native feature recipes only when their selectors and commands work against the installed app.

## Helpers and maintenance

- `scripts/run.mjs` launches, drives, captures evidence, and cleans the owned search run.
- `scripts/doctor.mjs` accepts the live run manifest path and prints a read-only JSON assessment.
- `node --test .agents/skills/verify-freshmarkets/scripts/doctor.test.mjs` checks live-listener ownership, the free-port regression, and rejection of an unrelated owner.
- `scripts/playwright.config.cjs` adapts the maintained repository configuration without replacing its build or Worker topology.
- `scripts/proof.spec.cjs` drives the catalog search recipe. Invoke it through `run.mjs`.

Use [maintain-verification-skill](../maintain-verification-skill/SKILL.md) when features or test entry points change. The [self-test record](references/self-test.md) distinguishes the executed recipe from unexecuted maps.
