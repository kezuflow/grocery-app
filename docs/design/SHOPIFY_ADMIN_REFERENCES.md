# Shopify admin reference ledger

**Task:** SAUI — Freshmarkets admin redesign
**Status:** Execution reference ledger; inspect relevant images and intermediate states when a decision remains unclear.
**Visual target:** the supplied Shopify Spring ’26 admin screenshot, not an arbitrary later redesign or a mixture of unrelated products.

## Approved appearance baseline

[User-supplied Shopify screenshot](references/shopify-approved-reference.png)

Use this for the dark full-width header, pale expanded sidebar, light workspace, compact controls, two-column card layout, restrained buttons, and Save/Discard placement. Replace Shopify identity with Freshmarkets. Preserve Global/authorized-location selection beside notifications. Do not copy proprietary brand artwork into the application.

## Previously inspected Mobbin references

Representative preview images were inspected in the preceding conversation; a returned flow was not a browser-executed Shopify interaction. Use actual Freshmarkets browser tests to establish dynamic behavior.

| ID  | Canonical reference                                                                                | Observed pattern                                                                                      | Adaptation / explicit exclusion                                                                           |
| --- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| M01 | [Shopify Orders list](https://mobbin.com/screens/b0f99f43-2fe4-4c9c-867a-1da5cedbdfab)             | Compact order index, sidebar, summary band, table and separate status columns                         | Preserve only supported filters/fields/aggregates; no invented Create order or bulk operations            |
| M02 | [Orders display-controls popover](https://mobbin.com/screens/fb87b68d-8192-495b-913b-e103e73aa7bb) | Compact sorting/column controls in a popover                                                          | Use only if existing data/state supports the behavior; not a requirement to add saved views or batch APIs |
| M03 | [Creating an order — flow](https://mobbin.com/flows/2fa86b5f-c569-4a24-9cc7-679122d762b8)          | Product picker, focused delivery dialog, customer support column, resulting order record and timeline | Copy composition/dialog discipline; exclude unsupported draft orders, Mark as paid and invoice sending    |
| M04 | [Product picker](https://mobbin.com/screens/9be1cd16-65dc-458d-b09b-82d316a69d96)                  | Searchable selectable product/variant rows and an explicit selection footer                           | Reuse for existing supported resource selection; preserve exact units and inventory meaning               |
| M05 | [Adding a product — flow](https://mobbin.com/flows/9e256ffd-d5a3-4fd2-88bd-a239d491a91b)           | Main form cards, status/organization support column, contextual save bar                              | Existing product routes and commands; no arbitrary additional product fields                              |
| M06 | [Customer profile](https://mobbin.com/screens/0923dee6-44f2-4b31-8fa2-ef202f0548ae)                | Customer summary, order context/activity, contact sidebar, contextual menu                            | Use currently returned customer facts; no invented spend, segmentation, store credit or messaging         |
| M07 | [Discount type chooser](https://mobbin.com/screens/6c95bdc1-1836-4d21-a827-1347a2f242e2)           | Compact modal option rows with supporting descriptions                                                | Options derive from Freshmarkets' supported benefit types, not Shopify's complete menu                    |
| M08 | [Creating a discount — flow](https://mobbin.com/flows/97e8b9c0-d21c-4ee5-976d-1266f9aab926)        | Grouped rules form plus plain-language summary                                                        | Existing targets, limits, amounts, dates and eligibility; same-route editor where no detail route exists  |
| M09 | [Finance overview](https://mobbin.com/screens/8e44cfcf-3e62-4891-a722-ab16c2f0bbd0)                | Restrained financial cards and section hierarchy                                                      | Existing Payments/Needs attention functionality; not Shopify Balance, credit or payout-account features   |
| M10 | [Analytics](https://mobbin.com/screens/7483aa3e-31eb-470c-bbe2-477a81106422)                       | Compact date controls and metric/chart card hierarchy                                                 | Existing aggregates/time series only; never invent trends or interpret unavailable as zero                |
| M11 | [Point of Sale settings](https://mobbin.com/screens/fb60bc7a-4d41-48ee-9db2-8cafc9303462)          | POS positioned within sales-channel hierarchy                                                         | Navigation reference only: Freshmarkets POS remains disabled, with no new route                           |

## Precise MCP queries when evidence is insufficient

### SAUI-00 execution observation — 2026-09-24

The current runtime exposes Mobbin `search_screens` and `search_flows`. A bounded read-only search inspected previews for the [Shopify shell](https://mobbin.com/screens/a14400bb-6617-4890-af09-01c012c69998), [Orders index](https://mobbin.com/screens/ab8ef727-62cf-4f84-a193-a5b943c95f8b), [product editor](https://mobbin.com/screens/ff232cf3-1172-4e68-8339-5ec292130777), [discount editor](https://mobbin.com/screens/b794f76c-167a-4056-8310-5c50287f97ee), [product-selector dialog](https://mobbin.com/screens/7cd3c154-55e2-42c4-a9cf-40706f380b73), and [destructive confirmation](https://mobbin.com/screens/fbdb6121-8f29-453e-92b7-7b81ce8299bd). These corroborate the saved hierarchy, compact tables, grouped editor cards, and focused dialog anatomy. They do not establish keyboard or asynchronous behavior.

The approved PNG is a Shopify Create order screen. Its Global/location selector position is a Freshmarkets adaptation; Shopify Markets/currency, Create order, custom items, invoices, Mark as paid, Sidekick and Agentic are excluded. Do not infer responsive behavior or exact pixel tokens from this scaled image. Notification-popover and general Settings references remain query targets if their specific visual decisions are unclear.

Discover the connected tool schema before use. Current tools: `search_screens`, `search_flows`; platform `web`. Use one question per query, start small, and inspect the image. Screen search supports `standard`/`deep`; flow search has no such field.

### SAUI-05 Customer profile refinement — 2026-09-24

A focused deep Mobbin screen search inspected the [Shopify customer profile](https://mobbin.com/screens/eab9622f-019c-4caa-a070-0f05c28e8b44) (screen `eab9622f-019c-4caa-a070-0f05c28e8b44`). Its preview shows compact identity and summary facts at the top, activity in the main column, and contact/contextual actions in a narrower right column. Freshmarkets uses that hierarchy for the existing Customer record, with only the order count, joined/last-order, contact, access, privacy, support and sanitized activity facts already returned by Core. Shopify spend, per-order detail, store credit, segmentation and messaging are excluded. The image does not establish responsive, keyboard or asynchronous behavior; those require Freshmarkets browser evidence. This refines M06's composition without replacing the approved reference or adding authority to its features.

| Task/question                | Tool           | Query                                                                                                                       |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Shell/index density          | search_screens | Shopify admin Orders list showing the expanded left navigation, dark header, status views and compact table                 |
| Order composition/transition | search_flows   | Shopify creating an order by selecting products, choosing a customer, reviewing totals and opening the saved order          |
| Product editor               | search_flows   | Shopify adding a product with title, description, media, price, variants and a contextual Save and Discard bar              |
| Product selection            | search_screens | Shopify Select products modal with a search field, selectable product and variant rows, selected count and Add button       |
| Customer profile             | search_screens | Shopify customer profile detail for one customer with summary metrics, activity, contact information and contextual actions |
| Discount chooser             | search_screens | Shopify Select discount type modal with option rows, descriptions and a cancel button                                       |
| Discount editor              | search_flows   | Shopify creating a discount by choosing its type, configuring eligibility and active dates, reviewing a summary and saving  |
| Notifications                | search_screens | Shopify admin notification popover anchored to the header bell with contextual notification rows                            |
| Finance                      | search_screens | Shopify Finance page showing restrained cards, financial navigation and payment-related context                             |
| Analytics                    | search_screens | Shopify Analytics dashboard with date range controls, metric cards and sales charts                                         |
| Settings                     | search_screens | Shopify admin Settings with category navigation and grouped configuration cards                                             |
| Dangerous action             | search_screens | Shopify confirmation dialog for a destructive admin action with a clear consequence, cancel and confirm buttons             |

Use the constant task intent from the implementation plan. Refine incorrect results with the exact missing screen state; do not describe an irrelevant result as the desired screen. Do not send customer data, repository contents, or unrelated personal context in query fields.

After each new investigation, append a compact record:

```text
Question / SAUI slice:
Canonical Mobbin URL and screen/flow ID:
Image inspected (provided preview or downloaded original):
Observed structure:
Freshmarkets adaptation:
Not copied / unsupported features:
Unverified interaction behavior:
Decision and owning DESIGN.md section:
```

## Repository sources used in preparing the plan

These are source observations, not proof of current deployed behavior. Commit-pinned URLs avoid silently citing a later version. The executing model should inspect actual HEAD and corresponding files.

- **S1 — [Agent rules](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/AGENTS.md):** guide hierarchy, separate commerce workflow, checkpoint rules, direct-main Git policy, no unauthorized model-setting changes or external effects.
- **S2 — [Root manifest](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/package.json):** package manager, Node range and aggregate/check script names.
- **S3 — [Web manifest](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/apps/web/package.json):** existing UI/tooling dependencies and separate Web build, vinext and Playwright scripts.
- **S4 — [Engineering guide](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/docs/architecture/ENGINEERING.md):** current boundaries, verification requirements and risk-based checks.
- **S5 — [Playwright configuration](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/apps/web/playwright.config.ts):** managed local test environment, state naming and port. Provisioning scripts/tests must also be inspected before running.
- **S6 — [Design guide](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/docs/design/DESIGN.md):** old visual rules needing scoped supersession; payment, notification, exact-location, scheduling, receiving and mode-specific booking requirements to preserve.
- **S7 — [Core navigation metadata](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/apps/core/src/admin/application/get-admin-context.ts):** existing authorized destinations including Catalog overview, Procurement and Receiving.
- **S8 — [Existing optional UI orchestrator](https://github.com/kezuflow/grocery-app/blob/ecf36369266e2bb217c3502e983d6d7acd564e70/.codex/prompts/ui-orchestrate.md):** optional Astra/Luna workflow; not the governing invocation for this separately scoped plan.
- **S9 — [Earlier Orders implementation](https://github.com/kezuflow/grocery-app/blob/06abefde2cf77402d63dd54778a443ed9b1f0c94/apps/web/app/admin/orders/page.tsx):** prior inspected list/panel implementation, starting point only.
- **S10 — [Earlier Products implementation](https://github.com/kezuflow/grocery-app/blob/06abefde2cf77402d63dd54778a443ed9b1f0c94/apps/web/app/admin/catalog/products/products-page-client.tsx):** prior inspected product panel, scope and query behavior, starting point only.

## Official model/harness guidance checked for this plan

- **O1 — [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning):** effort availability is model-dependent; higher effort has cost/latency tradeoffs. This supports treating Extra High as a measured escalation rather than a default based only on project length.
- **O2 — [Codex model selection](https://developers.openai.com/codex/models):** model/effort selection and current model families. The named allocations in the plan are project recommendations, not repository-specific benchmark results.
- **O3 — [Codex subagents](https://developers.openai.com/codex/subagents):** configurable local agents, bounded delegation, additional token use and caution with parallel writers.
- **O4 — [Codex MCP](https://developers.openai.com/codex/mcp):** tool access must be configured on the executing host; a connected tool in this conversation does not prove the user's separate Codex host can access it.
- **O5 — [Long-horizon Codex work](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex):** milestone-based plans, verification and externalized progress are relevant long-running-work patterns. The plan makes no promised runtime or token budget based on that example.

No claims about actual model settings, browser runs, production deployment, or current provider-account readiness are established by this reference ledger.
