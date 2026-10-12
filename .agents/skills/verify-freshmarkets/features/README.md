# FreshMarkets verification map

Read the matching recipe before driving Web. The native Expo gate is unavailable because this checkout has no `apps/mobile` source.

## Baseline preconditions

Use the isolated managed Web/Core Worker and D1 stack described in [the skill](../SKILL.md). Each run gets a new `E2E_STATE_NAME` matching `e2e-verify-<UUID>`. Setup deletes its selected directory before migrations, so never choose retained state. Use the test environment and synthetic data. Do not run Core suites or another Web build concurrently.

## Driving conventions

Use ARIA roles and accessible names, with a visible-input qualifier when Web renders both desktop and phone search forms. Start from the fresh browser or authenticated fixture named by the recipe. Capture actions and outcomes with Playwright traces; include before-and-after ARIA snapshots and screenshots for changed presentation.

## Proof and skip reporting

Only catalog search has been executed for this skill's self-test. The other recipes are grounded in inspected repository specs and are unexecuted in this task. A feature is accepted only after all affected mapped entry points have executed. An existing browser spec with mocked API responses proves rendering, not authoritative Core behavior. Phone-width Web remains Web evidence.

## Features

| Feature | Entry points | Self-test status |
| --- | --- | --- |
| [Catalog search](catalog-search.md) | Visible header form, direct query URL | Header form executed; direct URL and phone form unexecuted |
| [Welcome announcement](welcome-announcement.md) | Storefront visit, revisit | Dismissal exercised during search; complete recipe unexecuted |
| [Delivery location and cart carryover](delivery-location-cart.md) | Storefront prompt, product location action, cart authentication | Unexecuted |
| [Customer account access](customer-account-access.md) | Account recovery, reset link, account sign-out | Unexecuted |
