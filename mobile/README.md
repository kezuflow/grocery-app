# FreshMarkets Mobile

Expo Router scaffold for Android and iOS. Phase 1 has live anonymous catalog Home and Search through `apps/mobile-api`; Cart, Orders and Account are labeled placeholders.

1. From `apps/core`, run `pnpm exec wrangler d1 migrations apply DB --local --persist-to .wrangler/mobile-dev --config wrangler.jsonc`, then `pnpm exec wrangler d1 execute DB --local --persist-to .wrangler/mobile-dev --config wrangler.jsonc --file seeds/development.sql` for disposable sample data.
2. Start Core from `apps/core`: `pnpm exec wrangler dev --config wrangler.jsonc --local --port 8787 --persist-to .wrangler/mobile-dev`. In another terminal, start Mobile API from `apps/mobile-api`: `pnpm exec wrangler dev --config wrangler.jsonc --local --port 8788 --persist-to ../core/.wrangler/mobile-dev`.
3. Copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_MOBILE_API_URL` to the reachable Mobile API origin. Android emulator uses `10.0.2.2`; an iOS simulator uses `127.0.0.1`. For a physical device, use your machine's LAN IP and a reachable local API.
4. Run `pnpm dev:mobile` from the repository root, then open Android or iOS. `EXPO_PUBLIC_MARKETPLACE_ORIGIN` is optional and resolves public product media paths.

The API URL is public Expo configuration. Never place secrets in `EXPO_PUBLIC_*` values. No separate mobile data store or business writes exist in this phase.
