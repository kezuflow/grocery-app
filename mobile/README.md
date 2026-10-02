# FreshMarkets Mobile

Expo Router customer app for Android and iOS. The five tabs and supporting screens use the Mobile API Worker as a thin adapter to Core; Core owns sessions, catalog, cart, orders, checkout, favorites and private order feedback.

## Run locally

1. From `apps/core`, apply migrations to a disposable local D1 state and seed it: `pnpm exec wrangler d1 migrations apply freshmarkets-core-dev --local --persist-to .wrangler/mobile-dev`, then `pnpm exec wrangler d1 execute freshmarkets-core-dev --local --persist-to .wrangler/mobile-dev --file seeds/development.sql` if the state has not already been seeded.
2. Start Core from `apps/core`: `pnpm exec wrangler dev --config wrangler.jsonc --port 8787 --persist-to .wrangler/mobile-dev`.
3. Start Mobile API from `apps/mobile-api`: `pnpm dev`. Check that its `CORE` service binding reports connected.
4. Copy `mobile/.env.example` to `mobile/.env.local` and set `EXPO_PUBLIC_MOBILE_API_URL` to the API origin reachable from the test device. Android emulator uses `http://10.0.2.2:8788`; a desktop browser uses `http://127.0.0.1:8788`; an iOS simulator uses `http://127.0.0.1:8788`. A physical device needs a reachable LAN or development-tunnel origin. `EXPO_PUBLIC_MARKETPLACE_ORIGIN` is optional for public product media paths.
5. Run `pnpm dev:mobile` from the repository root, then open Android or iOS. Run `pnpm --filter @freshmarkets/mobile exec expo export --platform all` to verify platform bundles.

The API URL is public Expo configuration. Never place secrets in `EXPO_PUBLIC_*` values. Local Core is configured with payment and delivery providers disabled, so it cannot complete a real payment or dispatch. Browse and guest states can be previewed in a phone-sized browser viewport; native permissions, secure storage, linking and device behavior still need Android/iOS testing. Source work does not deploy either Worker or publish a mobile build.
