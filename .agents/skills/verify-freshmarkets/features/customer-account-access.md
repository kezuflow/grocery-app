# Customer account access

Customers request password recovery, handle an invalid reset link, and sign out with a retry when a response is lost.

## Sub-features

- `account-recovery` retries an unconfirmed reset request.
- `account-expired-link` reports an invalid or expired reset link and offers recovery.
- `account-sign-out` clears the actual session after retry.

## How to get to it (user POV)

- Open `/account` and choose Reset your password.
- Open an `/auth/reset-password` link.
- Open `/account`, choose Sign out, and confirm.

## Driving it with Playwright

Preconditions:

- Use a fresh managed state at port 3100 with the existing authenticated fixture.
- This recipe is inspected but unexecuted in this task. Its email adapter is no-op and cannot prove delivery.

- Run `pnpm --filter @freshmarkets/web exec playwright test tests/e2e/customer-account-access.spec.ts --grep 'customer account recovery and sign-out at 390px' --trace on`.
- From `/account`, click `page.getByRole('link', { name: 'Reset your password', exact: true })`, fill the Email textbox with the synthetic fixture email, and choose Send reset instructions. Require the unconfirmed alert after the injected failed request, then `Reset instructions requested.` after retry.
- Visit `/auth/reset-password?token=deliberately-invalid-test-token`, fill New password, and choose Update password. Require `Reset link is invalid or expired. Request a new link.` and the Request a new reset link URL `/auth/forgot-password`.
- Return to `/account`, click the Sign out link, and choose the Sign out button. Require the first unconfirmed failure to retain a live session. Retry and require `You are signed out.`.
- Preserve the trace and read-only session query. `/api/auth/get-session` must return null after success; `/api/commerce/profile` must report UNAUTHENTICATED.

## Gotchas

- Do not capture or publish real account contacts, passwords, or reset tokens. Use only disposable synthetic fixture data.
- A reset-request success message does not prove email delivery.
- The baseline has no account-closure action. Do not report account deletion accepted.
- Phone-width Web does not verify native SecureStore, OAuth, or Expo logout.
