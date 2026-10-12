# FreshMarkets mobile PR plan

Build the approved customer-only Expo private beta for Android and iOS through twelve reviewable implementation PRs. Customers get Instant shopping, QR Ph, owned Orders, repeat shopping, chat/photos, private feedback, native tracking, and transactional push. Core remains the authority for identity, scope, prices, stock, and every business write.
The five MOBILE-20261012 phase IDs and their twelve child IDs stay stable. PR numbers are assigned when implementation PRs open. This planning PR establishes the program and Web/Core verification skill. It does not create or implement the twelve future PRs.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `.agents/skills/poteto-mode/playbooks/autopilot-stack.md`. Owners build and verify their branches. The root alone manages stack topology. The operator reviews and lands bottom-up. All twelve PRs stop at merge-ready. No owner merges or arms automatic merge. The owner authorized PRs, subagents, and independent review for all repository work on 2026-10-12. Every role inherits the current session model/settings.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Use `.agents/skills/verify-freshmarkets/SKILL.md` for the actual Web/Core baseline. Native driving is unavailable now. Foundation must execute a native driver against real Android and iOS builds before native lanes pass. Run native lanes on both platforms unless explicitly Web or platform-specific. Keep local fake, controlled sandbox, actual provider, physical-phone, and distribution acceptance separate.

## Program checklist

### Arm the program

- [ ] State this protocol and plan to the operator. Start implementation only on an explicit instruction to run the mobile program. This planning PR is not that instruction.
- [ ] Read the current trunk router, checkpoint, owning specifications, and workflow files at program start and every audit tick.
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/autopilot-stack.md`.
  - [ ] `git show origin/main:.agents/skills/swarm/SKILL.md`.
  - [ ] `git show origin/main:.agents/skills/verify-freshmarkets/SKILL.md`.
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/opening-a-pr.md`.
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/shipping.md` and the active PR's routed leaf skills.
- [ ] At program start, establish the audit cadence equivalent to `/loop 1h` through available Codex heartbeat tooling. Recurrence needs its own explicit request. This planning PR creates no automation. Without it, run bounded in-session audits and record the scheduling limitation.
- [ ] Use this tick prompt verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every active owner a zero-writes order immediately.

### Spawn owners

- [ ] Spawn one inherited-model owner per active PR with the Autopilot-stack lifecycle. Use separate managed worktrees and preserve unrelated changes. Run the ten live lanes in bounded waves within available agent capacity.
- [ ] Follow the dependencies below. Foundation is first and branches from `main`. Build dependent PRs on verified parent branches, or wait for required parents to land. An open PR is not accepted behavior.
- [ ] Deliver one linear stack in numbered order. LISTS, CHAT, and TRACKING allow independent investigation after their dependencies are ready. Shared contract/storage files retain one writer per active slice.
- [ ] Hold each PR's file boundaries. The root coordinates shared specifications, migrations, contracts, checkpoint, and verification-skill changes. Two owners never edit the same file or local database state.
- [ ] Hold operator review for all twelve PRs. Save screenshots and a 30 to 60 second video, show them in chat, and stop at merge-ready.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Prefer the built-in PR tool or `gh`. Use `origin pr` only if Origin exists and resolves the repository. Record the choice. Never require `gt`.
- [ ] Create a `codex/` branch and open the PR ready, never draft, per Opening a PR. A stack child targets its parent. Attach every created PR to the chat.
- [ ] Inspect branch/HEAD, status, tracked/untracked work, and caller-to-write path before editing. Keep per-owner decision trails and report the exact code-ready SHA.
- [ ] Run `pnpm lint` and `pnpm typecheck` before PR-facing push with hooks enabled. Run `pnpm check` and relevant executed acceptance before slice completion.
- [ ] Run deslop before commits and no-comments before review. If deslop is unavailable, read and clean the intended diff directly. Apply technical-writing, unslop, TypeScript, and good-css for affected styling. Use shadcn-admin for staff UI.
- [ ] Triage Bugbot/security findings against concrete evidence. Rebase before code-ready reporting and retain that merge base during fixes. Rebase again only for merge preparation, actual conflicts, or trunk-induced CI failures.

### Verdict and merge, for every PR

- [ ] At each code-ready head and patch-changing push, run one gates lane, the ten stated live lanes, one perf lane, and at least two independent audit lanes. Audit commerce integrity/authorization separately from native UX/privacy and receipts. Every role uses `inherit-parent`.
- [ ] Judge progress by committed or observed effects. Replace stalled agents with fresh consolidated briefs. Audit logs, screenshots, database facts, and device/provider receipts before issuing a verdict.
- [ ] Issue clean only when every mandatory lane passes. Missing devices/providers leave acceptance blocked. Continue independent source work without claiming full acceptance.
- [ ] Append only after a clean verdict. Apply Shipping's patch-id rule after rebasing. Rerun CI/mergeability for rewritten pushes. Changed patches require fresh verification. No owner merges, deploys, messages external recipients, or starts live provider transactions.

### Boot recipe, for every live lane

- [ ] Check out the exact head in an isolated managed worktree or native-capable runner. Record SHA, baseline SHA, OS/device, environment, and scenario. Use isolated local D1 state per lane. Authenticated browser fixtures require `localhost:3100`. Serialize these lanes on one host or assign separate hosts at port 3100. The generated catalog proof uses port 3187. Do not substitute arbitrary ports into fixed-origin auth fixtures.
- [ ] Install with `pnpm install --frozen-lockfile`. Follow the generated verification skill's proved Web/Core boot/readiness recipe. For existing browser tests, set `E2E_START_STACK=1` and a unique `E2E_STATE_NAME` beginning with `e2e-`, then run `pnpm --filter @freshmarkets/web test:e2e`. Do not use shared staging for local acceptance.
- [ ] Foundation adds Maestro flows and `apps/mobile/scripts/verify-journey.mjs` plus package command `verify:journey`. The runner selects Android emulator/device or iOS simulator/device, boots the actual build against an isolated backend origin reachable from that device, drives controls, and fails if unavailable. Record emulator/device loopback mapping without changing the fixed-origin browser fixtures. Extend the verification skill after proving both platform runs. These interfaces are planned, not present commands.
- [ ] Drive Web through the verification skill's browser tooling and native through proved Maestro flows. Seed synthetic state only through supported isolated test setup. Read-only Worker/D1 and redacted telemetry may corroborate observations. Never mutate business state through diagnostic shortcuts during journeys.
- [ ] Save screenshots under `.wrangler/swarm/<PR-id>/worker-<lane>/<slug>.png`. Save videos and redacted logs alongside them. Return paths and exact predicates. Provider-fake evidence stays labeled local and cannot check actual-provider lanes.
- [ ] Hold provider/SMS/email effects and distribution until required inputs and authorization exist. The intentionally disabled SMS adapter has no actual SMS-delivery requirement in this beta.

## PR 1. Establish the native workspace and verification path (MOBILE-20261012.1.FOUNDATION)

**Depends on.** None. Approved customer scope and this planning PR.

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected workspace manifests, native naming guards, and native driver. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Add `apps/mobile` to the pnpm workspace with the agreed Expo SDK 57 baseline, Expo Router and TypeScript. Verify supported dependency versions before installation. Provide Home, Search, Cart, Orders and Account, FreshMarkets tokens, safe areas, keyboard handling and genuine empty/error states. Use native components; Web remains the existing website.
- [ ] Integrate native lint, types, tests and local bundle checks into repository commands. Cover Expo route naming in the existing architecture/naming guards with positive and negative fixtures; do not broadly exempt native files.
- [ ] Add development and private-beta build profiles with distinct application identities, callback schemes and backend configuration. Provider secrets never enter the app bundle.
- [ ] Establish reusable native journey scripts and an evidence directory, plus the commands a maintainer runs. A local mock can support tests but cannot impersonate a functioning backend in a beta build.
- [ ] Compare two shopping-shell arrangements within the agreed five-tab navigation, then record the chosen layout and screenshots. This is visual design evidence, not commerce acceptance.
- [ ] Add native `verify:journey` and `verify:perf` commands backed by real driving and semantic timing probes. Record pinned compatible driver dependencies and both platform boot evidence.

**You see.**

- [ ] Open the five-tab shell on both platforms. Observe its accepted state in the actual app and corroborate owned Core facts. All tabs work and no commerce state is fabricated.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for route naming, environment separation, token exposure, and readiness instrumentation. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open the five-tab shell on both platforms. Run this same Web baseline on trunk and head. Open `/` to selected-location categories and current prices. Use `apps/web/tests/e2e/storefront-home.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `shell.png`. Pass when all tabs work and no commerce state is fabricated.
- [ ] Lane 2. Switch Home, Search, Cart, Orders, and Account repeatedly. Save `tabs.png`. Pass when navigation preserves the expected tab without crashes.
- [ ] Lane 3. Open the shell on a small screen with display cutouts. Save `safe-area.png`. Pass when primary controls stay inside safe areas.
- [ ] Lane 4. Use maximum supported accessibility text size on each tab. Save `large-text.png`. Pass when labels and primary actions remain reachable.
- [ ] Lane 5. Focus and dismiss the shell search input. Save `keyboard.png`. Pass when the keyboard never hides its input or blocks navigation.
- [ ] Lane 6. Navigate tabs with VoiceOver and TalkBack. Save `screen-reader.png`. Pass when accessible names and focus order are correct.
- [ ] Lane 7. Close and reopen the development build. Save `relaunch.png`. Pass when a valid shell appears without stale loading indicators.
- [ ] Lane 8. Disconnect the backend and reopen the shell. Save `network-off.png`. Pass when an honest unavailable state and retry appear.
- [ ] Lane 9. Enable reduced motion and navigate. Save `reduced-motion.png`. Pass when transitions respect the setting and remain usable.
- [ ] Lane 10. Use existing Storefront catalog and Admin navigation in the browser. Save `web-regression.png`. Pass when Web routes and visual tokens remain unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for cold launch to interactable shell. Measure this Web baseline on trunk/head separately. Open `/` to selected-location categories and current prices. Isolate native initialization and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 1000 milliseconds p95 or its customer end state above 5000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.1.FOUNDATION/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.1.FOUNDATION/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 2. Connect existing Better Auth accounts (MOBILE-20261012.1.AUTH)

**Depends on.** MOBILE-20261012.1.FOUNDATION

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core auth and Web auth proxy. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Integrate the installed Better Auth Expo client with Core-owned sessions through the existing Web auth proxy. Offer email/password, verification and reset, Google, and Apple on iOS. Preserve existing customer identity and history; a social email or delivery phone is not an independent authorization credential.
- [ ] Store sessions using SecureStore and forward the current authenticated cookie on native API requests using the installed client's supported API.
- [ ] Validate configured callback schemes/origins; preserve browser cookie, forwarding and CSRF behavior. Add only the native-specific proxy handling proved necessary.
- [ ] Clear private queries, pending presentation and device association on logout, revocation or resolved account replacement. Deep-linked Orders still require Core ownership.

**You see.**

- [ ] Sign in to a synthetic existing customer account. Observe its accepted state in the actual app and corroborate owned Core facts. Core resolves the same customer and its history.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for native callbacks, cookie forwarding, CSRF, revocation, account replacement, and foreign Order access. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Sign in to a synthetic existing customer account. Run this same Web baseline on trunk and head. Open owned `/account` to profile and sign-out controls. Use `apps/web/tests/e2e/customer-account-access.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `sign-in.png`. Pass when Core resolves the same customer and its history.
- [ ] Lane 2. Sign in, terminate the app, and reopen. Save `restart.png`. Pass when SecureStore restores the supported session.
- [ ] Lane 3. Submit an invalid password. Save `bad-password.png`. Pass when rejection appears without private account data.
- [ ] Lane 4. Sign in, log out, and revisit Orders. Save `logout.png`. Pass when private queries and authenticated views are cleared.
- [ ] Lane 5. Revoke a fixture session using supported test setup and refresh Orders. Save `revoked.png`. Pass when the app returns to authentication and clears private data.
- [ ] Lane 6. Switch from customer A to customer B. Save `account-switch.png`. Pass when only B history and cache data appear.
- [ ] Lane 7. Complete configured Google login on both platforms. Save `google.png`. Pass when callback returns to the app and Core owns the session.
- [ ] Lane 8. Complete configured Apple login on iOS. Save `apple.png`. Pass when callback returns to the same Core account.
- [ ] Lane 9. Follow an authorized verification/reset callback. Save `reset-return.png`. Pass when the correct auth state appears without claiming unobserved email delivery.
- [ ] Lane 10. Sign in and out through Web. Save `browser-auth.png`. Pass when browser cookie and CSRF behavior remain unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for sign-in to resolved Account. Measure this Web baseline on trunk/head separately. Open owned `/account` to profile and sign-out controls. Isolate native auth/session adaptation and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.1.AUTH/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.1.AUTH/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 3. Prepare phone OTP and optional receipt email (MOBILE-20261012.1.PHONE)

**Depends on.** MOBILE-20261012.1.AUTH

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core auth/customer capabilities and optional contact email. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Prepare Better Auth's phone-number plugin behind a Core-owned `SmsOtpDeliveryPort`. The owner deferred SMS provider selection. Ship the port and phone-flow capability handling; the beta continues to use configured existing login methods.
- [ ] Default phone OTP to unavailable with no provider. Unconfigured send attempts fail honestly before SMS effects; the app does not advertise a working phone login.
- [ ] Use Philippine phone normalization, verified unique identity, bounded resend/attempt limits and expiry. Configure the plugin's six-digit, five-minute, three-attempt defaults. Never log codes or phone numbers.
- [ ] Link a phone only through a currently authenticated account plus OTP verification. Do not auto-link old contact numbers, merge customers by phone, or manufacture email verification.
- [ ] Distinguish internal placeholder identity from optional real contact email. Future phone accounts may check out without email; email delivery requires a real verified destination. Keep in-app notices independent of email delivery and staff verification rules intact.

**You see.**

- [ ] Open Account without an SMS provider. Observe its accepted state in the actual app and corroborate owned Core facts. Phone login is unavailable and existing login works.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for disabled sends, normalization, expiry/resend/attempt limits, phone ownership/linking, optional email, and placeholder suppression. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open Account without an SMS provider. Run this same Web baseline on trunk and head. Open owned profile to verified contact/preferences. Use `apps/web/tests/e2e/customer-profile.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `disabled-phone.png`. Pass when phone login is unavailable and existing login works.
- [ ] Lane 2. Inspect phone-link actions without a provider. Save `disabled-link.png`. Pass when no actionable send-code control appears.
- [ ] Lane 3. Sign in to an existing verified-email account. Save `email-account.png`. Pass when customer identity and verified email remain intact.
- [ ] Lane 4. Open a seeded future-phone-account profile through a local fixture. Save `placeholder.png`. Pass when internal placeholder identity is never shown as real email.
- [ ] Lane 5. Open a controlled fixture with no contact email. Save `optional-email.png`. Pass when the profile renders the absent email honestly.
- [ ] Lane 6. Open an unverified-contact fixture. Save `unverified-email.png`. Pass when the app does not claim the destination is verified.
- [ ] Lane 7. Open a customer with an old address contact number. Save `delivery-phone.png`. Pass when the app never grants phone identity from an address.
- [ ] Lane 8. Switch between verified-email and placeholder fixtures. Save `account-isolation.png`. Pass when contact state never leaks between accounts.
- [ ] Lane 9. Open seeded no-email customer history/notices. Save `in-app-notice.png`. Pass when purchase facts remain readable without an email claim.
- [ ] Lane 10. Use Web staff login with an unverified staff fixture. Save `staff-policy.png`. Pass when existing staff verification restrictions hold.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for open Account to correct capabilities/contact. Measure this Web baseline on trunk/head separately. Open owned profile to verified contact/preferences. Isolate native capability/contact rendering and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 100 milliseconds p95 or its customer end state above 2000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.1.PHONE/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.1.PHONE/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 4. Implement address selection and catalog discovery (MOBILE-20261012.2.DISCOVERY)

**Depends on.** MOBILE-20261012.1.FOUNDATION, MOBILE-20261012.1.AUTH

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core address/catalog and Web browsing context. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Connect Home, Search and product detail to the existing catalog APIs. Include current categories, product galleries, variants, prices, promotions and honest availability. Implement saved-address management and address search/map confirmation with optional foreground location permission.
- [ ] Add a native browsing-context adapter that returns Core's opaque signed token instead of relying on browser-only HttpOnly storage. Pass the bounded native context to catalog reads; Core validates it and selects the location.
- [ ] Preserve service-area, geocoding finalization, recipient, phone and single Delivery instructions rules. Skipping or denying location permission still permits general browsing.
- [ ] Isolate caches by account and browsing context. Display cache data as potentially stale; no cached price, stock or token authorizes checkout.

**You see.**

- [ ] Confirm a serviceable address and open catalog. Observe its accepted state in the actual app and corroborate owned Core facts. Core selects the expected catalog location.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for signed-context tampering, address ownership, deleted defaults, service-area rejection, and cache replacement. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Confirm a serviceable address and open catalog. Run this same Web baseline on trunk and head. Search `/` and open an actual variant. Use `apps/web/tests/e2e/storefront-home.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `catalog.png`. Pass when Core selects the expected catalog location.
- [ ] Lane 2. Search a known produce name and open it. Save `search.png`. Pass when the actual matching product and variant appear.
- [ ] Lane 3. Open a product with multiple images and variants. Save `gallery.png`. Pass when gallery and selected variant reflect current facts.
- [ ] Lane 4. Deny location permission and search an address manually. Save `deny-location.png`. Pass when browsing and manual selection remain usable.
- [ ] Lane 5. Confirm outside-service-area coordinates. Save `outside-area.png`. Pass when Core rejection appears without a replacement location.
- [ ] Lane 6. Open customer B after A saved an address. Save `address-ownership.png`. Pass when B cannot select or read A address.
- [ ] Lane 7. Delete the default address and return Home. Save `default-deleted.png`. Pass when a valid context is requested and no deleted default survives.
- [ ] Lane 8. Choose an address in another served location. Save `context-change.png`. Pass when catalog and cache switch to its signed context.
- [ ] Lane 9. Disconnect after loading catalog. Save `offline-cache.png`. Pass when cached facts are visibly stale and never authorize checkout.
- [ ] Lane 10. Run existing browser address/catalog journey. Save `browser-catalog.png`. Pass when browser signed-cookie and catalog behavior remain correct.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for confirm context to populated catalog. Measure this Web baseline on trunk/head separately. Search `/` and open an actual variant. Isolate native context/catalog adaptation and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.2.DISCOVERY/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.2.DISCOVERY/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 5. Implement Instant cart and quote-backed checkout (MOBILE-20261012.2.CHECKOUT)

**Depends on.** MOBILE-20261012.1.PHONE, MOBILE-20261012.2.DISCOVERY

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core cart/quotation and Web checkout adapters. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Carry guest shopping intent into sign-in and use the Core-owned cart thereafter. Implement quantities, removal, clear cart, promo intent, address selection, available delivery options and one accepted quotation summary. Support nullable contact email without weakening recipient-phone requirements.
- [ ] Render all totals, eligibility and quote expiry from Core. Use expected versions and stable command keys; writes do not use generic automatic retries.
- [ ] Revalidate on address, cart and quote changes. Preserve unavailable rows and exact reasons until the customer resolves them. Do not split Orders or reroute by stock.
- [ ] Follow Core's global mode. In a Scheduled-mode environment, preserve browsing/history but disable new mobile Instant checkout honestly. Seed the isolated beta in Instant; do not switch production.
- [ ] Preserve started-payment destination locks and pending intent through app interruption. New paid item additions remain excluded.

**You see.**

- [ ] Add an available variant, select an address, and request Instant checkout. Observe its accepted state in the actual app and corroborate owned Core facts. Current core quotation and total appear.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for price/stock/quote races, stale versions, exact replay, and rejected-command atomicity. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Add an available variant, select an address, and request Instant checkout. Run this same Web baseline on trunk and head. Open `/checkout` to core delivery options and summary. Use `apps/web/tests/e2e/storefront-home.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `quote.png`. Pass when current Core quotation and total appear.
- [ ] Lane 2. Build guest intent and sign in. Save `guest-handoff.png`. Pass when intent enters the owned cart once without duplicate quantities.
- [ ] Lane 3. Increase, decrease, and remove quantities. Save `quantity.png`. Pass when visible cart matches its accepted Core version.
- [ ] Lane 4. Submit an ineligible promotion. Save `promo-reject.png`. Pass when Core reasons appear and totals stay authoritative.
- [ ] Lane 5. Make a fixture line unavailable before refresh. Save `unavailable.png`. Pass when the line remains visible with its exact reason.
- [ ] Lane 6. Expire a controlled quotation and continue. Save `quote-expiry.png`. Pass when a new quote is required and the old one cannot authorize payment.
- [ ] Lane 7. Change address before payment. Save `address-change.png`. Pass when quote and eligibility refresh for the new destination.
- [ ] Lane 8. Edit one cart on two clients. Save `version-race.png`. Pass when the losing edit reports conflict without partial effects.
- [ ] Lane 9. Use an isolated Scheduled fixture. Save `scheduled.png`. Pass when history/browsing work and new Instant checkout is disabled.
- [ ] Lane 10. Run the existing browser cart and quote journey. Save `browser-checkout.png`. Pass when Web displays Core decisions and exact totals.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for request quote to accepted summary. Measure this Web baseline on trunk/head separately. Open `/checkout` to core delivery options and summary. Isolate native cart/quote adaptation and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.2.CHECKOUT/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.2.CHECKOUT/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 6. Complete native QR Ph payment and recovery (MOBILE-20261012.2.PAYMENTS)

**Depends on.** MOBILE-20261012.2.CHECKOUT

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core payments and Web payment adapters. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Present QR Ph using the same public-client sequence already used by Web. Core creates and owns the Payment; the native adapter only presents the authorized provider action. Include expiry, QR saving/sharing and a same-phone bank/wallet import journey.
- [ ] Preserve the payment identity and exact submitted command through retries, restart and uncertain responses. Protect temporary client actions in native storage; never place credentials or payment action tokens in links or logs.
- [ ] Recheck Core before generating/replacing QR actions and on return from another app. QR presentation, provider initiation and app return never assert financial success.
- [ ] Distinguish waiting, payment received/finalizing, failed/expired and completed Order states. Successful checkout exposes the immutable committed Order link.

**You see.**

- [ ] Start QR Ph from an accepted quotation. Observe its accepted state in the actual app and corroborate owned Core facts. One core payment produces the authorized qr action.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for payment intent replay, unknown outcomes, QR expiry, signed-event reaction, and immutable Order receipt. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Start QR Ph from an accepted quotation. Run this same Web baseline on trunk and head. Open payment return to confirmed immutable order receipt. Use `apps/web/tests/e2e/storefront-payment-return.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `qr.png`. Pass when one Core Payment produces the authorized QR action.
- [ ] Lane 2. Save/share QR through native controls. Save `save-share.png`. Pass when usable QR appears without action tokens in links.
- [ ] Lane 3. Wait for controlled QR expiry. Save `expiry.png`. Pass when expiry appears and replacement requires Core recovery.
- [ ] Lane 4. Leave for a wallet app and return without confirmation. Save `resume.png`. Pass when Core is rechecked and success is never inferred.
- [ ] Lane 5. Restart before payment finalization. Save `restart.png`. Pass when the same Payment identity and pending state return.
- [ ] Lane 6. Tap payment start repeatedly. Save `duplicate-tap.png`. Pass when one durable intent and active Payment remain.
- [ ] Lane 7. Interrupt connectivity during creation. Save `unknown-result.png`. Pass when recovery resolves the original command without another Payment.
- [ ] Lane 8. Apply a local controlled signed event through the authorized test gateway. Save `finalizing.png`. Pass when received/finalizing differs from a committed Order.
- [ ] Lane 9. Complete a controlled local payment reaction. Save `order-success.png`. Pass when success opens the immutable committed Order.
- [ ] Lane 10. Run an authorized real same-phone QR journey on both platforms. Save `provider-phone.png`. Pass when actual provider confirmation and Core Order agree with separate receipts.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for resume to authoritative Payment/Order. Measure this Web baseline on trunk/head separately. Open payment return to confirmed immutable order receipt. Isolate native payment recovery and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.2.PAYMENTS/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.2.PAYMENTS/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 7. Add personal saved quantity lists and repeat shopping (MOBILE-20261012.3.LISTS)

**Depends on.** MOBILE-20261012.2.DISCOVERY, MOBILE-20261012.2.CHECKOUT

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core customer engagement/list storage and Web adapters. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Expose retained private favorites and Buy again. Add Core-owned named personal lists of SKU variants and requested quantities, with CRUD and Add to cart. Synchronize lists across native devices using the existing customer identity.
- [ ] Add typed list views and versioned commands, storage integrity, HTTP adapters and native controls as one cohesive slice.
- [ ] Add eligible quantities at current prices. Return added/skipped lines with reasons; never substitute or silently reduce requested quantities.
- [ ] Guard cart/list versions and record one replayable receipt for bulk addition. A rejected race leaves no partial cart effects. Sharing and recurring purchase automation stay excluded.

**You see.**

- [ ] Create a named quantity list and add it to cart. Observe its accepted state in the actual app and corroborate owned Core facts. Accepted quantities appear at current prices once.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for list ownership/integrity, inactive variants, changed prices, insufficient stock, simultaneous edits, replay, and atomic failure. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Create a named quantity list and add it to cart. Run this same Web baseline on trunk and head. Add a known variant to guest cart and open `/cart`. Use `apps/web/tests/e2e/first-visit-cart.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `list-add.png`. Pass when accepted quantities appear at current prices once.
- [ ] Lane 2. Rename and reopen a list. Save `rename.png`. Pass when the accepted name persists.
- [ ] Lane 3. Change and reload a list quantity. Save `edit-quantity.png`. Pass when the stored version matches the requested quantity.
- [ ] Lane 4. Create a list on one device and open on another. Save `cross-device.png`. Pass when both read the same owned list.
- [ ] Lane 5. Switch accounts and open a prior list destination. Save `foreign-list.png`. Pass when Core denies access without private data.
- [ ] Lane 6. Add a list containing an inactive variant. Save `inactive.png`. Pass when the result reports the skip without substitution.
- [ ] Lane 7. Add a quantity above availability. Save `insufficient.png`. Pass when an exact skip appears without silent reduction.
- [ ] Lane 8. Change a fixture price before adding its saved list. Save `price-change.png`. Pass when actual Cart uses current Core price.
- [ ] Lane 9. Replay bulk add while another cart edit races. Save `replay-race.png`. Pass when replay is stable and rejected conflicts have no partial effects.
- [ ] Lane 10. Favorite produce and use Buy again from an owned Order. Save `repeat-shopping.png`. Pass when favorites persist and repeat intent passes current cart policy.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for Add to cart to accepted list result. Measure this Web baseline on trunk/head separately. Add a known variant to guest cart and open `/cart`. Isolate native list/cart adaptation and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.3.LISTS/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.3.LISTS/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 8. Implement owned Order history, support actions and ratings (MOBILE-20261012.3.ORDERS)

**Depends on.** MOBILE-20261012.2.PAYMENTS

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core Orders/feedback, Web Order adapters, and existing staff Order page. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Implement Order history/detail, incomplete checkout recovery, purchase summaries, Buy again, eligible cancellation and refund progress/claim actions. Preserve historical Scheduled Orders under their existing rules. Add problem reporting and the retained private whole-Order feedback capability.
- [ ] Render typed Core eligibility and confirmed facts; distinguish status correction from financial/custody outcomes. Do not add mobile business overrides.
- [ ] Preserve the existing one-rating policy and actual Order/delivery eligibility. Add a scoped read-only rating/comment to the existing staff Order page, using stock Admin shadcn composition.
- [ ] Keep ratings, Problems, chat and refund decisions distinct. No public product reviews or rating-edit policy is introduced.

**You see.**

- [ ] Open owned history and purchase detail. Observe its accepted state in the actual app and corroborate owned Core facts. Core facts include historical scheduled orders.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for Order ownership, cancellation, full-refund policy, claim replay, rating eligibility, exact-rating retry receipts, changed-second-rating rejection, and scoped staff feedback. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open owned history and purchase detail. Run this same Web baseline on trunk and head. Open `/orders` to owned history and filter results. Use `apps/web/tests/e2e/customer-order-history.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `order-history.png`. Pass when Core facts include historical Scheduled Orders.
- [ ] Lane 2. Switch accounts and open a prior Order destination. Save `foreign-order.png`. Pass when Core denies access without private details.
- [ ] Lane 3. Open incomplete checkout from history. Save `payment-recovery.png`. Pass when the existing Payment resumes without another Payment.
- [ ] Lane 4. Cancel an eligible locally seeded Order. Save `cancel-eligible.png`. Pass when confirmed cancellation and immutable receipt agree.
- [ ] Lane 5. Attempt an ineligible cancellation. Save `cancel-ineligible.png`. Pass when typed reason appears without effects.
- [ ] Lane 6. Report a problem for an owned Order. Save `problem.png`. Pass when one Problem appears separately from chat/rating.
- [ ] Lane 7. Open controlled refund-progress and claim fixtures. Save `refund.png`. Pass when confirmed financial facts and permitted actions appear.
- [ ] Lane 8. Rate a delivered Order privately. Save `rating-eligible.png`. Pass when one whole-Order rating persists without public review.
- [ ] Lane 9. Try rating before delivery, retry the identical accepted submission, and submit a changed second rating. Save `rating-repeat.png`. Pass when premature feedback is rejected, the exact retry returns the saved review/receipt, and changed second feedback is rejected with the original unchanged.
- [ ] Lane 10. Open staff Web Order as permitted and foreign-location staff. Save `staff-rating.png`. Pass when only permitted staff can read scoped feedback.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for open Order to facts and permitted actions. Measure this Web baseline on trunk/head separately. Open `/orders` to owned history and filter results. Isolate native Order rendering and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.3.ORDERS/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.3.ORDERS/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 9. Connect Order chat and native photo attachments (MOBILE-20261012.3.CHAT)

**Depends on.** MOBILE-20261012.3.ORDERS

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core chat/attachments and Web conversation adapters. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Connect customer chat to the existing Order conversation and staff inbox. Include history, sends, acknowledgement, supported connection indicators, mute/sound behavior and native image selection.
- [ ] Reuse Core message identities, authorization, server photo decode/re-encode, limits, cancellation and retention. Native preprocessing does not replace server validation.
- [ ] Resume/reconnect by the supported transport without duplicate sends or replayed sounds. Clear private conversation state on account replacement.
- [ ] Reject expired content access and honor active holds. Acknowledgement and presence are not delivery receipts or resolved support outcomes.

**You see.**

- [ ] Send native text and open Web staff inbox. Observe its accepted state in the actual app and corroborate owned Core facts. One message appears in the owned conversation.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for chat ownership, message replay, attachment limits/decode/re-encode, cancellation, expiry/hold, and account replacement. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Send native text and open Web staff inbox. Run this same Web baseline on trunk and head. Send an order message and read it in admin. Use `apps/web/tests/e2e/order-messaging.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `conversation.png`. Pass when one message appears in the owned conversation.
- [ ] Lane 2. Choose and send a valid native photo. Save `photo.png`. Pass when server-validated image appears in both views.
- [ ] Lane 3. Deny media permission and send text. Save `deny-media.png`. Pass when text works and media rejection is honest.
- [ ] Lane 4. Choose invalid/oversized controlled media in the picker. Save `invalid-image.png`. Pass when server rejects it without a usable attachment.
- [ ] Lane 5. Disconnect and revisit the conversation. Save `reconnect.png`. Pass when history resumes without duplicate sends or replayed sounds.
- [ ] Lane 6. Interrupt and retry the same message identity. Save `retry-send.png`. Pass when one accepted message appears.
- [ ] Lane 7. Cancel/remove a selected photo before sending. Save `remove-upload.png`. Pass when no abandoned attachment appears as delivered.
- [ ] Lane 8. Open expired and actively held fixture attachments. Save `expiry-hold.png`. Pass when expiry denies access and holds follow Core policy.
- [ ] Lane 9. Switch accounts and reopen the previous conversation. Save `foreign-chat.png`. Pass when no cached text or attachment leaks.
- [ ] Lane 10. Read, mute sound, and receive a controlled staff message. Save `acknowledgement.png`. Pass when acknowledgement and sound work without claiming resolved support.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for send to accepted message rendered. Measure this Web baseline on trunk/head separately. Send an order message and read it in admin. Isolate native message adaptation and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.3.CHAT/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.3.CHAT/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 10. Render native delivery tracking (MOBILE-20261012.3.TRACKING)

**Depends on.** MOBILE-20261012.3.ORDERS

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core delivery projection and Web tracking adapter. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Use react-native-maps for the Core-provided owned destination, latest reported rider position, optional suggested road route and confirmed progress. Retain verified current-rider contact and existing FreshMarkets chat entry.
- [ ] Load tracking only when opened for an eligible delivery. Respect Core refresh intervals, app backgrounding and current attempt identity.
- [ ] Show observation time and waiting, delayed, unavailable and finished states. Clear invalidated rider contact; do not generate an arrival estimate.
- [ ] Preserve shared-booking privacy. Never expose other recipients, stops or a shared provider tracking link.

**You see.**

- [ ] Open eligible owned delivery with controlled observations. Observe its accepted state in the actual app and corroborate owned Core facts. Map shows only its destination and latest reported rider.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for stale observations, rematching, absent contact, Manual delivery, completion, and shared privacy. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Open eligible owned delivery with controlled observations. Run this same Web baseline on trunk and head. Open owned order timeline to tracking eligibility/status. Use `apps/web/tests/e2e/customer-order-timeline-layout.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `tracking.png`. Pass when map shows only its destination and latest reported rider.
- [ ] Lane 2. Open before any rider observation. Save `waiting.png`. Pass when waiting appears without fabricated position or arrival estimate.
- [ ] Lane 3. Advance fixture observation age and refresh. Save `stale.png`. Pass when stale label and observation time appear.
- [ ] Lane 4. Replace fixture attempt/rider and refresh. Save `rematch.png`. Pass when old rider contact and observation disappear.
- [ ] Lane 5. Open an attempt without verified rider contact. Save `no-contact.png`. Pass when no unverified phone action appears.
- [ ] Lane 6. Open a Manual delivery fixture. Save `manual.png`. Pass when Manual state has no simulated courier tracking.
- [ ] Lane 7. Open a finished delivery. Save `complete.png`. Pass when confirmed completion appears and live refresh stops appropriately.
- [ ] Lane 8. Background and resume tracking. Save `background.png`. Pass when refresh follows Core intervals and current attempt.
- [ ] Lane 9. Open one Order in a shared booking. Save `shared.png`. Pass when no other recipient, stop, or provider tracking link appears.
- [ ] Lane 10. Use restricted Maps build with an authorized courier observation. Save `provider-map.png`. Pass when actual map and provider observation agree with separate evidence.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for open tracking to map/status ready. Measure this Web baseline on trunk/head separately. Open owned order timeline to tracking eligibility/status. Isolate native projection/map rendering and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.3.TRACKING/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.3.TRACKING/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 11. Deliver transactional and chat push alerts (MOBILE-20261012.4.PUSH)

**Depends on.** MOBILE-20261012.1.PHONE, MOBILE-20261012.3.CHAT, MOBILE-20261012.3.TRACKING

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected Core notification/device storage and Web registration adapters. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Add Expo Notifications and Expo Push Service delivery through Core-owned authenticated device registration and durable delivery intent. Send the approved Order/payment/delivery/refund events and new staff messages to the owning Customer. Promotional alerts remain excluded.
- [ ] Derive notices from confirmed business/message facts independently of optional email. Keep push delivery attempts distinct from existing email attempts and in-app projections.
- [ ] Deduplicate each event/device effect, bound retries, inspect provider receipts and retire invalid tokens. Logout/revocation/account replacement prevents stale account delivery.
- [ ] Use generic payload text and an opaque authorized destination. Keep addresses, rider coordinates, message/photo contents and provider payloads out of lock-screen messages.
- [ ] Declined permissions leave shopping, history and foreground chat usable. Notification failure cannot change the committed source command.

**You see.**

- [ ] Grant permission and register an authenticated device. Observe its accepted state in the actual app and corroborate owned Core facts. Core associates the token with the current customer.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for event/device identity, ownership/reassignment, replay, invalid tokens, bounded recovery, no-email notices, and source-command independence. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Grant permission and register an authenticated device. Run this same Web baseline on trunk and head. Open owned notifications and navigate to its order. Use `apps/web/tests/e2e/notifications.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `register.png`. Pass when Core associates the token with the current customer.
- [ ] Lane 2. Deny permission then shop, open history, and chat. Save `deny-push.png`. Pass when foreground customer behavior remains usable.
- [ ] Lane 3. Receive an authorized controlled Order notice in foreground. Save `foreground.png`. Pass when one generic notice opens the owned destination.
- [ ] Lane 4. Receive an authorized background notice. Save `background.png`. Pass when generic text contains no address or message content.
- [ ] Lane 5. Receive while closed and tap notification. Save `closed-app.png`. Pass when session validation opens the authorized destination.
- [ ] Lane 6. Log out before a delayed notice is sent. Save `logout.png`. Pass when retired association cannot target prior-account navigation.
- [ ] Lane 7. Register a device after switching accounts. Save `reassign.png`. Pass when only current customer receives targeted delivery.
- [ ] Lane 8. Use a provider-rejected controlled token. Save `invalid-token.png`. Pass when Core retires it and preserves the business command.
- [ ] Lane 9. Replay a source event across multiple devices. Save `deduplicate.png`. Pass when each event/device effect is distinct and sends once.
- [ ] Lane 10. Receive actual Expo/APNs/FCM-backed alerts on both platforms. Save `receipt.png`. Pass when phone receipt is separate from Expo ticket acceptance.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for tap received push to authorized view. Measure this Web baseline on trunk/head separately. Open owned notifications and navigate to its order. Isolate native notification/session adaptation and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 250 milliseconds p95 or its customer end state above 3000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.4.PUSH/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.4.PUSH/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## PR 12. Accept and distribute the isolated phone beta (MOBILE-20261012.5.BETA)

**Depends on.** MOBILE-20261012.1.FOUNDATION, MOBILE-20261012.1.AUTH, MOBILE-20261012.1.PHONE, MOBILE-20261012.2.DISCOVERY, MOBILE-20261012.2.CHECKOUT, MOBILE-20261012.2.PAYMENTS, MOBILE-20261012.3.LISTS, MOBILE-20261012.3.ORDERS, MOBILE-20261012.3.CHAT, MOBILE-20261012.3.TRACKING, MOBILE-20261012.4.PUSH

**Files.**

- [ ] Create or edit affected `apps/mobile/**` routes, components, adapters, tests, and journey flows.
- [ ] Edit only the affected native release configuration, verification skill, and acceptance fixes. Coordinate contracts in `packages/contracts/src/**` and schema/migrations under ENGINEERING lifecycle policy with the root. Shared contracts never import storage types.
- [ ] Coordinate owning-specification, verification-skill/feature-map, and active-checkpoint edits with the root. Preserve unrelated files.

**Build.**

- [ ] Produce EAS internal-distribution builds using isolated staging and synthetic customers. Validate the full journey on an Android phone and an iPhone, including the existing staff Web workflow. Keep local, controlled-provider and distributed-build receipts separate.
- [ ] Prepare the environment configuration and verify it cannot silently select production or emit live provider/email effects. Staging is not presumed disposable; any resource creation, deployment or remote write needs the applicable authorization.
- [ ] Run the repository aggregate, affected browser journeys, documented Expo diagnostics and both native builds at the release revision.
- [ ] Execute the complete shopping/payment/recovery/support/tracking/list/push journey and denied-permission, interrupted-network, restart and account-switch scenarios. Save redacted logs, screenshots and build identities.
- [ ] Check private-data exposure, keyboard/safe-area layouts, large text, screen readers, reduced motion and scroll behavior on both platforms. Record measured loading/interaction observations without inventing performance ratios against a nonexistent old native app.
- [ ] Distribute to the owner's approved private tester set only after configuration and executed acceptance are ready. Distribution does not authorize real purchases, bookings or outbound messages.

**You see.**

- [ ] Install private Android/iPhone builds and shop through support. Observe its accepted state in the actual app and corroborate owned Core facts. The owned complete journey passes at release sha.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Add focused behavioral tests for release configuration isolation, interrupted writes, account cleanup, and native/provider acceptance regressions. Run `pnpm --filter @freshmarkets/core test`, `pnpm --filter @freshmarkets/web test`, and `pnpm typecheck` where affected. Run `pnpm migration:check` for storage changes. Foundation adds the native test command before it becomes a runnable gate.
- [ ] Run affected native tests established in Foundation, `pnpm check`, and `git diff --check`. Record the tested revision and scope.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `inherit-parent` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Install private Android/iPhone builds and shop through support. Run this same Web baseline on trunk and head. Open selected-location storefront and quote-backed checkout. Use `apps/web/tests/e2e/storefront-home.spec.ts` as scenario reference, but drive the real isolated backend without route mocks. If trunk lacks the native feature, record absence and gate the diff-added behavior plus the customer end state. Save `full-journey.png`. Pass when the owned complete journey passes at release SHA.
- [ ] Lane 2. Inspect beta redacted configuration diagnostics. Save `environment.png`. Pass when isolated staging cannot silently select production.
- [ ] Lane 3. Log in and switch accounts in signed builds. Save `auth-build.png`. Pass when callbacks and SecureStore cleanup work in distribution.
- [ ] Lane 4. Run authorized QR payment and interrupted recovery. Save `payment-build.png`. Pass when provider result agrees with one committed Order.
- [ ] Lane 5. Send a photo, report a problem, and rate eligible Order. Save `support-build.png`. Pass when native/staff views show distinct accepted facts.
- [ ] Lane 6. Open authorized tracking in both signed builds. Save `tracking-build.png`. Pass when restricted maps and shared-delivery privacy hold.
- [ ] Lane 7. Receive actual push in foreground/background/closed states. Save `push-build.png`. Pass when alerts and authorized destinations work without private payloads.
- [ ] Lane 8. Lose connectivity during writes and restart. Save `offline-build.png`. Pass when pending identities survive without duplicate effects.
- [ ] Lane 9. Use large text, screen readers, reduced motion, keyboard, and safe areas. Save `accessibility-build.png`. Pass when the full journey stays operable on both phones.
- [ ] Lane 10. Install the approved artifact through private distribution. Save `tester-install.png`. Pass when approved testers receive the exact verified build without public release.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Record p95 milliseconds for cold launch to interactable Home. Measure this Web baseline on trunk/head separately. Open selected-location storefront and quote-backed checkout. Isolate release native initialization and the named customer end state if trunk lacks native behavior.
- [ ] Probe. Extend Foundation's planned `apps/mobile/scripts/measure-journey.mjs` and `verify:perf` for this journey. Use monotonic start/semantic-ready marks and actual render assertions. Warm up five times. Collect thirty alternating paired trunk/head Web-baseline trials on one fixed runner and synthetic data, plus thirty native-head trials. If trunk also has this native feature, alternate its matching native trials as well. Relaunch the process for each cold-start trial. Preserve network/provider wait separately. Trunk without native measures the equivalent Web journey and records native unavailable. Save raw timings and device/build identities.
- [ ] Baseline. Record trunk measurements and matched SHA first. No native timing or baseline was measured for this plan. Never invent one or compare unlike Web/native scenarios as a ratio.
- [ ] Rule. These are proposed budgets, not measurements. Fail comparable Web p95 when its regression exceeds both 15 percent and 100 milliseconds. Fail native diff-added local work above 1000 milliseconds p95 or its customer end state above 5000 milliseconds p95 on fixed healthy local network. Separate actual provider latency from app work. Never substitute a fake for provider acceptance. Blocked/unavailable observation fails acceptance.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and failure/privacy screenshots to `.wrangler/mobile-review/MOBILE-20261012.5.BETA/`.
- [ ] Save a 30 to 60 second actual-build video to `.wrangler/mobile-review/MOBILE-20261012.5.BETA/review.mp4`.
- [ ] Show screenshots and video to the operator in chat. Stop at merge-ready with the exact SHA. The operator reviews and lands.

**Merge.**

- [ ] Obtain the root's clean verdict at this exact SHA and finish review-comment triage.
- [ ] Let the root rebase/retarget onto the verified parent. Retain receipts only under Shipping's patch-id rule. Rerun required CI/mergeability.
- [ ] Append this verified PR to the linear stack. The operator lands bottom-up. No automatic merge or deployment is authorized.

## Close the program

- [ ] Check all twelve PRs only at evidenced acceptance scope. Count twelve child PR IDs and five parent phases separately. Record source, browser, simulator, physical-device, actual-provider, and distribution results separately.
- [ ] Record stack root/tip links, verdicts, tested revisions, missing inputs, and one concrete next action in `docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md`.
- [ ] Confirm the operator's landed revisions and remote state. Preserve unrelated work and report parked/excluded items with reasons.
- [ ] Keep public-store submission separate. Account-deletion work is required before that release and is outside this beta.

## Appendix A. Prototype evidence

No native prototype, native bundle, native journey, or provider acceptance was executed while writing this plan. Planning inspected existing HTTP adapters, Core contracts, Better Auth configuration, retained customer capabilities, and the previous request document. Earlier grounding used `2b9c0608`. Source inspection is not runtime acceptance.

Foundation supplies the shell comparison and real driver. AUTH proves callbacks/session behavior. PAYMENTS proves native QR/recovery. TRACKING proves Maps/privacy. PUSH proves device receipt. BETA proves signed phone builds and private installation. These empirical questions remain unproven until their named receipts exist.

The planning PR's verification skill describes actual Web/Core only. Its executed baseline evidence belongs in the active checkpoint. Skill instructions do not prove future Expo behavior. The former mobile implementation at `ac2474fc` is historical reference only.

## Appendix B. Alternatives rejected

- Direct-main requests are superseded by the owner's repository-wide PR/subagent/review instruction. Use feature branches and ready PRs while preserving commerce acceptance obligations.
- Autopilot-full loses because landing authority was not granted. Autopilot-stack produces an operator-reviewed chain.
- A separate Mobile API Worker duplicates existing Web adapters and Core authority. Extend adapters only for real native gaps.
- Twelve PRs preserve stable feature boundaries. Five large PRs combine unrelated effects and acceptance ownership.
- Fake provider results and bundles cannot satisfy device/provider lanes. Missing inputs remain visible.
- Native verification follows Foundation's actual app. Generating instructions before native exists cannot prove them.

## Appendix C. Risks

- FOUNDATION needs native-capable runners/devices. Windows drives Android. iOS build/simulator proof needs macOS and Apple setup. Missing iOS capability blocks its lane without erasing source/bundle results.
- FOUNDATION confirms the agreed Expo SDK 57 baseline and supported driver/package combinations before installation. Document any compatibility-driven correction.
- AUTH needs configured Google/Apple OAuth callbacks. Missing setup leaves those social lanes blocked.
- DISCOVERY/TRACKING need restricted Maps credentials. Controlled observations prove rendering, never actual courier position.
- PAYMENTS/BETA need controlled provider accounts, inputs, explicit transaction authority, and spend limits. Plan approval authorizes no real charge or courier booking.
- PHONE has no SMS provider. Keep OTP unavailable. Local senders cannot prove real SMS. Preserve staff email verification and suppress internal placeholder receipt destinations.
- PUSH needs Expo/APNs/FCM setup, actual devices, and authorized alerts. Expo tickets cannot prove device receipt.
- BETA needs authorized isolated staging, signing, and approved testers. Deployment, remote operations, messages, and provider effects retain authorization boundaries.
- Preserve Scheduled code/history/outstanding commitments while isolated beta runs Instant. Do not switch production configuration.
- Performance limits are proposed healthy-local-network budgets. Measure baseline first. They are not observed speed or guarantees for customer networks.
- Shared contracts/migrations/specifications/checkpoint require one writer. Run lanes in waves when native runner or agent capacity is limited.
- Public-store submission/account deletion, promotional push, rewards, bundles, household sharing, vendor marketplaces, rider apps, and extra payments remain excluded.

## Appendix D. Links and reading list

Read [AGENTS](../../AGENTS.md), the [active checkpoint](checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md), [PRODUCT](../product/PRODUCT.md#mobile-customer-scope), [ARCHITECTURE](../architecture/ARCHITECTURE.md), [API_CONTRACTS](../architecture/API_CONTRACTS.md#planned-native-client-boundary), [DATA_MODEL](../architecture/DATA_MODEL.md), [STATE_MACHINES](../architecture/STATE_MACHINES.md), [ENGINEERING](../architecture/ENGINEERING.md#choose-checks-by-risk), and [DESIGN](../design/DESIGN.md) for affected behavior.

Every PR uses [how](../../.agents/skills/how/SKILL.md) for caller-to-write flow and [architect](../../.agents/skills/architect/SKILL.md) for changed contracts. PHONE, CHECKOUT, PAYMENTS, LISTS, and PUSH use [interrogate](../../.agents/skills/interrogate/SKILL.md) for identity, atomicity, replay, and privacy. All review roles inherit current session settings.

Use [Poteto](../../.agents/skills/poteto-mode/SKILL.md), [Autopilot-stack](../../.agents/skills/poteto-mode/playbooks/autopilot-stack.md), [Opening a PR](../../.agents/skills/poteto-mode/playbooks/opening-a-pr.md), [Shipping](../../.agents/skills/poteto-mode/playbooks/shipping.md), [swarm](../../.agents/skills/swarm/SKILL.md), [good-css](../../.agents/skills/good-css/SKILL.md), [TypeScript](../../.agents/skills/typescript-best-practices/SKILL.md), and [show-me-your-work](../../.agents/skills/show-me-your-work/SKILL.md). Keep one per-owner decision TSV outside tracked application data. The active checkpoint owns acceptance evidence.

Before measured-performance claims, read [benchmark-checklist](../../.agents/skills/benchmark-checklist/SKILL.md) and [Explain the Number](../../.agents/skills/principle-explain-the-number/SKILL.md). Native timing/driver commands are Foundation deliverables. Existing commands include `pnpm naming:check`, `pnpm architecture:check`, `pnpm readiness:check`, `pnpm migration:check`, `pnpm typecheck`, `pnpm test`, `pnpm check`, and `pnpm --filter @freshmarkets/web test:e2e`.

Run the unchanged guard with `node .agents/skills/poteto-mode/scripts/check-plan.mjs docs/operations/MOBILE_PR_PLAN.md`. Passing verifies checklist structure, not future native functionality or any unchecked evidence box.
