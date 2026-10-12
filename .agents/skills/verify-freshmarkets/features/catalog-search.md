# Catalog search

Customers search the current catalog, open a matching product, and recover from an empty result without changing commerce state.

## Sub-features

- `catalog-search-form` submits the visible Search groceries form.
- `catalog-search-match` shows Baguio Strawberries for strawberry and excludes Native Garlic.
- `catalog-search-empty` shows No groceries found and Browse all groceries for zzznothing.
- `catalog-search-url` renders the matching result for a direct query URL.

## How to get to it (user POV)

- Open `/`, close the welcome announcement, and use Search groceries in the header.
- Use the same named field in Web's phone layout.
- Open a shared `/?q=strawberry` or `/?q=zzznothing` URL.

## Driving it with Playwright

Preconditions:

- Launch the generated isolated stack with `node .agents/skills/verify-freshmarkets/scripts/run.mjs`.
- No authenticated customer or selected delivery location is required for unpriced discovery.

- Open `/` with `page.goto('/')`. Require the FreshMarkets welcome dialog, then click `page.getByRole('button', { name: 'Close welcome announcement', exact: true })`.
- Use `page.locator('input[name="q"]:visible')`. Require one visible input, fill `strawberry`, and press `Enter`. Require URL `q=strawberry`, visible heading `Baguio Strawberries`, and no `Native Garlic` heading.
- Fill the same field with `zzznothing` and press `Enter`. Require URL `q=zzznothing`, heading `No groceries found`, no strawberry heading, and link `Browse all groceries`.
- The helper captures `before-search`, `matching-results`, and `empty-results` screenshots and ARIA snapshots, `actions.json`, and a Playwright trace.
- For direct-query regression, use a new managed state and `pnpm --filter @freshmarkets/web exec playwright test tests/e2e/storefront-home.spec.ts --grep 'search narrows results with an explicit count and empty state' --trace on`. This existing spec arranges a synthetic location first. Record that difference.
- For the phone form, repeat the visible-field recipe at `page.setViewportSize({ width: 390, height: 844 })`. The generated self-test currently drives desktop only.

## Gotchas

- Both desktop and phone forms exist in the DOM. Unqualified Search groceries locators can match twice.
- The welcome dialog blocks clicks until dismissed.
- Search does not establish delivery serviceability or validate local prices. Its generated proof has no commerce mutations.
- Direct URLs and the phone header need their own execution evidence. The desktop header self-test does not accept them.
