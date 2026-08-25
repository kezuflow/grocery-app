# FreshMarkets Core

Authoritative modular-monolith Worker. Phase 1 adds:

- `health()` typed Service Binding RPC;
- Better Auth request handling at `/api/auth/*`, backed only by Core D1;
- `getApplicationContext()` typed RPC for application-owned staff capabilities and scopes;
- `GET /health` for local/runtime smoke checks;
- structured 404 errors.

Better Auth owns identity, account, session, and verification records only. Staff roles, permissions, scopes, and customer principals are Core-owned application records. Customer commerce, subscriptions, and all product features remain out of scope until later phases.

Phase 2 adds the authoritative `resolveServiceability()` RPC backed by versioned D1 service areas, delivery zones, fulfillment-location capabilities, and zone eligibility. Textual city labels are never authoritative, and the resolver does not allow customer location selection.

Configure `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` as Core secrets/vars per environment. Google routes are intentionally unavailable until both Google credentials are configured. Development email hooks log verification/reset URLs for test capture; production needs a configured transactional email binding/provider.
