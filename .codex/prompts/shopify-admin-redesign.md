# On-demand SAUI execution prompt

Implement the owner-approved Shopify-style Freshmarkets admin redesign in `kezuflow/grocery-app`.

Read and execute `docs/design/SHOPIFY_ADMIN_IMPLEMENTATION_PLAN.md`. Consult `docs/design/SHOPIFY_ADMIN_REFERENCES.md` and the supplied baseline at `docs/design/references/shopify-approved-reference.png`. Maintain the sole task checkpoint at `docs/operations/checkpoints/SHOPIFY_ADMIN_EXECUTION.md`.

This is an implementation invocation, not a request for another plan. Inspect actual HEAD/status and preserve unrelated work before editing. Read current `AGENTS.md` and relevant owning-guide sections. Keep SAUI separate from commerce alignment: do not overwrite its checkpoint, resume its unfinished work, or run another competing writer. Do not treat the old optional UI orchestrator as this task's model or design policy.

## Models and bounded delegation

The intended main session is GPT-5.6 Sol / High. Use the actual configured model; do not edit personal settings or pretend that prompting changes a model setting.

For this SAUI task only, this invocation explicitly authorizes bounded subagents when the runtime supports the requested configurations:

- Sol Medium for a focused read-only Mobbin/code investigation.
- Sol Medium for one specified presentation slice using the accepted component contract.
- Sol High instead for scope-sensitive, stateful, payment or delivery UI integration.
- A fresh-context Sol High reviewer for completed milestone diffs and evidence.

Use at most one writer and at most three active child agents. Shared shell/navigation/tokens/providers remain lead-owned. Do not write the same files concurrently, spawn nested agents, or run competing stateful test stacks. Do not automatically use Luna Max, Astra orchestration, Ultra, or Extra High. After two failed focused attempts at one reproducible defect, request/perform a bounded High-to-Extra-High escalation only if supported, then return to the normal setting. Record actual settings when exposed. Without model-configurable delegation, execute serially in the selected main session and report that fallback.

## Product and technical constraints

Replace the old admin appearance with the approved Shopify-style visual structure. Preserve the Freshmarkets identity, Global/authorized fulfillment-location selector beside notifications, existing admin notification behavior, permission boundaries, and business semantics. Keep Market internal to ordinary operator presentation.

No new/renamed/deleted page or API routes, aliases, or redirect destinations. Preserve existing deep links and query-state compatibility. Use existing full record/edit routes for substantial work while retaining the approved scoped Product preview and its inline Global/category/location-price controls; use local editor state where a separate editor route does not exist. No new backend command, capability, schema migration, provider integration, or business-rule change just to fill a Shopify pattern.

Regroup only authorized navigation. Independently permitted children, including Receiving, cannot disappear when the user lacks the parent destination's permission. Preserve Catalog overview and any other existing authorized routes omitted from the illustrative menu. Settings grouping must not grant or accidentally remove access.

POS and Messaging are disabled non-links marked Coming soon. Do not implement draft orders, Mark as paid, invoices, persistent saved views, financial accounts, segmentation, store credit or unsupported bulk actions. Do not fabricate totals, trends, payment success, or booking success.

Core supplies legal actions. The delivery chooser is not universal: preserve the currently authorized mode-specific automatic/manual booking timing and existing unknown-outcome/recovery behavior. Preserve current calendar-led Scheduled cycles, exact stock/price units, financial restrictions, and operational prerequisites. Supersede only the old admin visual rules in the current DESIGN.md; do not copy this plan over the entire guide.

## Mobbin behavior

Discover the tools actually connected to this execution host. Use `search_screens` for a specific Shopify screen/dialog and `search_flows` for a specific journey, with `platform="web"`. Follow the exact current schemas and the constant task intent in the plan. Start with 1–3 screens or one flow. Inspect images, not only titles. Reuse the ledger; when confused, resolve that precise visual question through Mobbin rather than improvising an unrelated design. If a worker lacks access, the lead can return the focused evidence.

Use canonical Mobbin URLs in the ledger. Download high-resolution reference images only when needed; do not ship them as application assets. A static screenshot does not prove focus, keyboard or async behavior. If tools fail, record the attempted action and continue only evidence-grounded independent work; do not claim research that did not happen.

## Execution and completion

Start at SAUI-00 or the first genuinely incomplete slice verified against code and checkpoint. Continue in dependency order through SAUI-12, one cohesive slice at a time. After each slice, inspect the diff, run focused checks, compare the rendered result where relevant, repair regressions and update the checkpoint. At implementation-phase completion, follow ENGINEERING.md's aggregate gate and any required checks it does not include, especially browser acceptance.

Do not stop at another plan, after the shell alone, or after a build. Do not repeatedly ask approval for ordinary choices already covered by the approved design. Save an inspected Orders pilot before broad page migration. Stop only for a material product-policy conflict, required missing access/tool, unresolved safety failure, prohibited external effect, or explicit owner pause; continue independent authorized work where possible without marking blocked gates complete.

Use only safe identified local test state. Never book a real rider, charge/refund money, message customers, mutate/reset shared staging, or deploy. Follow current verified Git/commit/push rules separately from deployment authority. Keep credentials and customer details out of screenshots, reports and checkpoints.

Before compaction or handoff, save exact phase/slice, HEAD/diff state, commands/results, evidence paths, blockers and one concrete next action. Final output must report accepted phases out of 13, actual accepted slice counts, route/action coverage, tested revision, executed tests, inspected screenshots and every remaining limitation. Never present unverified UI or simulated provider work as complete real-world acceptance.
