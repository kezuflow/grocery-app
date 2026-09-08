# Initial Global Administrator Setup

This is first-installation enrollment, not staff recovery. Existing Global staff scope, including suspended staff, or completed setup makes new enrollment unavailable. Retained installations with staff use their existing access and invitation commands.

1. Set Core's `INITIAL_GLOBAL_ADMIN_EMAIL` to the explicitly chosen initial administrator email through deployment configuration. The committed empty value leaves setup disabled. Do not infer the email from Git, seed a password, or configure it in Web.
2. Use the normal Web registration or sign-in journey for that email and complete Better Auth email verification. OAuth may be used where separately configured and verified.
3. Open `/setup`. Review the Global access description and select **Create Global administrator access**. Core rechecks the current verified identity and clean setup eligibility in the transaction.
4. If confirmation is lost, retry the same displayed request. Reloading after successful setup shows completion. Open Admin, review explicit roles and invite operators with their required scopes.
5. Remove the setup email from deployment configuration after completion. The immutable singleton receipt prevents re-enrollment even if the email is later configured again. Removing configuration does not prevent authenticated replay of the original successful receipt.

Migration `0078_initial_administrator.sql` adds an empty evidence table and integrity triggers without altering existing users, roles, grants, or commercial data. Apply it using the normal backed-up, verified migration process. No existing database has been upgraded by writing this runbook.

Setup saves an explicit snapshot of current non-membership capabilities. It does not automatically grant later capabilities or restore suspended accounts. Better Auth continues to own credentials and sessions. The chosen deployment email and real email/OAuth delivery must be verified for the target environment before operational acceptance.
