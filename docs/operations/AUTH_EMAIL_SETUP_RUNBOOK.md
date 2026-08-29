# Auth Email Setup Runbook

## Production prerequisites

- Onboard and verify the sender domain/address with Cloudflare Email Service.
- Configure the Core `EMAIL` binding and deployment-only `AUTH_EMAIL_FROM`.
- Configure `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` for the actual Web origin;
  production must not inherit loopback development origins.
- Ensure the Web proxy preserves cookies, callback URLs, origin, and CSRF
  protections when forwarding `/api/auth` to Core.

## Verify without bypassing auth

1. Deploy Core and Web with the environment configuration above.
2. Request email verification or password reset through the normal browser
   flow and confirm delivery from the approved sender.
3. Confirm the Core auth response and Web response preserve `Set-Cookie` and
   callback behavior. Inspect structured request references only.
4. Run the authenticated Playwright suite only after the transport is
   provisioned:

```text
$env:E2E_AUTH_EMAIL_CONFIGURED="1"
pnpm --filter @freshmarkets/web exec playwright test
```

When the local transport is unavailable, leave those tests environment-gated.
Never add a test bypass, log a reset link, or put a sender credential in the
repository. Missing sender configuration must remain fail-closed as
`AUTH_EMAIL_DELIVERY_UNCONFIGURED`.
