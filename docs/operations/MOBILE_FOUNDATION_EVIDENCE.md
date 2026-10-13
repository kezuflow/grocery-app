# Mobile foundation evidence

Task `MOBILE-20261012.1.FOUNDATION` uses phase **Establish the native workspace and verification path** in `docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md`.

Source implementation is on `codex/mobile-foundation`, against trunk `9b1b59cc8fb0ebe1e6374bc760cee8c82237410f`. [PR 5](https://github.com/kezuflow/grocery-app/pull/5) is open and non-draft. Full acceptance remains blocked. This PR is available for source review and is not merge-ready.

| Gate                      | Executed evidence                                   | Result                                                                                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native behavior           | `pnpm --filter @freshmarkets/mobile test`           | 7 driver tests and 13 Vitest tests pass. Health fixtures are unit evidence.                                                                                                                                                                                                              |
| Native types              | `pnpm --filter @freshmarkets/mobile typecheck`      | Pass with Expo-supported TypeScript 6.0.3.                                                                                                                                                                                                                                               |
| Expo compatibility        | Explicit development origin, `expo install --check` | Pass with Expo 57.0.28, Router 57.0.26 and development client 57.0.20. Overnight recommended patch changes required a fresh compatibility check.                                                                                                                                         |
| Repository aggregate      | `pnpm check`                                        | Pass at source `79681d20`, with final documentation-only edits during the run. Includes 50 harness, 1960 Core, 812 Web and 20 mobile tests, shared package tests and all builds, including Android/iOS exports. Exit 0. Final documentation formatting, links and diff checks also pass. |
| Web trunk/head            | Isolated real Web/Core browser runs                 | Catalog search passes on trunk `9b1b59cc` and head `2bd4cf40`. Selected-location prices pass on trunk `9b1b59cc` and head `55b80d99`. Admin scope navigation passes on head `55b80d99`. No native equivalence claimed.                                                                   |
| Android journey/perf      | Actual native commands at `79681d20`                | Both exit 1 before driving because Maestro is absent. No device or installed native build is available.                                                                                                                                                                                  |
| iOS journey/perf          | Actual native commands at `79681d20`                | Both exit 1 because macOS/Xcode is unavailable. iOS timing transport also remains unimplemented.                                                                                                                                                                                         |
| Independent source review | Separate review rounds, inherited settings          | Source verdict passes through `79681d20`. DNS aliases, double launch, default icons, canonical timing origin and Windows CLI execution corrected. Latest dependency review confirms only mobile Expo definitions changed.                                                                |
| Native screenshots/video  | Actual-build review gate                            | Unavailable. No native media generated.                                                                                                                                                                                                                                                  |
| Performance               | Thirty paired Web trials plus native trials         | Not measured. No performance result claimed.                                                                                                                                                                                                                                             |

## Hosted emulator and simulator continuation

The owner paused real-phone checks on 2026-10-13. Hosted emulator and simulator
proof continues; physical compatibility and physical VoiceOver remain deferred.

[Run 38311188514](https://github.com/kezuflow/grocery-app/actions/runs/38311188514)
at `6c84c02a` failed both jobs. Both booted the real local Web/Core backend and
observed its configured D1 binding. Android compiled and installed the development
APK, then failed to reach Metro's launch endpoint. iOS failed before building
because exact simulator version `26.4` was unavailable. No native UI assertion,
screenshot, video or timing measurement passed in this run. Both partial receipts
report successful owned process, port and disposable-state cleanup.

Downloaded receipts and logs remain under `.wrangler/mobile-foundation/ci-38311188514/`.
The aggregate attempt in `check-native-ci-source.log` was interrupted and has no
confirmed result. The earlier aggregate at `79681d20` remains its own passing scope.

The loopback reproduction in `repro-metro-loopback-default.json` observes a Node
server bound to IPv6 `localhost`, with IPv4 refusal. `repro-metro-loopback-ipv4.json`
observes successful IPv4 connections under `--dns-result-order=ipv4first`.
This proves the mechanism; the failed hosted run did not record its socket family.
The correction applies that option only to Metro, disables Expo's standalone
debugger installation with its headless setting, and pins the runner's documented
iOS `26.4.1` runtime. Xcode first-launch setup and expanded readiness/runtime
receipts make the next failure inspectable. Actual native acceptance still needs
the next hosted run.

## Current native proof and uncommitted continuation

[Run 38347896824](https://github.com/kezuflow/grocery-app/actions/runs/38347896824)
at `09d97ae4` fails both jobs. Android passes actual Home, development identity,
backend-origin and connected-state assertions. Its installed APK hash is
`bbf1c4886bea33200e330dcb7362af9aea89b4bb7eed63acaaf3a913e34dbdfb`.
The actual Metro response hash is
`a385c37f00fdf564bbf9a4b658f9341abe374aacc229b8a312b1b3b0cf624502`.
The screenshot and receipts are retained in
`.wrangler/mobile-foundation/ci-38347896824-android/` and the screenshot was shown
in chat. Full navigation stops at Maestro's `stopApp` format error. Its video
records failure, so it does not pass the navigation review gate. Android owned
cleanup completes. iOS also fails. Its retrieved receipt proves successful native
compilation and installation with Xcode 26.4.1/iOS 26.4.1. Its screenshot shows
`Open in “FreshMarkets Dev”?` blocking the owned Metro deep link. Home rendering
and a served iOS bundle remain unproved. All iOS owned cleanup completes.

`check-host-fix.log` and its result JSON record `pnpm check` exit 0 at HEAD
`09d97ae4`. Native corrections were edited during that run. Mobile tests ran
before those edits and report 8 Node plus 13 Vitest tests. Core reports 1960 tests
and Web 812; builds pass. This is not a receipt for the final correction bytes or
the new performance probes. Their final-head aggregate remains due.

Uncommitted corrections address keyboard navigation, asynchronous interruption
cleanup, atomic ADB tunnel acquisition, assertion-only observations and timing
log history/draining. A real POSIX process reproduction observes a surviving
descendant before the cleanup fix and its absence afterward. Windows driver
checks pass 10 tests and skip two POSIX tests. The launch flow now uses literal
`launchApp`; actual Maestro parsing still needs the next native run. Independent
review identified iOS keyboard occlusion. The keyboard controller now encloses
Tabs while preserving screen scrolling and safe areas. TypeScript 6.0.3, focused
lint and formatting pass; fresh independent source review is clean.

The iOS kernel-clock and paired Web performance tools are implemented and have
fresh clean independent source reviews. Caller cancellation reaches the clock trial.
Focused mobile checks pass 27 Node tests and 13 Vitest tests; two POSIX cleanup
checks skip on Windows and run in hosted CI. No macOS compilation, simulator
transport, profile or measured trial receipt exists yet. The next CI run attempts
both installed shell journeys, Android cold trials, one iOS clock smoke and the
paired Web trials. Ordinary Maestro does not prove TalkBack focus
navigation, and Apple does not provide VoiceOver in Simulator. Physical checks
remain deferred under the owner's instruction.

Shell approval review timed out, then failed because its selected model was at
capacity. The read-only GitHub connector recovered job conclusions and logs. Its
iOS ZIP initially could not be fetched into the sandbox. Protected commands later
resumed, and the authorized CLI download retrieved it. Commit/push and another
native run remain pending; no merge or deployment occurred.

## Scope and choices

Five route-owned tabs use shared native layout. The shell reports backend liveness through the existing Web adapter and labels later capabilities unavailable. No price, cart, order or account data is fabricated. Core and Web application source remains unchanged.

Model the Domain selected parsed environment and connectivity states. Prove It Works kept exports, tests and browser proof separate from native acceptance. The throughput checkpoint assigned mobile driver files to one worker and all shared manifests/guards/specifications to root. Two shell worker starts failed at model capacity, so root completed that scope.

The official reference was generated under ignored `.wrangler/mobile-foundation/expo-reference` with `create-expo-app@5.0.0 --template default@sdk-57 --no-install`. Expo's support matrix lists Android 7+, iOS 16.4+ and Xcode 26.4+. This matrix does not prove device behavior or coverage of phones in the Philippines.

## Remaining acceptance work

Install and drive actual Android and iOS development builds. Verify all ten live lanes, including text size, safe areas, TalkBack/VoiceOver, disconnected backend and reduced motion. Compare two shell arrangements with actual-build screenshots. Prove iOS timing transport. Collect the required warmups and thirty trials for the named Web/native scenarios. Record installed binary and served JavaScript identities. Capture the 30 to 60 second actual-build video. Only then can Foundation be accepted and later dependent slices start.

No merge, deployment, distribution, provider transaction or outbound customer message occurred.

## Retained local receipts

These ignored artifacts remain in the owner's workspace. They contain actual observations and are not uploaded to the PR.

- `.wrangler/mobile-foundation/check-final.log` retains the initial Windows bundle-launch failure. The corrected export invokes Expo's resolved Node CLI directly; an executed temporary Windows command proves argument handling. `build-retry.log` records all builds passing after that fix. `check-complete.log` records the passing pre-patch aggregate. `check-sdk57-patch.log` records the SDK patch rerun.
- `.wrangler/mobile-review/MOBILE-20261012.1.FOUNDATION/web-trunk/` and `web-head/` contain catalog search actions, screenshots, traces and cleanup receipts.
- `.wrangler/mobile-foundation/price-head/` and `price-trunk/` record passing real welcome dismissal, selected-location category and literal `₱179.00` price assertions, screenshots, traces and successful cleanup. Copies remain under the mobile review directory.
- `.wrangler/mobile-foundation/browser-additional/` retains the passing Admin navigation trace and the failed existing Storefront test. That test did not dismiss the welcome dialog, so its product heading was hidden from accessibility queries. The corrected journey uses the real close control without changing application code or the existing test. This failure is retained rather than counted as a pass.
- `.wrangler/swarm/MOBILE-20261012.1.FOUNDATION/android-journey-2026-10-12T21-00-53-578Z-1124d82f/` and `android-perf-2026-10-12T21-00-56-827Z-eb00f510/` retain failed Android manifests.
- `.wrangler/swarm/MOBILE-20261012.1.FOUNDATION/ios-journey-2026-10-12T21-01-00-149Z-4aec7afb/` and `ios-perf-2026-10-12T21-01-03-854Z-1d66e793/` retain failed iOS manifests.

The native manifests record the source SHA and documentation-only working-tree scope. Their `unavailable` device argument is a missing prerequisite, not an observed device identity. Bundles do not attest installed binaries or the JavaScript served to a device.

The implementation count is **1/12 started, 0/12 accepted**, under five parent phases. Hosted Android API 34 and macOS/iOS runners are available. The next action is to push the reviewed corrections and execute the hosted shell, clock and paired Web proof jobs, then complete the remaining simulator accessibility, layout, timing and media gates. Dependent mobile slices remain unstarted.
