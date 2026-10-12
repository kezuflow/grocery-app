# FreshMarkets mobile implementation requests

Turn the approved customer Expo direction into twelve verifiable work requests. Deliver an Instant-shopping private beta on Android and iOS using the existing Web/Core system. The five agreed phase IDs remain parents; the requests below are their executable children.

## How to read this

The owner requested organization on 2026-10-12, after settling the mobile scope in this chat. This artifact approves neither application execution nor an external release. Start implementation when the owner requests it. Product decisions are recorded in [PRODUCT](../product/PRODUCT.md#mobile-customer-scope); this document orders the work and defines completion evidence.

One box is one unit of work and names the evidence required. Check a box only when its evidence exists at a recorded revision. Source verification, native-device verification, actual provider acceptance and distribution are separate results. An unconfigured external dependency remains unverified, even when its local adapter tests pass.

Run the Poteto [Feature playbook](../../.agents/skills/poteto-mode/playbooks/feature.md) for each implementation request, with `how` and `architect` for affected boundaries. Follow [AGENTS](../../AGENTS.md) and [ENGINEERING](../architecture/ENGINEERING.md#choose-checks-by-risk) where upstream steps conflict. One writer handles one active request, preserves unrelated work, reviews the diff, commits verified intended files directly to `main`, and pushes `origin main`. PRs, delegation, model changes and recurring automations are not part of this queue.

Apply TypeScript guidance to source and good-css to affected web styling. Adapt supported layout, spacing, interaction and accessibility guidance to native StyleSheet components. The staff rating display also uses the Admin-only shadcn skill. Use the existing browser harness for Web; establish native journey scripts against actual builds in request 1. Do not treat native bundles as device acceptance.

## Program checklist

- [ ] Reinspect branch, HEAD, status and caller-to-write paths before each request; record the baseline and preservation boundaries in the active checkpoint.
- [ ] Read the affected owning specifications and compare the current source with this queue. Preserve completed commerce work and protected product records.
- [ ] Implement and verify requests in the order below. Dependencies name required behavior, not permission to assume acceptance.
- [ ] Keep optional integrations disabled until configured; never introduce fixed production OTPs, fabricated payments, rider locations, delivery estimates or notification delivery receipts.
- [ ] Run focused checks while iterating, then the aggregate and relevant executed acceptance at phase completion. Do not weaken gates to include the new workspace.
- [ ] Record each source, native and provider result independently. Continue independent authorized work when credentials or devices are missing.

| Order | Request | Depends on | Observable result |
| --- | --- | --- | --- |
| 1 | MOBILE-20261012.1.FOUNDATION | Approved scope | Both platform builds open the five-tab native shell. |
| 2 | MOBILE-20261012.1.AUTH | 1 | Existing customers sign in and sessions survive restart and revoke correctly. |
| 3 | MOBILE-20261012.1.PHONE | 2 | Phone OTP is prepared behind a disabled SMS adapter; optional email is modeled honestly. |
| 4 | MOBILE-20261012.2.DISCOVERY | 1, 2 | Customers confirm an address and browse the actual local catalog. |
| 5 | MOBILE-20261012.2.CHECKOUT | 3, 4 | Customers review a Core-authorized Instant cart and quotation. |
| 6 | MOBILE-20261012.2.PAYMENTS | 5 | QR Ph interruption and recovery end at the correct confirmed Order. |
| 7 | MOBILE-20261012.3.LISTS | 4, 5 | Favorites and saved quantity lists add eligible items at current prices. |
| 8 | MOBILE-20261012.3.ORDERS | 6 | Customers manage owned Orders, report problems and submit private feedback. |
| 9 | MOBILE-20261012.3.CHAT | 8 | Customer messages and photos reach the existing staff conversation. |
| 10 | MOBILE-20261012.3.TRACKING | 8 | Native maps display the owned destination and reported rider observations. |
| 11 | MOBILE-20261012.4.PUSH | 3, 9, 10 | Authorized devices receive transactional and chat alerts without cross-account leakage. |
| 12 | MOBILE-20261012.5.BETA | 1 through 11 | Installable private builds pass the complete journey on both platforms. |

The dependency numbers refer to this table's order column. Execute sequentially under the repository's one-active-slice rule.

## Request 1. Establish the native workspace and verification path

**ID.** MOBILE-20261012.1.FOUNDATION.

**Request.** Add `apps/mobile` to the pnpm workspace with the agreed Expo SDK 57 baseline, Expo Router and TypeScript. Verify supported dependency versions before installation. Provide Home, Search, Cart, Orders and Account, FreshMarkets tokens, safe areas, keyboard handling and genuine empty/error states. Use native components; Web remains the existing website.

- [ ] Integrate native lint, types, tests and local bundle checks into repository commands. Cover Expo route naming in the existing architecture/naming guards with positive and negative fixtures; do not broadly exempt native files.
- [ ] Add development and private-beta build profiles with distinct application identities, callback schemes and backend configuration. Provider secrets never enter the app bundle.
- [ ] Establish reusable native journey scripts and an evidence directory, plus the commands a maintainer runs. A local mock can support tests but cannot impersonate a functioning backend in a beta build.
- [ ] Compare two shopping-shell arrangements within the agreed five-tab navigation, then record the chosen layout and screenshots. This is visual design evidence, not commerce acceptance.

**Verify.** Existing aggregate checks include the new workspace. Android and iOS bundles build; an actual development build opens, switches tabs, handles large text and shows no clipped controls. Record unavailable signing/device prerequisites separately. Persist the device-check procedure before feature work.

## Request 2. Connect existing Better Auth accounts

**ID.** MOBILE-20261012.1.AUTH. Depends on request 1.

**Request.** Integrate the installed Better Auth Expo client with Core-owned sessions through the existing Web auth proxy. Offer email/password, verification and reset, Google, and Apple on iOS. Preserve existing customer identity and history; a social email or delivery phone is not an independent authorization credential.

- [ ] Store sessions using SecureStore and forward the current authenticated cookie on native API requests using the installed client's supported API.
- [ ] Validate configured callback schemes/origins; preserve browser cookie, forwarding and CSRF behavior. Add only the native-specific proxy handling proved necessary.
- [ ] Clear private queries, pending presentation and device association on logout, revocation or resolved account replacement. Deep-linked Orders still require Core ownership.

**Verify.** Core/auth-proxy tests cover native callbacks and unchanged Web flows. Actual platform checks cover login, restart, verification/reset return, Google, Apple on iOS, revocation and account switching. Missing OAuth/signing configuration cannot be marked accepted.

## Request 3. Prepare phone OTP and optional receipt email

**ID.** MOBILE-20261012.1.PHONE. Depends on request 2.

**Request.** Prepare Better Auth's phone-number plugin behind a Core-owned `SmsOtpDeliveryPort`. The owner deferred SMS provider selection. Ship the port and phone-flow capability handling; the beta continues to use configured existing login methods.

- [ ] Default phone OTP to unavailable with no provider. Unconfigured send attempts fail honestly before SMS effects; the app does not advertise a working phone login.
- [ ] Use Philippine phone normalization, verified unique identity, bounded resend/attempt limits and expiry. Configure the plugin's six-digit, five-minute, three-attempt defaults. Never log codes or phone numbers.
- [ ] Link a phone only through a currently authenticated account plus OTP verification. Do not auto-link old contact numbers, merge customers by phone, or manufacture email verification.
- [ ] Distinguish internal placeholder identity from optional real contact email. Future phone accounts may check out without email; email delivery requires a real verified destination. Keep in-app notices independent of email delivery and staff verification rules intact.

**Verify.** Worker/D1 tests prove disabled delivery, invalid/expired codes, resend limits, conflicting phone ownership, account linking and placeholder-email suppression. Test senders stay confined to tests/local fixtures. Record SMS provider delivery and real phone-only login as deferred acceptance, not a beta capability.

## Request 4. Implement address selection and catalog discovery

**ID.** MOBILE-20261012.2.DISCOVERY. Depends on requests 1 and 2.

**Request.** Connect Home, Search and product detail to the existing catalog APIs. Include current categories, product galleries, variants, prices, promotions and honest availability. Implement saved-address management and address search/map confirmation with optional foreground location permission.

- [ ] Add a native browsing-context adapter that returns Core's opaque signed token instead of relying on browser-only HttpOnly storage. Pass the bounded native context to catalog reads; Core validates it and selects the location.
- [ ] Preserve service-area, geocoding finalization, recipient, phone and single Delivery instructions rules. Skipping or denying location permission still permits general browsing.
- [ ] Isolate caches by account and browsing context. Display cache data as potentially stale; no cached price, stock or token authorizes checkout.

**Verify.** Test signed-context tampering, foreign addresses, deleted defaults, denied permissions, outside-area coordinates and location replacement. Drive actual native search, map pin, product gallery and variant selection. Existing browser address/catalog journeys retain their behavior.

## Request 5. Implement Instant cart and quote-backed checkout

**ID.** MOBILE-20261012.2.CHECKOUT. Depends on requests 3 and 4.

**Request.** Carry guest shopping intent into sign-in and use the Core-owned cart thereafter. Implement quantities, removal, clear cart, promo intent, address selection, available delivery options and one accepted quotation summary. Support nullable contact email without weakening recipient-phone requirements.

- [ ] Render all totals, eligibility and quote expiry from Core. Use expected versions and stable command keys; writes do not use generic automatic retries.
- [ ] Revalidate on address, cart and quote changes. Preserve unavailable rows and exact reasons until the customer resolves them. Do not split Orders or reroute by stock.
- [ ] Follow Core's global mode. In a Scheduled-mode environment, preserve browsing/history but disable new mobile Instant checkout honestly. Seed the isolated beta in Instant; do not switch production.
- [ ] Preserve started-payment destination locks and pending intent through app interruption. New paid item additions remain excluded.

**Verify.** Worker/D1 tests cover price/stock/quote races, stale versions, rejected writes and replay. Native journeys cover guest-to-account handoff, quantity changes, promo rejection, unavailable items and expired quotation. Web checkout regression checks remain green.

## Request 6. Complete native QR Ph payment and recovery

**ID.** MOBILE-20261012.2.PAYMENTS. Depends on request 5.

**Request.** Present QR Ph using the same public-client sequence already used by Web. Core creates and owns the Payment; the native adapter only presents the authorized provider action. Include expiry, QR saving/sharing and a same-phone bank/wallet import journey.

- [ ] Preserve the payment identity and exact submitted command through retries, restart and uncertain responses. Protect temporary client actions in native storage; never place credentials or payment action tokens in links or logs.
- [ ] Recheck Core before generating/replacing QR actions and on return from another app. QR presentation, provider initiation and app return never assert financial success.
- [ ] Distinguish waiting, payment received/finalizing, failed/expired and completed Order states. Successful checkout exposes the immutable committed Order link.

**Verify.** Execute Worker/D1 replay, timeout and signed-event reaction tests. Native journeys include expiry, background/resume, restart, duplicate taps and interrupted creation. Record mock, sandbox and real-provider evidence separately. An actual same-phone payment needs an authorized provider account and controlled inputs before it can be accepted.

## Request 7. Add personal saved quantity lists and repeat shopping

**ID.** MOBILE-20261012.3.LISTS. Depends on requests 4 and 5.

**Request.** Expose retained private favorites and Buy again. Add Core-owned named personal lists of SKU variants and requested quantities, with CRUD and Add to cart. Synchronize lists across native devices using the existing customer identity.

- [ ] Add typed list views and versioned commands, storage integrity, HTTP adapters and native controls as one cohesive slice.
- [ ] Add eligible quantities at current prices. Return added/skipped lines with reasons; never substitute or silently reduce requested quantities.
- [ ] Guard cart/list versions and record one replayable receipt for bulk addition. A rejected race leaves no partial cart effects. Sharing and recurring purchase automation stay excluded.

**Verify.** Test another customer's list, inactive variants, changed prices, insufficient availability, simultaneous edits and exact replay. Native checks create a list on one device, read it on another, add it once, and review the resulting actual Cart.

## Request 8. Implement owned Order history, support actions and ratings

**ID.** MOBILE-20261012.3.ORDERS. Depends on request 6.

**Request.** Implement Order history/detail, incomplete checkout recovery, purchase summaries, Buy again, eligible cancellation and refund progress/claim actions. Preserve historical Scheduled Orders under their existing rules. Add problem reporting and the retained private whole-Order feedback capability.

- [ ] Render typed Core eligibility and confirmed facts; distinguish status correction from financial/custody outcomes. Do not add mobile business overrides.
- [ ] Preserve the existing one-rating policy and actual Order/delivery eligibility. Add a scoped read-only rating/comment to the existing staff Order page, using stock Admin shadcn composition.
- [ ] Keep ratings, Problems, chat and refund decisions distinct. No public product reviews or rating-edit policy is introduced.

**Verify.** Worker/D1 checks prove ownership, full-refund policy, cancellation eligibility, replay and premature/changed rating rejection. Native checks cover retained history, failed payment recovery, problem submission and delivered feedback. Browser staff checks prove permitted visibility and denied cross-location access.

## Request 9. Connect Order chat and native photo attachments

**ID.** MOBILE-20261012.3.CHAT. Depends on request 8.

**Request.** Connect customer chat to the existing Order conversation and staff inbox. Include history, sends, acknowledgement, supported connection indicators, mute/sound behavior and native image selection.

- [ ] Reuse Core message identities, authorization, server photo decode/re-encode, limits, cancellation and retention. Native preprocessing does not replace server validation.
- [ ] Resume/reconnect by the supported transport without duplicate sends or replayed sounds. Clear private conversation state on account replacement.
- [ ] Reject expired content access and honor active holds. Acknowledgement and presence are not delivery receipts or resolved support outcomes.

**Verify.** Drive both native customer and existing Web staff views through text/photo send and receipt, reconnect, retries and upload removal. Execute ownership, expiry/hold and invalid-image checks. Notifications added later must not be mistaken for actual message content delivery.

## Request 10. Render native delivery tracking

**ID.** MOBILE-20261012.3.TRACKING. Depends on request 8.

**Request.** Use react-native-maps for the Core-provided owned destination, latest reported rider position, optional suggested road route and confirmed progress. Retain verified current-rider contact and existing FreshMarkets chat entry.

- [ ] Load tracking only when opened for an eligible delivery. Respect Core refresh intervals, app backgrounding and current attempt identity.
- [ ] Show observation time and waiting, delayed, unavailable and finished states. Clear invalidated rider contact; do not generate an arrival estimate.
- [ ] Preserve shared-booking privacy. Never expose other recipients, stops or a shared provider tracking link.

**Verify.** Test stale observations, rematching, absent rider contact, Manual delivery, completion and shared Orders. Inspect actual native map rendering with controlled observations, distinguishing it from provider-location acceptance. Verify restricted Android Maps configuration in the real build.

## Request 11. Deliver transactional and chat push alerts

**ID.** MOBILE-20261012.4.PUSH. Depends on requests 3, 9 and 10.

**Request.** Add Expo Notifications and Expo Push Service delivery through Core-owned authenticated device registration and durable delivery intent. Send the approved Order/payment/delivery/refund events and new staff messages to the owning Customer. Promotional alerts remain excluded.

- [ ] Derive notices from confirmed business/message facts independently of optional email. Keep push delivery attempts distinct from existing email attempts and in-app projections.
- [ ] Deduplicate each event/device effect, bound retries, inspect provider receipts and retire invalid tokens. Logout/revocation/account replacement prevents stale account delivery.
- [ ] Use generic payload text and an opaque authorized destination. Keep addresses, rider coordinates, message/photo contents and provider payloads out of lock-screen messages.
- [ ] Declined permissions leave shopping, history and foreground chat usable. Notification failure cannot change the committed source command.

**Verify.** Worker/D1 tests cover ownership, replay, token reassignment, missing email and delivery failures. Actual Android/iOS checks cover permission denial, foreground/background/closed app, notification taps and logout. Expo acceptance tickets are not proof of device receipt.

## Request 12. Accept and distribute the isolated phone beta

**ID.** MOBILE-20261012.5.BETA. Depends on requests 1 through 11.

**Request.** Produce EAS internal-distribution builds using isolated staging and synthetic customers. Validate the full journey on an Android phone and an iPhone, including the existing staff Web workflow. Keep local, controlled-provider and distributed-build receipts separate.

- [ ] Prepare the environment configuration and verify it cannot silently select production or emit live provider/email effects. Staging is not presumed disposable; any resource creation, deployment or remote write needs the applicable authorization.
- [ ] Run the repository aggregate, affected browser journeys, documented Expo diagnostics and both native builds at the release revision.
- [ ] Execute the complete shopping/payment/recovery/support/tracking/list/push journey and denied-permission, interrupted-network, restart and account-switch scenarios. Save redacted logs, screenshots and build identities.
- [ ] Check private-data exposure, keyboard/safe-area layouts, large text, screen readers, reduced motion and scroll behavior on both platforms. Record measured loading/interaction observations without inventing performance ratios against a nonexistent old native app.
- [ ] Distribute to the owner's approved private tester set only after configuration and executed acceptance are ready. Distribution does not authorize real purchases, bookings or outbound messages.

**Verify.** Record the exact source revision, artifact/build identities, actual devices/OS versions, each journey result and remaining external acceptance. Keep phone OTP visibly unavailable until its deferred SMS integration is accepted. A build cannot be called a verified private beta solely because it bundles.

## Close the program

- [ ] Account for all twelve requests and the five parent phases at their recorded acceptance scope.
- [ ] Update the active checkpoint with source/device/provider/distribution results, unfinished obligations and one concrete next action.
- [ ] Confirm intended commits are on `main` and pushed, with unrelated work preserved.
- [ ] Report actual completion and external limits. Public store launch remains separate and requires account-deletion work before submission.

## Appendix A. Prototype evidence

No native prototype, new API call, native bundle, device journey or provider acceptance was executed while organizing this queue. Grounding inspected the existing Web HTTP adapters, typed Core contracts, Better Auth configuration, retained customer capabilities and the active checkpoint at `2b9c0608`. Source pointers below support implementation planning, not runtime acceptance.

Request 1 supplies the first actual shell comparison and native verification path. The former Mobile implementation at `ac2474fc` is historical reference only; do not restore its packages or requirements wholesale.

## Appendix B. Alternatives and pstack adaptations

- Reuse Web HTTP adapters instead of a separate Mobile API Worker. This preserves one Core authority and avoids duplicate adapters/deployments; native context/auth behavior still needs executed proof.
- Use twelve independent work requests instead of five large implementation changes. Sequence Verifiable Units puts a visible acceptance boundary around each feature and its effects.
- Establish native checks before commerce. Foundational Thinking puts the shared verification/build structure first.
- The Multi-phase plan playbook owns this organization task. Its implementation, PR, model, agent, mandatory ten-lane swarm, recurring `/loop 1h` and routine approval steps are replaced by AGENTS' direct-main, one-writer workflow and ENGINEERING's risk-based checks. No new automation or setting is created.
- The upstream `check-plan.mjs` hardcodes PR sections, swarm lanes, merge gates and recurrence markers. Run it as an upstream compatibility diagnostic; its rejection does not authorize changing these repository rules or weakening the checker. Verify this adapted artifact's IDs, dependencies, scope, evidence requirements and local links directly.
- Keep a local decision TSV at `.wrangler/mobile-20261012-decisions.tsv`; the active checkpoint remains the canonical execution record. Independent cross-model review is skipped because delegation/model changes are not authorized.

## Appendix C. Inputs and release boundaries

| Input | Needed by | Result while missing |
| --- | --- | --- |
| Expo/EAS project and Apple signing account | Requests 1, 12 | Source/bundle checks can proceed; signed iPhone/build distribution remains unaccepted. |
| Google/Apple OAuth configuration | Request 2 | Configure and test available methods; do not claim the missing social method accepted. |
| Restricted Maps SDK credentials | Requests 4, 10 | Test logic locally; actual Android native map acceptance remains open. |
| Authorized isolated staging resources and origin | Request 12 | Prepare configuration locally; no deployment or shared remote data writes. |
| Push project/APNs/FCM credentials and test devices | Request 11 | Adapter tests only; no claim of received native notifications. |
| Controlled payment/courier account, recipients and spending authorization | Requests 6, 10, 12 | Synthetic/local observations remain separate from actual provider evidence. |
| SMS provider | Deferred after request 3 | Phone OTP is unavailable; the beta uses configured existing login methods. |

Instant is the agreed launch mode for both apps, not authorization to change production configuration now. Retain Scheduled source/history/commitments. Public store submission/account deletion, promotional push, household sharing, loyalty, bundles, marketplaces, internal riders and extra payment methods remain outside this beta queue.

## Appendix D. Links and reading list

- [Active checkpoint](checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).
- [Product owner](../product/PRODUCT.md#mobile-customer-scope), [architecture owner](../architecture/ARCHITECTURE.md#system-shape), [contracts owner](../architecture/API_CONTRACTS.md#planned-native-client-boundary) and [design owner](../design/DESIGN.md#native-mobile-direction---owner-planning-decisions-2026-10-12).
- [Engineering verification](../architecture/ENGINEERING.md#choose-checks-by-risk), [data ownership](../architecture/DATA_MODEL.md) and [state transitions](../architecture/STATE_MACHINES.md).
- [Web auth proxy](../../apps/web/lib/auth/proxy.ts), [HTTP request context](../../apps/web/lib/http/request-context.ts), [catalog adapter](../../apps/web/app/api/catalog/route.ts) and [Core contract](../../packages/contracts/src/core-service.ts).
- [Core Better Auth configuration](../../apps/core/src/auth/service.ts), [retained customer engagement](../../apps/core/src/customer/engagement.ts), [tracking projection](../../packages/contracts/src/delivery-tracking.ts) and [existing QR presentation](../../apps/web/components/payments/paymongo-payment.tsx).
- [Poteto Multi-phase plan](../../.agents/skills/poteto-mode/playbooks/multi-phase-plan.md), [how](../../.agents/skills/how/SKILL.md), [architect](../../.agents/skills/architect/SKILL.md), [good-css](../../.agents/skills/good-css/SKILL.md), [TypeScript](../../.agents/skills/typescript-best-practices/SKILL.md) and [show-me-your-work](../../.agents/skills/show-me-your-work/SKILL.md).

Existing commands include `pnpm naming:check`, `pnpm architecture:check`, `pnpm readiness:check`, `pnpm migration:check`, `pnpm typecheck`, `pnpm test`, `pnpm check`, `pnpm --filter @freshmarkets/web test:e2e` and `git diff --check`. Request 1 must add and verify native commands before documenting them as runnable. The aggregate does not replace executed browser/native/provider acceptance.
