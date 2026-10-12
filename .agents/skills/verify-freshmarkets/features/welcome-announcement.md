# Welcome announcement

A storefront visit opens the welcome gallery. Customers can move between its pages, dismiss it, and continue shopping.

## Sub-features

- `welcome-open` opens one FreshMarkets welcome dialog with focus on its heading.
- `welcome-pages` advances the scheduled-delivery and delivery-address messages.
- `welcome-dismiss` closes the overlay and restores storefront interaction.
- `welcome-revisit` opens the welcome content on another home visit.

## How to get to it (user POV)

- Visit `/` in a fresh browser.
- Return to `/` after navigating away.

## Driving it with Playwright

Preconditions:

- Use the skill's managed test environment with a fresh disposable E2E state.
- The complete recipe is inspected but unexecuted in this task.

- Run `pnpm --filter @freshmarkets/web exec playwright test tests/e2e/announcement-popup.spec.ts --grep 'welcome announcement opens on every home visit with the scheduled delivery message' --trace on`.
- Require `page.getByRole('dialog', { name: 'FreshMarkets welcome' })` and focused `#fm-announcement-heading`.
- Click `dialog.getByRole('button', { name: 'Next announcement page', exact: true })`. Require the address message and announcement page 2 with `aria-current=true`.
- Click `page.getByRole('button', { name: 'Close welcome announcement' })`. Require the welcome dialog gone before using the storefront.
- Preserve the existing spec's gallery screenshots and trace. The search self-test captures the initial welcome screen and dismissal, but does not prove gallery navigation or revisit behavior.

## Gotchas

- The welcome text describes the baseline Scheduled rollout. It is not authority to change the mobile program's agreed Instant launch.
- Asset visibility needs `naturalWidth > 0`; a visible empty image element does not prove the asset loaded.
- Search self-test dismissal is partial coverage, not complete welcome acceptance.
