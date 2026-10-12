# Run the mobile foundation

The foundation uses Expo SDK 57 and Expo Router. The official reference scaffold
was generated with `create-expo-app@5.0.0 --template default@sdk-57 --no-install`.
Its native dependency baseline, Router entry point and strict Expo TypeScript base
establish this workspace's scaffold. Current patch versions follow `expo install --check`.
Template demo content and its separate Web target are omitted.
The existing FreshMarkets website remains the Web client.

Expo SDK 57 supports Android 7 and later and iOS 16.4 and later, per
[Expo's SDK 57 matrix](https://docs.expo.dev/versions/v57.0.0/).
Begin native smoke tests on an Android API 34 emulator with pinned Maestro 2.11.0.
Exercise the minimum Android API 24 on a separate compatible runner and a newer
API 36 device before claiming broad phone compatibility. Maestro support on those
device versions must be proved rather than assumed. iOS needs macOS and Xcode 26.4
or later. Device coverage and minimum-version runtime acceptance remain open.

The customer shell contains Home, Search, Cart, Orders, and Account. These tabs show their actual foundation state. Catalog search, commerce, authentication, and payments are not implemented by this slice.

Install the workspace with `pnpm install --frozen-lockfile`. Run these checks from the repository root.

```powershell
pnpm --filter @freshmarkets/mobile test
pnpm --filter @freshmarkets/mobile typecheck
pnpm --filter @freshmarkets/mobile build
```

`build` exports Android and iOS JavaScript bundles to ignored `.wrangler/mobile-bundles/`. It explicitly selects the development identity and local Web origin. An export does not prove an installed native build.

## Configure and install the development build

Set both public configuration values before running Expo. The application rejects missing configuration. Development uses `ph.freshmarkets.customer.development` and callback scheme `freshmarkets-development`. Private beta uses `ph.freshmarkets.customer.beta` and `freshmarkets-beta` with an explicit isolated HTTPS backend.

For an Android emulator, use its host loopback mapping to the isolated Web server. The Web backend forwards Core health through `/api/core-health`. Keep the browser fixture origin at `localhost:3100`.

```powershell
$env:EXPO_PUBLIC_APP_VARIANT = 'development'
$env:EXPO_PUBLIC_BACKEND_ORIGIN = 'http://10.0.2.2:3100'
pnpm --filter @freshmarkets/mobile exec expo run:android --device
pnpm --filter @freshmarkets/mobile dev
```

On macOS, use an available iOS simulator and the host loopback origin. Run `expo run:ios --device` from the mobile package. Select the development build in the Expo development client. Keep Metro running while driving that build. Expo Go cannot satisfy the installed application identity check.

Use the existing isolated Web/Core verification recipe in [verify-freshmarkets](../../.agents/skills/verify-freshmarkets/SKILL.md). The driver checks the actual Web-to-Core health boundary and its configured D1 binding. This checks Core liveness. It does not execute a database query or prove commerce readiness. The existing isolated backend boot recipe must remain owned by the lane that launched it. Shared staging, production, provider calls, and distribution are outside this local verification recipe.

## Check native prerequisites and drive the shell

Install [Maestro CLI 2.11.0](https://github.com/mobile-dev-inc/maestro/releases/tag/cli-2.11.0) and Java 17 or later. The [official installation guide](https://docs.maestro.dev/maestro-cli/how-to-install-maestro-cli) covers Windows, macOS, and Linux. The runner rejects another Maestro version. This pin is source verified. Device compatibility remains unproved until an actual run passes.

Select one booted Android device or emulator by its `adb devices` ID. iOS requires macOS, Xcode, and a booted simulator UDID. Physical iOS driving is unavailable in this runner.

Supply the application origin and the same Web origin as seen from the host. Run the read-only preflight before driving.

```powershell
pnpm --filter @freshmarkets/mobile exec node scripts/doctor.mjs --platform android --device emulator-5554 --backend-origin http://10.0.2.2:3100 --backend-host-origin http://127.0.0.1:3100
pnpm --filter @freshmarkets/mobile verify:journey --platform android --device emulator-5554 --backend-origin http://10.0.2.2:3100 --backend-host-origin http://127.0.0.1:3100
```

Replace the example IDs and origins with the actual owned local instance. For iOS, select `--platform ios`, the booted simulator UDID, and its reachable local Web origin. The driver verifies the installed development package, build hash, Core liveness and D1 binding configuration, and the app's displayed backend origin. It drives tab changes, the search keyboard, and relaunch through semantic controls. It fails when a prerequisite or assertion is missing.

The Android retry lane uses a development build configured with `http://127.0.0.1:3100`. Keep that device port free of existing ADB reverse mappings. The runner first proves that the device cannot reach the backend. It then creates its own ADB reverse mapping, presses **Retry connection**, and proves the healthy state against the real backend.

```powershell
pnpm --filter @freshmarkets/mobile verify:journey --platform android --device emulator-5554 --backend-origin http://127.0.0.1:3100 --backend-host-origin http://127.0.0.1:3100 --lane retry
```

`--lane network-off` asserts the unavailable state on an already disconnected device. The host backend remains healthy for preflight. The runner does not change device Wi-Fi or replace responses. For the retry lane, cleanup removes only its own tunnel. Every drive stops only the development application and preserves device and business data.

## Capture cold-start evidence

Run the Android performance command against the same fixed healthy backend and installed development build.

```powershell
pnpm --filter @freshmarkets/mobile verify:perf --platform android --device emulator-5554 --backend-origin http://10.0.2.2:3100 --backend-host-origin http://127.0.0.1:3100
```

The probe runs five warmups and thirty measured cold process launches. It observes [Android logcat monotonic timestamps](https://developer.android.com/tools/logcat) for the native Activity launch and the app's semantic readiness marks. The shell mark follows native layout and an animation frame. The backend mark follows successful Core health presentation. Maestro independently asserts the actual rendered Home and backend state in every trial.

The probe reports native launch to rendered shell and launch to connected customer state separately. It retains JavaScript initialization elapsed time separately from native startup. Maestro startup and execution time are excluded. Device log transport delay and development-client configuration can affect observations and require a native-capable runner audit before trusting a measured result. Missing marks, repeated process identities, failed renders, and unavailable backends fail the gate. The proposed p95 budgets are 1000 milliseconds for native shell readiness and 5000 milliseconds for the connected customer state.

iOS timing transport is unavailable and exits with failure. Thirty alternating paired trunk/head Web baseline trials remain a separate gate in [the mobile PR plan](../../docs/operations/MOBILE_PR_PLAN.md). Do not compare native startup with the Web baseline as a speedup ratio.

## Inspect the run evidence

The `Mobile foundation installed shell` GitHub Actions workflow runs on pushes to
`codex/mobile-foundation`. It builds and installs the development application on
an Android API 34 emulator and an iOS 26.4 simulator with Xcode 26.4.1. Each job owns
its local Web/Core backend, migrated D1 state, Metro process and device session.
`scripts/run-native-ci.mjs` drives the existing ready and shell journeys, including
cold relaunch, and records screenshots, video, installed binary hashes and the
actual Metro bundle response hashes. The conditional Metro capture preserves the
response bytes. It is disabled outside the explicit evidence session.

The workflow uploads partial evidence even on failure. A passing workflow proves
only the named installed-shell journey on those device versions. It does not prove
performance, all accessibility lanes or commerce. The owner paused real-phone
checks on 2026-10-13; continue with emulators and simulators. Physical-phone
compatibility and physical VoiceOver acceptance remain deferred.

Each journey or performance run prints its unique directory under `.wrangler/swarm/MOBILE-20261012.1.FOUNDATION/`. Its manifest records the Git SHA, working-tree scope, host, platform, device, installed build hash, backend origins, outcome, and cleanup. Maestro writes action arguments, JUnit results, diagnostic logs, and screenshots beside that manifest. Performance adds raw timing records for every completed trial.

The current Windows environment has no proved Android driver, device, or installed build, and cannot execute iOS. Native live lanes, physical-phone acceptance, both-platform timing, design comparison screenshots, and the required 30 to 60 second actual-build review video remain blocked. Safe areas, maximum text size, TalkBack, VoiceOver, and reduced motion require actual device observations. Unit tests and bundle exports cannot check those boxes. No native screenshots or video have been fabricated.
